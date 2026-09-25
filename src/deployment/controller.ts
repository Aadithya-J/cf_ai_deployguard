import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { CloudflareTarget } from "./cloudflare.ts";
import { Lifecycle, POLICY, terminal, type Run } from "./lifecycle.ts";

export type DeploymentEnv = Env & {
  DEPLOYGUARD_API_TOKEN?: string;
  DEPLOYGUARD_ADMIN_TOKEN?: string;
};
// One named instance is reachable through the router. Never route by client input.
export class DeploymentController extends DurableObject<DeploymentEnv> {
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
  async fetch(request: Request) {
    return this.serial(async () => {
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
              candidate: z.string().uuid()
            })
            .strict()
            .parse(body);
          run = await engine.start(input.candidate);
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
