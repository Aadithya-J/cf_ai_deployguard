import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Lifecycle,
  POLICY,
  ROLLBACK_POLICY,
  rollbackHealthy,
  ENDPOINTS,
  evaluate,
  type Run,
  type Deployment,
  type Ports,
  type Sample,
  type Allocation
} from "./lifecycle.ts";

const STABLE = "11111111-1111-4111-8111-111111111111";
const CANDIDATE = "22222222-2222-4222-8222-222222222222";
function fixture() {
  let now = 1_000_000;
  let saved: Run | undefined;
  let actual: Deployment = {
    id: "initial",
    versions: [{ version_id: STABLE, percentage: 100 }]
  };
  let outcome: Sample["outcome"] = "pass";
  let mutation: "normal" | "lost-response" | "not-applied" = "normal";
  let readsFail = false;
  let candidateInvalid = false;
  const writes: Allocation[] = [];
  const ports: Ports = {
    now: () => now,
    uuid: () => crypto.randomUUID(),
    load: async () => (saved ? structuredClone(saved) : undefined),
    save: async (r) => {
      saved = structuredClone(r);
    },
    current: async () => {
      if (readsFail) throw new Error("API unavailable");
      return structuredClone(actual);
    },
    validateVersion: async () => {
      if (candidateInvalid) throw new Error("404");
    },
    deploy: async (versions, message) => {
      writes.push(versions);
      if (mutation !== "not-applied")
        actual = {
          id: crypto.randomUUID(),
          versions,
          annotations: { "workers/message": message }
        };
      if (mutation !== "normal") throw new Error("Timed out");
    },
    probe: async (r, preview) =>
      (r.phase === "verifying_rollback"
        ? [r.stable]
        : preview || r.phase === "verifying_promotion"
          ? [r.candidate]
          : [r.stable, r.candidate]
      ).flatMap((version) =>
        ENDPOINTS.map((endpoint) => ({
          id: crypto.randomUUID(),
          at: now,
          version,
          observedVersion: version,
          endpoint,
          outcome,
          latencyMs: 100
        }))
      )
  };
  const engine = new Lifecycle(ports);
  return {
    engine,
    ports,
    writes,
    get run() {
      return structuredClone(saved!);
    },
    advance: (ms: number = POLICY.intervalMs) => {
      now += ms;
    },
    setOutcome: (value: typeof outcome) => {
      outcome = value;
    },
    setMutation: (value: typeof mutation) => {
      mutation = value;
    },
    setReadsFail: (value: boolean) => {
      readsFail = value;
    },
    invalidateCandidate: () => {
      candidateInvalid = true;
    },
    drift: () => {
      actual = { ...actual, id: "external-deployment" };
    },
    restoreExternally: () => {
      actual = {
        id: "manual-stable",
        versions: [{ version_id: STABLE, percentage: 100 }]
      };
    },
    now: () => now
  };
}
async function canary(f: ReturnType<typeof fixture>) {
  await f.engine.start(CANDIDATE);
  await f.engine.tick(); // validate
  await f.engine.tick(); // smoke
  await f.engine.tick(); // create and confirm canary
  assert.equal(f.run.phase, "canary");
}
async function healthy(f: ReturnType<typeof fixture>) {
  await canary(f);
  for (let i = 0; i < POLICY.minPerEndpoint; i++) {
    f.advance();
    await f.engine.tick();
  }
  assert.equal(f.run.phase, "awaiting_approval");
}

async function finishRollback(f: ReturnType<typeof fixture>) {
  assert.equal(f.run.phase, "verifying_rollback");
  f.setOutcome("pass");
  for (let i = 0; i < ROLLBACK_POLICY.minPerEndpoint; i++) {
    f.advance();
    await f.engine.tick();
  }
  assert.equal(f.run.phase, "rolled_back");
}

test("healthy canary waits for explicit approval, then confirms candidate 100%", async () => {
  const f = fixture();
  await healthy(f);
  assert.equal(f.writes.length, 1);
  const r = f.run;
  await f.engine.approve(r.id, r.approval!.id);
  assert.equal(f.run.phase, "promoting");
  await f.engine.tick();
  assert.equal(f.run.phase, "verifying_promotion");
  for (let i = 0; i < POLICY.postPromotionSamples; i++) {
    f.advance();
    await f.engine.tick();
  }
  assert.equal(f.run.phase, "promoted");
  assert.deepEqual(f.writes[1], [{ version_id: CANDIDATE, percentage: 100 }]);
  assert.equal(f.run.expected!.versions[0].version_id, CANDIDATE);
  await f.engine.tick();
  assert.equal(f.writes.length, 2);
});
test("unhealthy canary rolls back and only completes after stable read-back and traffic", async () => {
  const f = fixture();
  await canary(f);
  f.setOutcome("assertion_failure");
  f.advance();
  await f.engine.tick();
  assert.equal(f.run.phase, "rolling_back");
  await f.engine.tick();
  await finishRollback(f);
  assert.deepEqual(f.writes.at(-1), [{ version_id: STABLE, percentage: 100 }]);
});
test("inconclusive evidence cannot promote; fixed deadline restores stable", async () => {
  const f = fixture();
  await canary(f);
  f.setOutcome("unknown");
  for (let i = 0; i < 12; i++) {
    f.advance();
    await f.engine.tick();
  }
  assert.equal(f.run.phase, "canary");
  assert.equal(f.run.approval, undefined);
  f.advance(POLICY.maxCanaryMs);
  await f.engine.tick();
  await f.engine.tick();
  await finishRollback(f);
});
test("stale approval: wrong run, wrong token, expired evidence and replay are rejected", async () => {
  const f = fixture();
  await healthy(f);
  const r = f.run;
  await assert.rejects(f.engine.approve("other", r.approval!.id), /Stale/);
  await assert.rejects(f.engine.approve(r.id, "other"), /Stale/);
  f.advance(POLICY.freshnessMs + 1);
  await assert.rejects(f.engine.approve(r.id, r.approval!.id), /fresh/);
  f.advance(POLICY.approvalMs);
  await f.engine.tick();
  await f.engine.tick();
  await assert.rejects(f.engine.approve(r.id, r.approval!.id), /Stale/);
  await finishRollback(f);
});
test("health loss invalidates an issued approval", async () => {
  const f = fixture();
  await healthy(f);
  const r = f.run;
  f.setOutcome("unknown");
  f.advance();
  await f.engine.tick();
  assert.equal(f.run.phase, "canary");
  await assert.rejects(f.engine.approve(r.id, r.approval!.id), /Stale/);
});
test("delayed promotion alarm rolls back instead of using stale approved evidence", async () => {
  const f = fixture();
  await healthy(f);
  const r = f.run;
  await f.engine.approve(r.id, r.approval!.id);
  f.advance(POLICY.freshnessMs + 1);
  await f.engine.tick();
  await finishRollback(f);
});
test("overlapping runs are rejected before any external calls; lock survives new engine instance", async () => {
  const f = fixture();
  await f.engine.start(CANDIDATE);
  await assert.rejects(new Lifecycle(f.ports).start(CANDIDATE), /active/);
  assert.equal(f.writes.length, 0);
});
test("failed validation and smoke never change production", async () => {
  const f = fixture();
  f.invalidateCandidate();
  await f.engine.start(CANDIDATE);
  await f.engine.tick();
  assert.equal(f.run.phase, "rejected");
  assert.equal(f.writes.length, 0);
  const g = fixture();
  await g.engine.start(CANDIDATE);
  await g.engine.tick();
  g.setOutcome("unknown");
  await g.engine.tick();
  assert.equal(g.run.phase, "rejected");
  assert.equal(g.writes.length, 0);
});
test("lost successful mutation response is recovered through read-back without duplicate POST", async () => {
  const f = fixture();
  f.setMutation("lost-response");
  await canary(f);
  assert.equal(f.writes.length, 1);
  assert.equal(f.run.intent, undefined);
});
test("unconfirmed mutation retains lock and never blindly retries POST", async () => {
  const f = fixture();
  await f.engine.start(CANDIDATE);
  await f.engine.tick();
  await f.engine.tick();
  f.setMutation("not-applied");
  await f.engine.tick();
  assert.equal(f.run.phase, "starting_canary");
  const restarted = new Lifecycle(f.ports);
  f.advance(POLICY.mutationConfirmationMs);
  await restarted.tick();
  assert.equal(f.run.phase, "needs_attention");
  assert.equal(f.writes.length, 1);
  await assert.rejects(restarted.start(CANDIDATE), /active/);
  await assert.rejects(restarted.rollback(f.run.id), /pending/);
  await assert.rejects(restarted.reconcile(f.run.id), /Unresolved/);
});
test("rollback failure is not reported as success and preserves lock", async () => {
  const f = fixture();
  await canary(f);
  await f.engine.rollback(f.run.id);
  f.setMutation("not-applied");
  await f.engine.tick();
  assert.equal(f.run.phase, "rolling_back");
  f.advance(POLICY.mutationConfirmationMs);
  await f.engine.tick();
  assert.equal(f.run.phase, "needs_attention");
  assert.equal(f.writes.length, 2);
});
test("deployment drift blocks approval and rollback rather than overwriting another writer", async () => {
  const f = fixture();
  await healthy(f);
  const r = f.run;
  f.drift();
  await assert.rejects(f.engine.approve(r.id, r.approval!.id), /changed/);
  assert.equal(f.run.phase, "needs_attention");
  assert.equal(f.writes.length, 1);
  await assert.rejects(f.engine.rollback(r.id), /own rollback/);
  f.restoreExternally();
  await f.engine.reconcile(r.id);
  await finishRollback(f);
});
test("control-plane read failure cannot release the lock or report rollback success", async () => {
  const f = fixture();
  await canary(f);
  f.setReadsFail(true);
  await f.engine.tick();
  assert.equal(f.run.phase, "needs_attention");
  assert.equal(f.writes.length, 1);
});
test("sample count, endpoint coverage, freshness and latency boundaries", async () => {
  const f = fixture();
  await healthy(f);
  const r = f.run;
  const now = f.now();
  assert.equal(evaluate(r, now), "healthy");
  assert.equal(
    evaluate(
      { ...r, samples: r.samples.filter((s) => s.endpoint === "/health") },
      now
    ),
    "inconclusive"
  );
  assert.equal(
    evaluate(
      { ...r, samples: r.samples.map((s) => ({ ...s, id: "duplicate" })) },
      now
    ),
    "inconclusive"
  );
  assert.equal(evaluate(r, now + POLICY.windowMs + 1), "inconclusive");
  assert.equal(
    evaluate(
      {
        ...r,
        samples: r.samples.map((s) => ({
          ...s,
          latencyMs: s.version === CANDIDATE ? 201 : 100
        }))
      },
      now
    ),
    "unhealthy"
  );
  assert.equal(
    evaluate(
      { ...r, samples: r.samples.map((s) => ({ ...s, latencyMs: NaN })) },
      now
    ),
    "inconclusive"
  );
});

test("HTTP errors use candidate versus stable thresholds, not any-error rollback", async () => {
  const f = fixture();
  await healthy(f);
  const r = f.run;
  const now = f.now();
  const errors = (stableErrors: number, candidateErrors: number) => {
    const copy = structuredClone(r);
    const used: Record<string, number> = {};
    copy.samples = copy.samples.map((s) => {
      const key = s.version + s.endpoint;
      const i = used[key] ?? 0;
      used[key] = i + 1;
      return {
        ...s,
        outcome:
          i < (s.version === STABLE ? stableErrors : candidateErrors)
            ? "http_error"
            : "pass"
      };
    });
    return copy;
  };
  assert.equal(
    evaluate(errors(1, 1), now),
    "healthy",
    "matching 10% failures do not roll back"
  );
  assert.equal(
    evaluate(errors(0, 1), now),
    "inconclusive",
    "isolated failure waits for evidence"
  );
  assert.equal(
    evaluate(errors(0, 3), now),
    "unhealthy",
    "3 failures with regression roll back"
  );
  assert.equal(
    evaluate(errors(2, 2), now),
    "inconclusive",
    "bad stable baseline cannot authorize promotion"
  );
});
test("post-promotion failure rolls back; missing evidence times out; lock remains held", async () => {
  for (const outcome of ["assertion_failure", "unknown"] as const) {
    const f = fixture();
    await healthy(f);
    const r = f.run;
    await f.engine.approve(r.id, r.approval!.id);
    await f.engine.tick();
    assert.equal(f.run.phase, "verifying_promotion");
    await assert.rejects(f.engine.start(CANDIDATE), /active/);
    f.setOutcome(outcome);
    f.advance();
    await f.engine.tick();
    if (outcome === "unknown") {
      assert.equal(f.run.phase, "verifying_promotion");
      f.advance(POLICY.postPromotionDeadlineMs);
      await f.engine.tick();
    }
    assert.equal(f.run.phase, "rolling_back");
    await f.engine.tick();
    await finishRollback(f);
  }
});

test("old policy runs retain lock and permit only explicit stable restoration", async () => {
  const f = fixture();
  await canary(f);
  const old = f.run;
  Object.assign(old.policy, { version: 1 });
  await f.ports.save(old);
  await f.engine.tick();
  assert.equal(f.run.phase, "needs_attention");
  await f.engine.rollback(old.id);
  await f.engine.tick();
  await finishRollback(f);
});

test("PR run is persisted and locked before analysis; immutable source survives into validation", async () => {
  const f = fixture();
  let analyzed = false;
  f.ports.analyze = async (run) => {
    assert.equal(f.run.phase, "analyzing");
    assert.equal(f.run.id, run.id);
    analyzed = true;
    return {
      analysisId: crypto.randomUUID(),
      commitSha: "a".repeat(40),
      prUrl: run.request!.prUrl
    };
  };
  await f.engine.start(CANDIDATE, undefined, {
    prUrl: "https://github.com/demo/repo/pull/1",
    expectedCommitSha: "a".repeat(40)
  });
  assert.equal(analyzed, false);
  assert.equal(f.run.phase, "analyzing");
  await assert.rejects(f.engine.start(CANDIDATE), /active/);
  await new Lifecycle(f.ports).tick();
  assert.equal(f.run.phase, "validating");
  assert.equal(f.run.source!.commitSha, "a".repeat(40));
  assert.equal(f.run.analysisId, f.run.source!.analysisId);
  await f.engine.tick();
  assert.equal(f.run.phase, "smoke");
  assert.equal(f.writes.length, 0);
});
test("analysis failure rejects a persisted run without any target mutation", async () => {
  const f = fixture();
  f.ports.analyze = async () => {
    throw new Error("GitHub unavailable");
  };
  await f.engine.start(CANDIDATE, undefined, {
    prUrl: "https://github.com/demo/repo/pull/1"
  });
  await f.engine.tick();
  assert.equal(f.run.phase, "rejected");
  assert.equal(f.writes.length, 0);
});

async function rollbackVerification(f: ReturnType<typeof fixture>) {
  await canary(f);
  await f.engine.rollback(f.run.id);
  await f.engine.tick();
  assert.equal(f.run.phase, "verifying_rollback");
}

test("rollback read-back holds the lock across restart until a clean traffic window", async () => {
  const f = fixture();
  await rollbackVerification(f);
  const restarted = new Lifecycle(f.ports);
  await assert.rejects(restarted.start(CANDIDATE), /active/);
  await assert.rejects(restarted.rollback(f.run.id), /verification/);
  for (let i = 0; i < 6; i++) {
    f.advance();
    await restarted.tick();
  }
  assert.equal(f.run.phase, "verifying_rollback");
  assert.equal(rollbackHealthy(f.run, f.now()), false);
  f.advance();
  await restarted.tick();
  assert.equal(f.run.phase, "rolled_back");
  assert.equal(f.writes.length, 2);
  await restarted.start(CANDIDATE);
});

test("candidate/unknown traffic resets the clean window without repeating rollback writes", async () => {
  const f = fixture();
  await rollbackVerification(f);
  for (let i = 0; i < 5; i++) {
    f.advance();
    await f.engine.tick();
  }
  f.setOutcome("unknown");
  f.advance();
  await f.engine.tick();
  const saved = f.run;
  saved.rollbackVerification!.samples.at(-1)!.observedVersion = CANDIDATE;
  await f.ports.save(saved);
  f.setOutcome("pass");
  for (let i = 0; i < 6; i++) {
    f.advance();
    await f.engine.tick();
  }
  assert.equal(f.run.phase, "verifying_rollback");
  f.advance();
  await f.engine.tick();
  assert.equal(f.run.phase, "rolled_back");
  assert.equal(f.writes.length, 2);
});

test("continued candidate traffic, unknown or failed stable traffic times out locked", async () => {
  for (const outcome of [
    "unknown",
    "http_error",
    "assertion_failure"
  ] as const) {
    const f = fixture();
    await rollbackVerification(f);
    f.setOutcome(outcome);
    for (let i = 0; i < ROLLBACK_POLICY.deadlineMs / POLICY.intervalMs; i++) {
      f.advance();
      await f.engine.tick();
    }
    assert.equal(f.run.phase, "needs_attention");
    assert.match(f.run.reason, /did not converge/);
    assert.equal(f.writes.length, 2);
    await assert.rejects(f.engine.start(CANDIDATE), /active/);
    // Reconciliation cannot bypass verification, even at stable 100%.
    await f.engine.reconcile(f.run.id);
    assert.equal(f.run.phase, "verifying_rollback");
    await finishRollback(f);
    assert.equal(f.writes.length, 2);
  }
});

test("rollback needs fresh endpoint coverage; gaps, duplicates and stale samples cannot complete", async () => {
  const f = fixture();
  await rollbackVerification(f);
  for (let i = 0; i < 6; i++) {
    f.advance();
    await f.engine.tick();
  }
  f.advance(20_000);
  await f.engine.tick();
  assert.equal(f.run.phase, "verifying_rollback");
  for (let i = 0; i < 6; i++) {
    f.advance();
    await f.engine.tick();
  }
  assert.equal(f.run.phase, "rolled_back");
  const r = f.run;
  assert.equal(rollbackHealthy(r, f.now()), true);
  for (const transform of [
    (s: Sample[]) => s.filter((x) => x.endpoint === "/health"),
    (s: Sample[]) => s.map((x) => ({ ...x, id: "duplicate" })),
    (s: Sample[]) => s.map((x) => ({ ...x, observedVersion: CANDIDATE })),
    (s: Sample[]) => s.map((x) => ({ ...x, latencyMs: NaN }))
  ]) {
    const copy = structuredClone(r);
    copy.rollbackVerification!.samples = transform(
      copy.rollbackVerification!.samples
    );
    assert.equal(rollbackHealthy(copy, f.now()), false);
  }
  assert.equal(
    rollbackHealthy(r, f.now() + ROLLBACK_POLICY.freshnessMs + 1),
    false
  );
});

test("rollback drift or control-plane outage prevents completion without another write", async () => {
  for (const drift of [true, false]) {
    const f = fixture();
    await rollbackVerification(f);
    if (drift) f.drift();
    else f.setReadsFail(true);
    await f.engine.tick();
    assert.equal(f.run.phase, "needs_attention");
    assert.equal(f.writes.length, 2);
    await assert.rejects(f.engine.start(CANDIDATE), /active/);
  }
});

test("prepared rehearsal refuses changed stable and preserves the normal run lock", async () => {
  const f = fixture();
  await f.engine.start(CANDIDATE, undefined, undefined, {
    preset: "rollback-demo",
    expectedStable: CANDIDATE
  });
  await assert.rejects(() => f.engine.start(CANDIDATE));
  await f.engine.tick();
  assert.equal(f.run.phase, "rejected");
  assert.equal(f.writes.length, 0);
  await f.engine.start(CANDIDATE, undefined, undefined, {
    preset: "rollback-demo",
    expectedStable: STABLE
  });
  await f.engine.tick();
  assert.equal(f.run.phase, "smoke");
});
