import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { GitHubReader, boundedText } from "../analysis/github.ts";
import {
  CHECK_CATALOG,
  MODEL,
  sameAssociation,
  recoverInterruptedAnalysis,
  type AnalysisRecord
} from "../analysis/advisory.ts";
import { createAnalysis } from "../analysis/service.ts";
import { CloudflareTarget } from "./cloudflare.ts";
import { Lifecycle, POLICY, terminal, type Run } from "./lifecycle.ts";

export type DeploymentEnv = Env & {
  DEPLOYGUARD_API_TOKEN?: string;
  DEPLOYGUARD_ADMIN_TOKEN?: string;
  GITHUB_TOKEN?: string;
};
// One named instance is reachable through the router. Never route by client input.
export class DeploymentController extends DurableObject<DeploymentEnv> {
  private analysisInFlight = false;
  private queue: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private engine() {
    const target = new CloudflareTarget(this.env.DEPLOYGUARD_API_TOKEN!);
    return new Lifecycle({
      load: () => this.ctx.storage.get<Run>("current"),
      save: async (run) => {
        await this.ctx.storage.put({ current: run, [`run:${run.id}`]: run });
      },
      current: () => target.current(),
      validateVersion: (id) => target.validateVersion(id),
      deploy: (versions, message) => target.deploy(versions, message),
      probe: (run, preview) => target.probe(run, preview),
      now: Date.now,
      uuid: () => crypto.randomUUID()
    });
  }
  private async analysisRequest(request: Request) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET") {
      if (path === "/api/analysis/catalog") return Response.json(CHECK_CATALOG);
      if (path === "/api/analysis") {
        const records = await this.ctx.storage.list<AnalysisRecord>({
          prefix: "analysis:",
          limit: 100
        });
        return Response.json(
          [...records.values()]
            .map((record) => recoverInterruptedAnalysis(record, Date.now()))
            .sort((a, b) => b.createdAt - a.createdAt)
        );
      }
      const id = path.slice("/api/analysis/".length);
      if (!z.string().uuid().safeParse(id).success)
        return new Response("Not found", { status: 404 });
      const record = await this.ctx.storage.get<AnalysisRecord>(
        `analysis:${id}`
      );
      return Response.json(
        record
          ? recoverInterruptedAnalysis(record, Date.now())
          : { error: "Not found" },
        {
          status: record ? 200 : 404
        }
      );
    }
    if (request.method !== "POST" || path !== "/api/analysis")
      return new Response("Not found", { status: 404 });
    if (this.analysisInFlight)
      return Response.json(
        { error: "An analysis is already running" },
        { status: 409 }
      );
    this.analysisInFlight = true;
    try {
      const input: unknown = JSON.parse(
        await boundedText(new Response(request.body), 2048)
      );
      const reader = new GitHubReader(this.env.GITHUB_TOKEN);
      const target = new CloudflareTarget(this.env.DEPLOYGUARD_API_TOKEN!);
      const record = await createAnalysis(input, {
        snapshot: (url) => reader.snapshot(url),
        validateVersion: (id) => target.validateVersion(id),
        reserve: (record) =>
          this.serial(async () => {
            const key = `association:${record.candidate}`;
            const existing = await this.ctx.storage.get<AnalysisRecord>(key);
            if (existing && !sameAssociation(existing, record))
              throw new Error(
                "Candidate already associated with a different immutable PR snapshot; upload a new version"
              );
            await this.ctx.storage.put({
              [key]: existing ?? record,
              [`analysis:${record.id}`]: record
            });
          }),
        save: (record) => this.ctx.storage.put(`analysis:${record.id}`, record),
        infer: (input) => this.env.AI.run(MODEL, input)
      });
      return Response.json(record, {
        status: record.status === "complete" ? 201 : 502
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Analysis rejected" },
        { status: 422 }
      );
    } finally {
      this.analysisInFlight = false;
    }
  }
  async fetch(request: Request) {
    if (!this.env.DEPLOYGUARD_API_TOKEN || !this.env.DEPLOYGUARD_ADMIN_TOKEN)
      return Response.json(
        { error: "Deployment control is not configured" },
        { status: 503 }
      );
    if (
      request.headers.get("Authorization") !==
      `Bearer ${this.env.DEPLOYGUARD_ADMIN_TOKEN}`
    )
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    // Slow GitHub/AI calls must never occupy the deployment/alarm serialization queue.
    if (new URL(request.url).pathname.startsWith("/api/analysis"))
      return this.analysisRequest(request);
    return this.serial(async () => {
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path === "/api/deployment")
        return Response.json((await this.ctx.storage.get("current")) ?? null);
      if (request.method === "GET" && path === "/api/deployment/history") {
        const runs = await this.ctx.storage.list<Run>({
          prefix: "run:",
          limit: 100
        });
        return Response.json(
          [...runs.values()].sort((a, b) => b.createdAt - a.createdAt)
        );
      }
      if (request.method !== "POST")
        return new Response("Not found", { status: 404 });
      try {
        const text = await request.text();
        if (text.length > 2048)
          return new Response("Body too large", { status: 413 });
        const body: unknown = JSON.parse(text);
        const engine = this.engine();
        // Arm recovery before accepting durable work. Alarm and HTTP calls share a queue.
        if ((await this.ctx.storage.getAlarm()) === null) {
          await this.ctx.storage.setAlarm(Date.now() + POLICY.intervalMs);
        }
        let run: Run;
        if (path === "/api/deployment/start") {
          const input = z
            .object({
              candidate: z.string().uuid(),
              analysisId: z.string().uuid().optional()
            })
            .strict()
            .parse(body);
          let source: Run["source"];
          if (input.analysisId) {
            const record = await this.ctx.storage.get<AnalysisRecord>(
              `analysis:${input.analysisId}`
            );
            if (
              !record ||
              record.status !== "complete" ||
              record.candidate !== input.candidate
            )
              throw new Error(
                "Analysis must be complete and associated with this candidate"
              );
            source = {
              analysisId: record.id,
              commitSha: record.pr.commitSha,
              prUrl: record.pr.url
            };
          }
          run = await engine.start(input.candidate, source);
        } else if (path === "/api/deployment/approve") {
          const input = z
            .object({ runId: z.string().uuid(), approvalId: z.string().uuid() })
            .strict()
            .parse(body);
          run = await engine.approve(input.runId, input.approvalId);
        } else {
          const input = z
            .object({ runId: z.string().uuid() })
            .strict()
            .parse(body);
          if (path === "/api/deployment/rollback")
            run = await engine.rollback(input.runId);
          else if (path === "/api/deployment/reconcile")
            run = await engine.reconcile(input.runId);
          else return new Response("Not found", { status: 404 });
        }
        return Response.json(run, { status: 202 });
      } catch (error) {
        return Response.json(
          {
            error: error instanceof Error ? error.message : "Request rejected"
          },
          { status: 409 }
        );
      }
    });
  }
  async alarm() {
    return this.serial(async () => {
      // Arm the next alarm first, so a crash after an external mutation still wakes us.
      await this.ctx.storage.setAlarm(Date.now() + POLICY.intervalMs);
      const run = await this.engine().tick();
      if (!run || terminal(run) || run.phase === "needs_attention")
        await this.ctx.storage.deleteAlarm();
    });
  }
}
