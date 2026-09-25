// This module has no Cloudflare runtime or LLM dependency. All decisions are deterministic.
export const POLICY = Object.freeze({
  version: 3,
  candidatePercent: 10,
  intervalMs: 5_000,
  minObservationMs: 30_000,
  maxCanaryMs: 180_000,
  windowMs: 60_000,
  minPerEndpoint: 10,
  freshnessMs: 15_000,
  approvalMs: 60_000,
  maxP95Ms: 2_000,
  maxLatencyRatio: 2,
  latencyAllowanceMs: 100,
  mutationConfirmationMs: 30_000,
  maxCandidateErrorRate: 0.2,
  maxErrorRateIncrease: 0.05,
  maxStableErrorRate: 0.1,
  minHttpErrors: 3,
  postPromotionMs: 30_000,
  postPromotionDeadlineMs: 60_000,
  postPromotionSamples: 6
});
export const ROLLBACK_POLICY = Object.freeze({
  windowMs: 30_000,
  deadlineMs: 90_000,
  minPerEndpoint: 7,
  freshnessMs: 15_000,
  maxLatencyMs: 2_000
});
export const ENDPOINTS = ["/health", "/api/greeting?name=DeployGuard"] as const;
export type Phase =
  | "analyzing"
  | "validating"
  | "smoke"
  | "starting_canary"
  | "canary"
  | "awaiting_approval"
  | "verifying_promotion"
  | "promoting"
  | "verifying_rollback"
  | "rolling_back"
  | "demo_complete"
  | "promoted"
  | "rolled_back"
  | "rejected"
  | "needs_attention";
export type Allocation = { version_id: string; percentage: number }[];
export interface Deployment {
  id: string;
  versions: Allocation;
  annotations?: Record<string, string>;
}
export interface Sample {
  id: string;
  at: number;
  version: string;
  observedVersion?: string;
  endpoint: string;
  outcome: "pass" | "http_error" | "assertion_failure" | "unknown";
  latencyMs: number;
}
export interface Run {
  id: string;
  source?: { analysisId: string; commitSha: string; prUrl: string };
  request?: { prUrl: string; expectedCommitSha?: string };
  analysisId?: string;
  rehearsal?: {
    preset: "rollback-demo" | "promotion-demo";
    expectedStable: string;
    promotionVerifiedAt?: number;
    approvalId?: string;
  };
  candidate: string;
  stable: string;
  phase: Phase;
  policy: typeof POLICY;
  createdAt: number;
  updatedAt: number;
  reason: string;
  failure?: { phase: Phase; message: string; at: number };
  expected?: Deployment;
  canaryAt?: number;
  promotionAt?: number;
  baseline?: Sample[];
  rollbackVerification?: {
    startedAt: number;
    policy: typeof ROLLBACK_POLICY;
    samples: Sample[];
  };
  approval?: { id: string; expiresAt: number };
  samples: Sample[];
  intent?: { versions: Allocation; message: string; at: number };
  events: { at: number; phase: Phase; reason: string }[];
}
export interface Ports {
  load(): Promise<Run | undefined>;
  save(run: Run): Promise<void>;
  current(): Promise<Deployment>;
  validateVersion(id: string): Promise<void>;
  analyze?(run: Run): Promise<NonNullable<Run["source"]>>;
  deploy(versions: Allocation, message: string): Promise<void>;
  probe(run: Run, preview: boolean): Promise<Sample[]>;
  now(): number;
  uuid(): string;
}
export const terminal = (r: Run) =>
  ["promoted", "rolled_back", "rejected", "demo_complete"].includes(r.phase);
export const sameAllocation = (a: Allocation, b: Allocation) =>
  a.length === b.length &&
  a.every((x) =>
    b.some(
      (y) => y.version_id === x.version_id && y.percentage === x.percentage
    )
  );
const stableAllocation = (r: Run): Allocation => [
  { version_id: r.stable, percentage: 100 }
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Require a continuous clean sampled interval for every endpoint, with no long
// observation gaps. Failed/unknown/candidate samples reset the shared interval.
export function rollbackHealthy(r: Run, now: number): boolean {
  const v = r.rollbackVerification;
  if (!v || now >= v.startedAt + v.policy.deadlineMs) return false;
  const p = v.policy;
  const samples = v.samples;
  const valid = (s: Sample) =>
    s.version === r.stable &&
    s.observedVersion === r.stable &&
    s.outcome === "pass" &&
    Number.isFinite(s.latencyMs) &&
    s.latencyMs >= 0 &&
    s.latencyMs <= p.maxLatencyMs &&
    s.at >= v.startedAt &&
    s.at <= now;
  const lastBad = samples.reduce(
    (at, s) => (valid(s) ? at : Math.max(at, s.at)),
    v.startedAt - 1
  );
  return ENDPOINTS.every((endpoint) => {
    const group = samples
      .filter((s) => s.endpoint === endpoint && s.at > lastBad && valid(s))
      .sort((a, b) => a.at - b.at);
    // A delayed alarm/restart must collect a new continuous interval.
    let start = 0;
    for (let i = 1; i < group.length; i++)
      if (group[i].at - group[i - 1].at > p.freshnessMs) start = i;
    const clean = group.slice(start);
    return (
      new Set(clean.map((s) => s.id)).size >= p.minPerEndpoint &&
      clean.at(-1)!.at - clean[0].at >= p.windowMs &&
      now - clean.at(-1)!.at <= p.freshnessMs
    );
  });
}

export function evaluate(
  r: Run,
  now: number
): "healthy" | "unhealthy" | "inconclusive" {
  const p = r.policy;
  const samples = r.samples.filter(
    (s) => s.at >= now - p.windowMs && s.at <= now
  );
  const post = r.phase === "verifying_promotion";
  if (samples.some((s) => s.outcome === "assertion_failure"))
    return "unhealthy";
  if (samples.some((s) => s.outcome === "unknown")) return "inconclusive";
  const start = post ? r.promotionAt : r.canaryAt;
  if (
    start === undefined ||
    now - start < (post ? p.postPromotionMs : p.minObservationMs)
  )
    return "inconclusive";
  let inconclusive = false;
  for (const endpoint of ENDPOINTS) {
    const stats: { rate: number; failures: number; p95: number }[] = [];
    for (const version of [r.stable, r.candidate]) {
      const frozen = post && version === r.stable;
      const group = (frozen ? (r.baseline ?? []) : samples).filter(
        (s) => s.version === version && s.endpoint === endpoint
      );
      const minimum =
        post && !frozen ? p.postPromotionSamples : p.minPerEndpoint;
      if (
        new Set(group.map((s) => s.id)).size < minimum ||
        (!frozen && !group.some((s) => now - s.at <= p.freshnessMs)) ||
        group.some(
          (s) =>
            !Number.isFinite(s.latencyMs) ||
            s.latencyMs < 0 ||
            s.outcome === "unknown"
        )
      )
        return "inconclusive";
      const failures = group.filter((s) => s.outcome === "http_error").length;
      const sorted = group.map((s) => s.latencyMs).sort((a, b) => a - b);
      stats.push({
        rate: failures / group.length,
        failures,
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1]
      });
    }
    const [stable, candidate] = stats;
    const exceeds =
      candidate.rate > p.maxCandidateErrorRate ||
      candidate.rate - stable.rate > p.maxErrorRateIncrease + 1e-9;
    if (exceeds && candidate.failures >= p.minHttpErrors) return "unhealthy";
    // A bad baseline or too few failures to establish regression never means healthy.
    if (exceeds || stable.rate > p.maxStableErrorRate) inconclusive = true;
    if (
      candidate.p95 > p.maxP95Ms ||
      candidate.p95 >
        Math.max(
          stable.p95 * p.maxLatencyRatio,
          stable.p95 + p.latencyAllowanceMs
        )
    )
      return "unhealthy";
    if (stable.p95 > p.maxP95Ms) inconclusive = true;
  }
  if (inconclusive) return "inconclusive";
  return "healthy";
}

// The host MUST serialize calls per target. The durable current run is the lock,
// including needs_attention; no timeout silently releases ownership.
export class Lifecycle {
  private p: Ports;
  constructor(ports: Ports) {
    this.p = ports;
  }
  private async move(r: Run, phase: Phase, reason: string) {
    r.phase = phase;
    r.reason = reason;
    r.updatedAt = this.p.now();
    r.events.push({ at: r.updatedAt, phase, reason });
    await this.p.save(r);
  }
  async start(
    candidate: string,
    source?: Run["source"],
    request?: Run["request"],
    rehearsal?: Run["rehearsal"]
  ) {
    if (!uuid.test(candidate))
      throw new Error("Candidate must be a version UUID");
    const old = await this.p.load();
    if (old && !terminal(old))
      throw new Error("Target already has an active or unresolved run");
    const now = this.p.now();
    const run: Run = {
      id: this.p.uuid(),
      candidate,
      ...(source ? { source, analysisId: source.analysisId } : {}),
      ...(request ? { request } : {}),
      ...(rehearsal ? { rehearsal } : {}),
      stable: "",
      phase: request ? "analyzing" : "validating",
      policy: { ...POLICY },
      createdAt: now,
      updatedAt: now,
      reason: "Run accepted",
      samples: [],
      events: []
    };
    await this.move(run, run.phase, "Run accepted; target lock acquired");
    return run;
  }
  private async checkCurrent(r: Run) {
    const actual = await this.p.current();
    if (
      !r.expected ||
      actual.id !== r.expected.id ||
      !sameAllocation(actual.versions, r.expected.versions)
    ) {
      await this.move(
        r,
        "needs_attention",
        "Deployment changed outside this run; no overwrite attempted"
      );
      return false;
    }
    return true;
  }
  private async beginRollbackVerification(r: Run) {
    delete r.approval;
    r.rollbackVerification = {
      startedAt: this.p.now(),
      policy: { ...ROLLBACK_POLICY },
      samples: []
    };
    await this.move(
      r,
      "verifying_rollback",
      "Stable 100% confirmed; ordinary traffic verification required"
    );
  }
  private async confirm(r: Run) {
    const intent = r.intent!;
    const actual = await this.p.current();
    if (
      actual.annotations?.["workers/message"] === intent.message &&
      sameAllocation(actual.versions, intent.versions)
    ) {
      r.expected = actual;
      delete r.intent;
      if (r.phase === "starting_canary") {
        r.canaryAt = this.p.now();
        await this.move(r, "canary", "90/10 deployment confirmed by read-back");
      } else if (r.phase === "promoting") {
        r.baseline = r.samples.filter(
          (s) =>
            s.version === r.stable && s.at >= this.p.now() - r.policy.windowMs
        );
        r.samples = [];
        r.promotionAt = this.p.now();
        delete r.approval;
        await this.move(
          r,
          "verifying_promotion",
          "Candidate 100% confirmed; post-promotion probes required"
        );
      } else await this.beginRollbackVerification(r);
    } else if (this.p.now() - intent.at >= r.policy.mutationConfirmationMs) {
      await this.move(
        r,
        "needs_attention",
        "Mutation could not be confirmed; lock retained, inspect Cloudflare state"
      );
    }
  }
  private async mutate(r: Run) {
    if (r.intent) {
      await this.confirm(r);
      return;
    }
    if (!(await this.checkCurrent(r))) return;
    // Recheck after the control-plane GET, which itself may take several seconds.
    if (
      r.phase === "promoting" &&
      (!r.approval ||
        this.p.now() >= r.approval.expiresAt ||
        this.p.now() >= r.canaryAt! + r.policy.maxCanaryMs ||
        evaluate(r, this.p.now()) !== "healthy")
    ) {
      delete r.approval;
      await this.move(
        r,
        "rolling_back",
        "Promotion evidence expired during preflight"
      );
    }
    const versions: Allocation =
      r.phase === "starting_canary"
        ? [
            {
              version_id: r.stable,
              percentage: 100 - r.policy.candidatePercent
            },
            { version_id: r.candidate, percentage: r.policy.candidatePercent }
          ]
        : r.phase === "promoting"
          ? [{ version_id: r.candidate, percentage: 100 }]
          : stableAllocation(r);
    r.intent = {
      versions,
      message: `deployguard:${r.id}:${r.phase}`,
      at: this.p.now()
    };
    // Write-ahead intent survives a lost HTTP response or process restart.
    await this.p.save(r);
    try {
      await this.p.deploy(versions, r.intent.message);
    } catch {
      /* Never blindly retry a POST. */
    }
    await this.confirm(r);
  }
  async approveDemo(runId: string, approvalId: string) {
    const r = await this.p.load();
    if (!r || r.id !== runId || r.rehearsal?.preset !== "promotion-demo")
      throw new Error(
        "Only a prepared healthy rehearsal can receive public approval"
      );
    return this.approve(runId, approvalId);
  }
  async approve(runId: string, approvalId: string) {
    const r = await this.p.load();
    if (
      !r ||
      r.id !== runId ||
      r.phase !== "awaiting_approval" ||
      r.approval?.id !== approvalId
    )
      throw new Error("Stale approval or wrong run");
    if (
      this.p.now() >= r.approval.expiresAt ||
      this.p.now() >= r.canaryAt! + r.policy.maxCanaryMs ||
      evaluate(r, this.p.now()) !== "healthy"
    )
      throw new Error(
        "Approval expired or health evidence is no longer healthy and fresh"
      );
    if (!(await this.checkCurrent(r)))
      throw new Error("Deployment changed; approval invalidated");
    await this.move(
      r,
      "promoting",
      "Explicit approval accepted for this run and evidence window"
    );
    return r;
  }
  async rollback(runId: string) {
    const r = await this.p.load();
    if (!r || r.id !== runId || terminal(r))
      throw new Error("Run is not active");
    if (r.phase === "verifying_rollback")
      throw new Error("Rollback traffic verification already in progress");
    // An unresolved write could still complete: never race it with another mutation.
    if (r.intent)
      throw new Error("Reconcile pending mutation before requesting rollback");
    if (!r.stable || !(await this.checkCurrent(r)))
      throw new Error("Cannot safely own rollback");
    delete r.approval;
    if (sameAllocation(r.expected!.versions, stableAllocation(r)))
      await this.beginRollbackVerification(r);
    else
      await this.move(
        r,
        "rolling_back",
        "Operator requested stable restoration"
      );
    return r;
  }
  async tick() {
    const r = await this.p.load();
    if (!r || terminal(r) || r.phase === "needs_attention") return r;
    if (
      r.policy.version !== POLICY.version &&
      !["rolling_back", "verifying_rollback"].includes(r.phase)
    ) {
      await this.move(
        r,
        "needs_attention",
        "Policy version changed; reconcile or restore stable before starting a new run"
      );
      return r;
    }
    try {
      if (r.phase === "analyzing") {
        if (!this.p.analyze) throw new Error("Analysis is not configured");
        r.source = await this.p.analyze(r);
        r.analysisId = r.source.analysisId;
        await this.move(
          r,
          "validating",
          "Immutable PR analysis persisted; candidate validation next"
        );
      } else if (
        ["starting_canary", "promoting", "rolling_back"].includes(r.phase)
      ) {
        // A delayed alarm must not promote on old evidence.
        if (
          r.phase === "promoting" &&
          !r.intent &&
          (!r.approval ||
            this.p.now() >= r.approval.expiresAt ||
            evaluate(r, this.p.now()) !== "healthy")
        ) {
          await this.move(
            r,
            "rolling_back",
            "Approved evidence expired before promotion"
          );
        }
        await this.mutate(r);
      } else if (r.phase === "validating") {
        const current = await this.p.current();
        if (
          current.versions.length !== 1 ||
          current.versions[0].percentage !== 100 ||
          current.versions[0].version_id === r.candidate ||
          (r.rehearsal &&
            current.versions[0].version_id !== r.rehearsal.expectedStable)
        ) {
          await this.move(
            r,
            "rejected",
            r.rehearsal
              ? "Rehearsal requires the configured healthy stable version at 100%; ask an admin to restore it"
              : "Requires one stable version at 100% and a distinct candidate"
          );
          return r;
        }
        await this.p.validateVersion(r.candidate);
        r.stable = current.versions[0].version_id;
        r.expected = current;
        await this.move(
          r,
          "smoke",
          "Candidate exists in the configured target"
        );
      } else if (r.phase === "smoke") {
        const samples = await this.p.probe(r, true);
        const passed = ENDPOINTS.every((endpoint) =>
          samples.some(
            (s) =>
              s.endpoint === endpoint &&
              s.version === r.candidate &&
              s.outcome === "pass"
          )
        );
        if (!passed || samples.some((s) => s.outcome !== "pass"))
          await this.move(
            r,
            "rejected",
            "Candidate smoke test failed or was inconclusive; no traffic changed"
          );
        else {
          r.samples = [];
          await this.move(r, "starting_canary", "Preview smoke test passed");
        }
      } else if (r.phase === "verifying_rollback") {
        if (!(await this.checkCurrent(r))) return r;
        const verification = r.rollbackVerification!;
        if (
          this.p.now() <
          verification.startedAt + verification.policy.deadlineMs
        )
          verification.samples.push(...(await this.p.probe(r, false)));
        // Recheck ownership after probes as well as before reporting completion.
        if (!(await this.checkCurrent(r))) return r;
        if (
          this.p.now() >=
          verification.startedAt + verification.policy.deadlineMs
        )
          await this.move(
            r,
            "needs_attention",
            "Rollback traffic did not converge before deadline; lock retained"
          );
        else if (rollbackHealthy(r, this.p.now()))
          await this.move(
            r,
            r.rehearsal?.promotionVerifiedAt ? "demo_complete" : "rolled_back",
            r.rehearsal?.promotionVerifiedAt
              ? "Temporary promotion verified; original stable restored and healthy ordinary traffic verified"
              : "Stable allocation and healthy ordinary traffic verified"
          );
        else {
          r.updatedAt = this.p.now();
          await this.p.save(r);
        }
      } else if (r.phase === "verifying_promotion") {
        if (!(await this.checkCurrent(r))) return r;
        r.samples.push(...(await this.p.probe(r, false)));
        const decision = evaluate(r, this.p.now());
        if (decision === "unhealthy")
          await this.move(r, "rolling_back", "Post-promotion health failed");
        else if (
          this.p.now() >=
          r.promotionAt! + r.policy.postPromotionDeadlineMs
        )
          await this.move(
            r,
            "rolling_back",
            "Post-promotion verification deadline expired"
          );
        else if (decision === "healthy") {
          if (r.rehearsal?.preset === "promotion-demo") {
            r.rehearsal.promotionVerifiedAt = this.p.now();
            await this.move(
              r,
              "rolling_back",
              "Temporary promotion health verified; automatically restoring original stable for the next reviewer"
            );
          } else
            await this.move(r, "promoted", "Post-promotion health verified");
        } else await this.p.save(r);
      } else {
        if (!(await this.checkCurrent(r))) return r;
        if (
          this.p.now() >= r.canaryAt! + r.policy.maxCanaryMs ||
          (r.approval && this.p.now() >= r.approval.expiresAt)
        ) {
          delete r.approval;
          await this.move(
            r,
            "rolling_back",
            "Canary or approval deadline expired"
          );
        } else {
          r.samples = [...r.samples, ...(await this.p.probe(r, false))].filter(
            (s) => s.at >= this.p.now() - r.policy.windowMs
          );
          const decision = evaluate(r, this.p.now());
          if (decision === "unhealthy") {
            delete r.approval;
            await this.move(r, "rolling_back", "Health policy failed");
          } else if (decision === "healthy" && r.phase === "canary") {
            r.approval = {
              id: this.p.uuid(),
              expiresAt: this.p.now() + r.policy.approvalMs
            };
            await this.move(
              r,
              "awaiting_approval",
              "Health policy passed; human approval required"
            );
          } else if (
            decision === "inconclusive" &&
            r.phase === "awaiting_approval"
          ) {
            delete r.approval;
            await this.move(
              r,
              "canary",
              "Evidence became inconclusive; approval invalidated"
            );
          } else {
            r.updatedAt = this.p.now();
            r.reason = `Health ${decision}`;
            await this.p.save(r);
          }
        }
      }
    } catch (error) {
      r.failure = {
        phase: r.phase,
        message:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Unexpected operation failure",
        at: this.p.now()
      };
      if (
        r.phase === "analyzing" ||
        r.phase === "validating" ||
        r.phase === "smoke"
      )
        await this.move(
          r,
          "rejected",
          "PR analysis or validation unavailable; no traffic changed"
        );
      else if (
        r.intent &&
        this.p.now() - r.intent.at < r.policy.mutationConfirmationMs
      )
        await this.p.save(r);
      else
        await this.move(
          r,
          "needs_attention",
          "Cloudflare state unavailable; lock retained for reconciliation"
        );
    }
    return r;
  }
  async reconcile(runId: string) {
    const r = await this.p.load();
    if (!r || r.id !== runId || r.phase !== "needs_attention")
      throw new Error("Run does not need reconciliation");
    const actual = await this.p.current();
    // Stable allocation starts a new bounded traffic check; it cannot release the lock.
    if (
      r.stable &&
      sameAllocation(actual.versions, stableAllocation(r)) &&
      (!r.intent ||
        actual.annotations?.["workers/message"] === r.intent.message)
    ) {
      r.expected = actual;
      delete r.intent;
      delete r.approval;
      await this.beginRollbackVerification(r);
    } else if (
      r.intent &&
      actual.annotations?.["workers/message"] === r.intent.message &&
      sameAllocation(actual.versions, r.intent.versions)
    ) {
      r.expected = actual;
      delete r.intent;
      delete r.approval;
      await this.move(
        r,
        "rolling_back",
        "Recovered own mutation; conservatively restore stable"
      );
    } else
      throw new Error(
        "Unresolved deployment; restore stable externally, then reconcile"
      );
    return r;
  }
}
