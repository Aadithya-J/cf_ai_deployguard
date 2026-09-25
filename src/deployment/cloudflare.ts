import { z } from "zod";
import {
  ENDPOINTS,
  type Allocation,
  type Deployment,
  type Run,
  type Sample
} from "./lifecycle.ts";

// V1 allowlist: no request can supply an account, script, URL, or probe endpoint.
export const TARGET = Object.freeze({
  account: "3d29ff5d48d777df7b06222c454e3d98",
  script: "deployguard-demo-target",
  host: "deployguard-demo-target.jlaadithya.workers.dev"
});
const deploymentSchema = z
  .object({
    id: z.string().min(1),
    versions: z
      .array(
        z.object({
          version_id: z.string().uuid(),
          percentage: z.number().min(0).max(100)
        })
      )
      .min(1)
      .max(2),
    annotations: z.record(z.string(), z.string()).optional()
  })
  .refine(
    (d) =>
      d.versions.reduce((sum, v) => sum + v.percentage, 0) === 100 &&
      new Set(d.versions.map((v) => v.version_id)).size === d.versions.length
  );
const payloadSchema = z.object({
  version: z.object({ id: z.string().uuid(), release: z.string() }),
  requestId: z.string().uuid(),
  ok: z.boolean().optional(),
  greeting: z.string().optional()
});
export class CloudflareTarget {
  private token: string;
  private http: typeof fetch;
  constructor(token: string, http: typeof fetch = fetch) {
    this.token = token;
    // Native Workers fetch requires its global receiver when stored as a method.
    this.http = http.bind(globalThis);
  }
  private async api(path: string, body?: unknown): Promise<unknown> {
    const response = await this.http(
      `https://api.cloudflare.com/client/v4/accounts/${TARGET.account}/workers/scripts/${TARGET.script}${path}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
        redirect: "manual"
      }
    );
    if (!response.ok) throw new Error(`Cloudflare API HTTP ${response.status}`);
    const envelope = z
      .object({ success: z.literal(true), result: z.unknown() })
      .parse(await response.json());
    return envelope.result;
  }
  async current(): Promise<Deployment> {
    const result = z
      .object({ deployments: z.array(deploymentSchema).min(1) })
      .parse(await this.api("/deployments"));
    return result.deployments[0];
  }
  async validateVersion(id: string) {
    const version = z
      .object({ id: z.literal(id) })
      .parse(await this.api(`/versions/${id}`));
    if (version.id !== id) throw new Error("Version mismatch");
  }
  async deploy(versions: Allocation, message: string) {
    // No force and no automatic mutation retries.
    deploymentSchema.parse(
      await this.api("/deployments", {
        strategy: "percentage",
        versions,
        annotations: { "workers/message": message }
      })
    );
  }
  async probe(run: Run, preview: boolean): Promise<Sample[]> {
    const ordinary = ["verifying_promotion", "verifying_rollback"].includes(
      run.phase
    );
    const versions =
      run.phase === "verifying_rollback"
        ? [run.stable]
        : preview || run.phase === "verifying_promotion"
          ? [run.candidate]
          : [run.stable, run.candidate];
    return Promise.all(
      versions.flatMap((version) =>
        ENDPOINTS.map(async (endpoint) => {
          const started = performance.now();
          const sample: Sample = {
            id: crypto.randomUUID(),
            at: Date.now(),
            version,
            endpoint,
            outcome: "unknown",
            latencyMs: 0
          };
          try {
            const host = preview
              ? `${version.slice(0, 8)}-${TARGET.host}`
              : TARGET.host;
            const response = await this.http(`https://${host}${endpoint}`, {
              headers: {
                "x-deployguard-probe": run.id,
                ...(preview || ordinary
                  ? {}
                  : {
                      "Cloudflare-Workers-Version-Overrides": `${TARGET.script}="${version}"`
                    })
              },
              signal: AbortSignal.timeout(5_000),
              redirect: "manual"
            });
            sample.observedVersion =
              response.headers.get("x-deployguard-version") ?? undefined;
            // A platform error with no identifying header cannot be attributed reliably.
            if (response.headers.get("x-deployguard-version") !== version) {
              await response.body?.cancel();
              return sample;
            }
            if (response.status !== 200) {
              sample.outcome = "http_error";
              await response.body?.cancel();
              return sample;
            }
            sample.outcome = "assertion_failure";
            const body = payloadSchema.parse(await response.json());
            const contentValid =
              endpoint === "/health"
                ? body.ok === true
                : typeof body.greeting === "string" &&
                  body.greeting.endsWith(", DeployGuard!");
            if (
              response.status === 200 &&
              body.version.id === version &&
              contentValid &&
              response.headers.get("x-request-id") === body.requestId &&
              response.headers.get("x-deployguard-release") ===
                body.version.release &&
              response.headers.get("cache-control") === "no-store"
            )
              sample.outcome = "pass";
          } catch {
            /* Transport failure = unknown; malformed attributed HTTP 200 = hard assertion failure. */
          } finally {
            sample.latencyMs = performance.now() - started;
            sample.at = Date.now();
          }
          return sample;
        })
      )
    );
  }
}
