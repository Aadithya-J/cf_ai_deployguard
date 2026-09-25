import type { Run, Sample } from "../deployment/lifecycle";
import type { AnalysisRecord } from "../analysis/advisory";
export interface RunView {
  run: Run;
  analysis: AnalysisRecord | null;
  health: {
    decision: string | null;
    counts: Record<string, Record<string, number>>;
  };
  deadlines: {
    canary: number | null;
    approval: number | null;
    postPromotion: number | null;
    rollback: number | null;
  };
  allowedActions: { approve: boolean; rollback: boolean; reconcile: boolean };
}
export const phases: Record<Run["phase"], string> = {
  analyzing: "Analyzing PR",
  validating: "Validating candidate",
  smoke: "Smoke testing",
  starting_canary: "Starting canary",
  canary: "Canary in progress",
  awaiting_approval: "Awaiting approval",
  promoting: "Promoting",
  verifying_promotion: "Verifying promotion",
  rolling_back: "Rolling back",
  verifying_rollback: "Verifying recovery",
  promoted: "Promoted",
  demo_complete: "Demo complete · stable restored",
  rolled_back: "Rolled back",
  rejected: "Rejected",
  needs_attention: "Needs attention"
};
export const terminal = (run: Run) =>
  ["promoted", "rolled_back", "rejected", "demo_complete"].includes(run.phase);
export const short = (id?: string) => (id ? id.slice(0, 8) : "Not established");
export const date = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
export function prLabel(run: Run) {
  const url = run.source?.prUrl ?? run.request?.prUrl;
  return url ? `PR #${url.split("/").at(-1)}` : "Candidate deployment";
}
export function healthSamples(run: Run, now: number) {
  if (run.rollbackVerification) return run.rollbackVerification.samples;
  if (run.phase === "verifying_promotion" || run.promotionAt)
    return [...(run.baseline ?? []), ...run.samples];
  return ["canary", "awaiting_approval", "promoting"].includes(run.phase)
    ? run.samples.filter((s) => s.at >= now - run.policy.windowMs)
    : run.samples;
}
export function stats(samples: Sample[]) {
  const known = samples.filter((s) => s.outcome !== "unknown");
  const http = known.filter((s) => s.outcome === "http_error").length;
  const latencies = samples
    .map((s) => s.latencyMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return {
    count: samples.length,
    http,
    unknown: samples.length - known.length,
    assertions: samples.filter((s) => s.outcome === "assertion_failure").length,
    rate: known.length ? `${Math.round((http / known.length) * 100)}%` : "—",
    p95: latencies.length
      ? `${Math.round(latencies[Math.ceil(latencies.length * 0.95) - 1])} ms`
      : "—"
  };
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
    cache: "no-store"
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      (data as { error?: string })?.error ??
        `Request failed (${response.status}).`,
      response.status
    );
  return data as T;
}
