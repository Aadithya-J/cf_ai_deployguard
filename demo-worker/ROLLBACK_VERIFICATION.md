# Live automatic rollback verification — 2026-09-25

## Result

**The deployed controller automatically rolled back a real failing canary.** The healthy PR #1 version is restored to 100%, confirmed through both Cloudflare's deployment API and subsequent ordinary traffic.

- Backend: `deployguard.jlaadithya.workers.dev`; existing deployed backend unchanged.
- Target: `deployguard-demo-target`.
- Healthy stable: `eb3a0ea3-b238-40c0-833e-62dc61c7f35e` (previously promoted PR #1).
- Failing candidate: `5cbecc7e-00f5-41dc-a285-6b0480b31342`.
- Persisted run: `4f3d2c8a-c89c-4529-9dd7-0dcdb1f271d7`.
- Canary deployment: `3e5046c2-6dcb-45d2-80c5-ef8c45d1aa98`.
- Final rollback deployment: `e5aac3dc-dc3f-4e98-b029-808c15661d99`.

Read the persisted run with authenticated `GET /api/deployment/4f3d2c8a-c89c-4529-9dd7-0dcdb1f271d7`; it also appears in deployment history.

## Fault and scope

The opt-in `fixtures/canary-failure.ts` entry point wraps the existing demo Worker. Preview health stays healthy. At the normal target hostname, `/health` returns HTTP 200 with `ok: false`. Version UUID, release, request ID, cache policy and greeting responses remain intact. This deliberately violates the existing critical endpoint assertion, without changing controller code or safety policy.

No new binding, data store, secret, control endpoint, dependency or runtime toggle was introduced. The default Worker entry point is unchanged. Uploading this version did not change production traffic. The controller then performed all canary and rollback mutations itself. No manual rollback or approval was submitted.

This is an explicit environment-dependent fault fixture, not an organic bug in PR #1. The run is candidate-only and deliberately has no PR/AI association. The earlier successful run already verified those integrations.

## Persisted sequence

| UTC               | Transition / observation                                                   |
| ----------------- | -------------------------------------------------------------------------- |
| 07:37:03          | Candidate run accepted and persisted in `validating`                       |
| 07:37:08          | Candidate validated; `smoke`                                               |
| 07:37:13          | Preview smoke passed; `starting_canary`                                    |
| 07:37:19          | Real 90% stable / 10% candidate confirmed; `canary`                        |
| 07:37:23          | Stable probes passed; first candidate probes were unattributed (`unknown`) |
| 07:37:28          | Attributed candidate `/health` assertion failed; `rolling_back`            |
| 07:37:34          | Cloudflare API confirmed stable 100%; `rolled_back`                        |
| 07:38:17–07:38:40 | Twenty consecutive ordinary health requests returned healthy stable        |

The run retained eight samples: four stable passes, two candidate unknowns, one candidate greeting pass, and one candidate health assertion failure. The critical assertion triggered rollback before the normal HTTP-rate minimum sample count. The run never entered approval or promotion.

Final API allocation, deployment UUID and `deployguard:<run-id>:rolling_back` annotation matched the controller's persisted confirmation. Later history and run reads returned the same terminal record.

## Actual limitation discovered: routing propagation

The verification client's **first ordinary request after API-confirmed rollback still returned the failing candidate UUID**. Its immediate-stable assertion failed. A follow-up verification began at 07:38:17 UTC and all twenty requests returned healthy stable; the control-plane deployment remained unchanged.

We did not continuously sample the interval, so this does **not** measure an exact propagation duration. Likewise, the initial unknown candidate samples show attribution was unavailable at first; their precise cause is not retained by the current sample model.

The controller currently uses `rolled_back` to mean allocation confirmed by the control plane. It does not automatically verify restored traffic after rollback, and releases the run lock at that point. This rehearsal confirms automatic rollback and eventual observed traffic restoration, not instantaneous or global convergence.

**Recommended follow-up before dashboard completion:** a bounded `verifying_rollback` phase using ordinary requests, retaining the lock until healthy stable traffic is observed, with `needs_attention` on timeout. Do not issue repeated rollback writes merely because routing is still propagating. The dashboard should distinguish allocation confirmation from observed traffic recovery. This change was not introduced in this fault-only rehearsal.

## Checks

- Fixture test passed: preview health, production health failure, greeting success, and response attribution.
- Fixture and test TypeScript checks passed; demo TypeScript/lint/format checks passed.
- Wrangler upload succeeded as a new version; initial production allocation remained healthy stable 100%.
- Actual deployed lifecycle reached `rolled_back` deterministically, with persisted failed evidence and matching Cloudflare state.
- Twenty consecutive final ordinary requests returned HTTP 200, `ok: true`, and the stable UUID in both headers and body.
- Failing version remains uploaded and preview-addressable, but has zero production allocation. It is available for later explicit rehearsals.

[Cloudflare version override documentation](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/) was consulted: overrides select active versions and callers must check returned attribution. No failure-rate thresholds or safety requirements were relaxed.
