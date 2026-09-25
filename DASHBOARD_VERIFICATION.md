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
