import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { GitHubReader, boundedText, parsePullUrl } from "../analysis/github.ts";
import {
  CHECK_CATALOG,
  MODEL,
  sameAssociation,
  recoverInterruptedAnalysis,
  type AnalysisRecord
} from "../analysis/advisory.ts";
import { createAnalysis } from "../analysis/service.ts";
import { CloudflareTarget } from "./cloudflare.ts";
import {
  Lifecycle,
  POLICY,
  terminal,
  evaluate,
  type Run
} from "./lifecycle.ts";

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
  private async saveRun(run: Run) {
    await this.ctx.storage.put({ current: run, [`run:${run.id}`]: run });
  }
  private async reserveAnalysis(record: AnalysisRecord) {
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
  }
  private async analyzeRun(run: Run): Promise<NonNullable<Run["source"]>> {
    let record: AnalysisRecord;
    if (run.analysisId) {
      const saved = await this.ctx.storage.get<AnalysisRecord>(
        `analysis:${run.analysisId}`
      );
      if (!saved || saved.status !== "complete")
        throw new Error("Interrupted analysis; start a fresh run");
      record = saved;
    } else {
      const reader = new GitHubReader(this.env.GITHUB_TOKEN);
      const target = new CloudflareTarget(this.env.DEPLOYGUARD_API_TOKEN!);
      record = await createAnalysis(
        { prUrl: run.request!.prUrl, candidate: run.candidate },
        {
          validateVersion: (id) => target.validateVersion(id),
          snapshot: async (url) => {
            const snapshot = await reader.snapshot(url);
            if (
              run.request?.expectedCommitSha &&
              snapshot.commitSha !== run.request.expectedCommitSha
            )
              throw new Error("PR head differs from expected candidate commit");
            return snapshot;
          },
          reserve: async (record) => {
            await this.reserveAnalysis(record);
            run.analysisId = record.id;
            await this.saveRun(run);
          },
          save: (record) =>
            this.ctx.storage.put(`analysis:${record.id}`, record),
          infer: (input) => this.env.AI.run(MODEL, input)
        }
      );
    }
    if (record.status !== "complete" || record.candidate !== run.candidate)
      throw new Error("PR analysis failed or mismatched candidate");
    return {
      analysisId: record.id,
      commitSha: record.pr.commitSha,
      prUrl: record.pr.url
    };
  }
  private async readState(run: Run | undefined) {
    if (!run)
      return Response.json(null, { headers: { "cache-control": "no-store" } });
    const analysis = run.analysisId
      ? await this.ctx.storage.get<AnalysisRecord>(`analysis:${run.analysisId}`)
      : undefined;
    const counts: Record<string, Record<string, number>> = {};
    for (const sample of run.samples) {
      const key = `${sample.version}:${sample.endpoint}`;
      const group = (counts[key] ??= {
        pass: 0,
        http_error: 0,
        assertion_failure: 0,
        unknown: 0
      });
      group[sample.outcome]++;
    }
    const healthy = evaluate(run, Date.now()) === "healthy";
    return Response.json(
      {
        run,
        analysis: analysis
          ? recoverInterruptedAnalysis(analysis, Date.now())
          : null,
        health: {
          decision: [
            "canary",
            "awaiting_approval",
            "verifying_promotion"
          ].includes(run.phase)
            ? evaluate(run, Date.now())
            : null,
          counts
        },
        deadlines: {
          canary: run.canaryAt ? run.canaryAt + run.policy.maxCanaryMs : null,
          approval: run.approval?.expiresAt ?? null,
          postPromotion: run.promotionAt
            ? run.promotionAt + run.policy.postPromotionDeadlineMs
            : null
        },
        allowedActions: {
          approve:
            run.phase === "awaiting_approval" &&
            healthy &&
            Date.now() < run.approval!.expiresAt,
          rollback: !terminal(run) && Boolean(run.stable) && !run.intent,
          reconcile: run.phase === "needs_attention"
        }
      },
      { headers: { "cache-control": "no-store" } }
    );
  }
  private engine() {
    const target = new CloudflareTarget(this.env.DEPLOYGUARD_API_TOKEN!);
    return new Lifecycle({
      load: () => this.ctx.storage.get<Run>("current"),
      save: (run) => this.saveRun(run),
      analyze: (run) => this.analyzeRun(run),
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
        reserve: (record) => this.serial(() => this.reserveAnalysis(record)),
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
    // Reads do not wait behind slow analysis or probe batches. Storage snapshots are durable.
    const path = new URL(request.url).pathname;
    if (request.method === "GET") {
      if (path === "/api/deployment/state")
        return this.readState(await this.ctx.storage.get<Run>("current"));
      if (path === "/api/deployment")
        return Response.json((await this.ctx.storage.get("current")) ?? null, {
          headers: { "cache-control": "no-store" }
        });
      if (path === "/api/deployment/history") {
        const runs = await this.ctx.storage.list<Run>({
          prefix: "run:",
          limit: 100
        });
        return Response.json(
          [...runs.values()].sort((a, b) => b.createdAt - a.createdAt),
          { headers: { "cache-control": "no-store" } }
        );
      }
      const id = path.slice("/api/deployment/".length);
      if (z.string().uuid().safeParse(id).success) {
        const run = await this.ctx.storage.get<Run>(`run:${id}`);
        return run
          ? this.readState(run)
          : Response.json({ error: "Run not found" }, { status: 404 });
      }
      return new Response("Not found", { status: 404 });
    }
    return this.serial(async () => {
      const path = new URL(request.url).pathname;
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
              analysisId: z.string().uuid().optional(),
              prUrl: z.string().max(500).optional(),
              expectedCommitSha: z
                .string()
                .regex(/^[0-9a-f]{40}$/)
                .optional()
            })
            .strict()
            .parse(body);
          if (input.prUrl && input.analysisId)
            throw new Error("Provide prUrl or existing analysisId, not both");
          if (input.expectedCommitSha && !input.prUrl)
            throw new Error("expectedCommitSha requires prUrl");
          if (input.prUrl) parsePullUrl(input.prUrl);
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
          run = await engine.start(
            input.candidate,
            source,
            input.prUrl
              ? {
                  prUrl: input.prUrl,
                  expectedCommitSha: input.expectedCommitSha
                }
              : undefined
          );
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
