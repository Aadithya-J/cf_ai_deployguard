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
