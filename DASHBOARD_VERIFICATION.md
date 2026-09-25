# Minimal dashboard verification — 2026-09-25

## Delivered interface

The dashboard is the default application at https://deployguard.jlaadithya.workers.dev. Deployed application version: `1d1f4523-5913-4daf-8387-931be4ece89c`. It provides:

- Searchable deployment history and an explicitly labeled current/historical run view.
- Immutable PR metadata, Llama 3.3 advisory analysis, risk estimate, affected areas, failure modes and catalog suggestions.
- Version-attributed health tables: samples, HTTP errors, p95 latency, assertions and unknown evidence for each endpoint/version.
- Persisted phase, reason, version allocation, deadlines and transition timeline.
- New-run form for uploaded candidate UUID, optional PR URL and expected head SHA.
- Explicit confirmation for promotion, stable restoration and reconciliation, using existing controller endpoints.
- Rollback verification status and evidence, including the original failed canary observations.
- Secondary **Ask DeployGuard** panel with persistent, read-only deployment chat.

The interface refreshes after commands and polls five seconds after each completed read. Network calls have a 20-second bound. Controls are disabled on failed refresh or data older than 15 seconds, on historical selections, or when the backend does not allow the action. Approval also checks the displayed deadline; the backend remains authoritative and independently validates every command. Accepted requests are shown as accepted, not completed.

## Minimal backend gaps addressed

1. **Browser authentication:** `/api/session` exchanges the existing admin token for an eight-hour HMAC-signed, HttpOnly, SameSite=Strict cookie, Secure on HTTPS. Cookie writes and WebSocket upgrades require same origin. Cloudflare/GitHub tokens remain server-side; the admin token is not persisted in browser storage. Existing bearer API clients remain supported.
2. **Stored-deployment questions:** the existing ChatAgent has only `listDeployments` and `getDeployment` tools, reading the existing singleton controller endpoints. The authenticated `deployguard-inspector` conversation is separate from old starter conversations. The generic starter weather, scheduling, arithmetic, image and MCP interface was removed. No model tool can invoke a deployment mutation.

No new storage binding, dependency, lifecycle phase, deployment policy, GitHub capability or telemetry pipeline was added for the dashboard.

## Checks performed

### Automated code checks

- **42 tests passed**, including existing lifecycle/analysis tests and new session signature, tampering, expiration, secret rotation, CSRF/origin, cookie and bearer compatibility tests.
- `npm run check`: TypeScript, lint and formatting passed.
- `npm run deploy`: frontend and Worker built and deployed successfully.

### Browser checks with intercepted API fixtures

Used real recorded run data for desktop (1440px) and mobile (390px). Only transient pending states were synthesized; mutation requests were intercepted and never reached the target.

- History selection loads PR analysis and preserves the current/historical distinction.
- No page-level horizontal overflow at either viewport; wide evidence tables scroll within their own region.
- Approval submits the displayed run ID and approval ID.
- Canceling rollback confirmation makes no mutation request.
- Refresh failure disables approval and exposes a retry path.
- `verifying_rollback` displays target lock and disables starting another deployment.
- No browser page errors.

Independent UI review found and resolved a screen-reader announcement issue in the elapsed timer and repeated cancellation of slow polling requests. The follow-up review marked those fixes resolved. Original canary evidence, neutral advisory suggestions, narrow-screen chat scrolling and logout failure handling were also verified.

### Actual deployed browser path

Verified through the real Worker and Durable Object:

- Anonymous deployment and chat reads returned **401**.
- Sign-in succeeded with the dedicated admin token, and the browser cookie had HttpOnly, Secure and SameSite=Strict attributes.
- No token was placed in localStorage; login survived a page reload.
- Dashboard loaded the actual persisted rollback run `2ecad2e3-6d39-4639-9fac-fad35fe2061d` and its `rolled_back` outcome.
- The real Workers AI chat retrieved the record and correctly answered that the outcome was `rolled_back`, with stable version `eb3a0ea3-b238-40c0-833e-62dc61c7f35e` restored, citing the run ID.
- Sign-out cleared access; subsequent deployment reads returned **401**.
- No JavaScript page errors and **no deployment mutation requests** during the live dashboard check.

Browser evidence and screenshots are retained locally under ignored `.wrangler/dashboard-screens/`. The temporary browser tooling was installed outside the repository; no browser automation package was added to application dependencies.

## Remaining limits

- This is shared single-operator authentication, not per-user identity, roles, SSO or approval attribution. Cookie logout does not revoke an independently copied cookie; expiry or admin-token rotation does.
- Health is sampled synthetic evidence from one coordinator. Displayed allocation is the last persisted confirmation, not an independent global routing query. Historical outcome semantics remain those of their stored policy version.
- History remains capped at the backend's 100-record limit without pagination.
- Read-only AI answers may be wrong. Suggested checks are not evidence of execution, and version/commit association is still operator supplied.
- No new live deployment was initiated just to exercise UI buttons. Mutation payloads and confirmations were checked with intercepted responses; the controller's real promotion/rollback behavior was verified in the earlier live rehearsals.

## Public reviewer demo — 2026-09-25

Deployed application version: `040abeee-6289-482d-8426-98b930035537`.

The default unauthenticated dashboard now offers successful PR #1 review, failed-canary review, and a prepared live rollback rehearsal. No new PR or candidate upload is required. Admin sign-in remains available for ordinary deployment controls. Public chat has isolated signed-cookie conversations and only public read tools. Authentication follows Cloudflare's [same-origin Agent cookie guidance](https://developers.cloudflare.com/agents/runtime/operations/cross-domain-authentication/).

### Verification

- `npm run check`: passed; `npm test`: 48 passed.
- Browser: desktop 1440px and mobile 390px, no page overflow or JavaScript errors. Public history, PR analysis and recovery evidence loaded. Mobile header wrapping corrected during verification.
- Public `start`, `approve`, `rollback`, `reconcile` requests returned 401. Tests also cover analysis mutation protection, exact read-path whitelist, chat isolation, cookie privilege separation, custom rehearsal parameter rejection and public record redaction.
- The browser started the real rehearsal without an admin session. Duplicate start returned 409. Run persisted as `999dfca8-b9d8-42e3-8e6a-40d6979f6b1b`.
- Stored lifecycle: validating → smoke → starting_canary → canary → rolling_back → verifying_rollback → rolled_back. Preview passed; the normal-traffic health assertion failed as intended.
- Cloudflare recorded 90% stable / 10% candidate in deployment `f7aa58c2-a5c5-4c5b-9c62-1a65917d2f7c`.
- Final Cloudflare deployment `01c9088f-0e50-4d86-8cfb-fd3a3e058fa4` confirmed stable `eb3a0ea3-b238-40c0-833e-62dc61c7f35e` at 100%.
- Recovery retained 20 samples. Three early responses still identified candidate `5cbecc7e-00f5-41dc-a285-6b0480b31342`, including one about 15 seconds after control-plane confirmation. These reset the clean window. Fourteen later stable passes covered both endpoints over 30 seconds; the lock remained held approximately 50 seconds after API confirmation.
- Public Workers AI chat retrieved this stored run and correctly reported `rolled_back` and the restored stable UUID.

### Boundaries

Rehearsal inputs are server-pinned, including the expected stable version. A changed stable rejects validation without deployment mutation. Existing durable locking applies; a persisted five-minute cooldown is recorded atomically with the run. An unexpected healthy rehearsal still follows the existing approval timeout; public reviewers cannot promote it. `needs_attention` requires admin investigation.

This is shared activity on the disposable target. Public chat's 20-question conversation budget is not global abuse protection. Synthetic recovery samples are local observations, not proof of worldwide convergence. Prepared review shortcuts search the existing capped 100-run history; a long-running public installation would need a deliberate retention/pinning policy to preserve the original examples.

## Repeatable PR rehearsals — 2026-09-25

Application version: `ccbe64ee-eb25-4764-9beb-d46ba1730a41`. Both presets now include pinned PR analysis. The new healthy preset permits bounded public approval, a real temporary 100% deployment, post-promotion verification and automatic stable restoration. The original admin workflow is unchanged.

- `npm run check` passed; 53 tests passed. New coverage includes the complete healthy reset lifecycle across engine restart, stale/replayed approvals, rejection of ordinary-run public approval, abandoned approval, reset timeout retaining the lock, strict public command input and limited demo approval projection.
- Failure PR: https://github.com/Aadithya-J/cf_ai_deployguard/pull/3 at `c1abd8a4e4500826f82346283952f9f8fe6cc792`; candidate `366a3cce-118d-41f6-bef6-63d6f836703b`.
- Public failure run: `a69d8c65-68f2-4007-8a5b-4a9ae8bdf2d3`. Workers AI returned structured high-risk advisory analysis. Candidate greeting probes recorded 9 HTTP errors / 10 requests versus stable 0 / 10; both health endpoints passed. Deterministic HTTP thresholds triggered rollback. Fourteen ordinary stable recovery samples verified restoration. Final outcome `rolled_back`.
- Desktop and 390px mobile inspection confirmed visible PR analysis and recovery evidence, no page overflow and no JavaScript errors.
- Failure probability is deliberately 70%, not an exact promised sample percentage. Preview requests bypass the injected fault so the canary exercises HTTP error policy. The failure is explicitly labeled in PR #3; this is a controlled demonstration, not a production workload.
- Both presets share the existing five-minute cooldown and durable run lock. Approval is limited to the healthy preset and expires under the ordinary freshness/deadline rules. Other visitors may approve the shared prepared run; these are public reviewer controls, not individual ownership or authorization identities.
- Healthy PR: https://github.com/Aadithya-J/cf_ai_deployguard/pull/2 at `e74b06b394e52c6c7d2427d49dba63e844f7c39c`; candidate `892838ac-3d86-4c35-ae7a-947e3e9611a7`.
- After waiting for the real shared cooldown, public healthy run `219b24af-c9e4-4374-a9c3-fde9ac6834dc` completed PR analysis (low advisory risk), smoke and canary. The public browser used **Approve demo → Confirm temporary promotion**. Cloudflare deployment `bc3df8ed-0f62-4c74-9be4-48a7acc9293c` independently confirmed candidate at 100%.
- Browser reload during promotion did not stop progress. About 35 seconds of post-promotion verification passed, then the controller automatically restored stable. Sixteen ordinary recovery samples verified the reset. Final run outcome: `demo_complete`.
- Final deployment `2ce4a483-d634-4a0b-9db7-ce871be311a2` restored original stable `eb3a0ea3-b238-40c0-833e-62dc61c7f35e` at 100%. No manual recovery was needed. Both run records and PR analyses are publicly reviewable.
- Final UI copy uses **Health evidence before restoration** for retained evidence, covering both canary failure and verified-promotion reset without mislabeling promotion probes as canary probes.

Final application version after the evidence-label clarification: `774168b7-6c50-4059-a946-a0233ed6ef6c`. Formatting, lint and TypeScript passed again before deployment; no deployment-controller behavior changed after the two live checks.

## No delay after completion

Removed the five-minute cooldown at the user's request. Both presets now become available as soon as the prior run is terminal; active runs and `needs_attention` still retain the target lock. The controller no longer checks saved cooldown timestamps and returns `availableAt: 0` for compatibility with older clients, including previously stored metadata. The UI no longer applies a timestamp gate or shows a cooldown countdown.

`npm run check` passed and all 54 tests passed. The added regression verifies that starting during recovery is rejected, while the next prepared demo is accepted at the exact same clock time as successful recovery completion. This supersedes cooldown behavior documented in the earlier live reports above.
