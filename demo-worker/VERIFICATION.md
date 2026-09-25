# Live deployment verification

Verified on 2026-09-25 using Wrangler 4.138.0 and the existing Cloudflare login. Only the new disposable target was deployed. No additional storage services, monitoring system, or DeployGuard rollout engine were created.

## Resources and final state

- Production: <https://deployguard-demo-target.jlaadithya.workers.dev>
- Stable: `3ee6a076-7813-41ce-ad03-0e6ed384b31e`, `stable-v1`, greeting `Hello`.
- Candidate: `c1099372-949a-4497-8201-f35ab5c2bc1c`, `candidate-v2`, greeting `Hi`.
- Candidate preview: <https://c1099372-deployguard-demo-target.jlaadithya.workers.dev>
- Final deployment: `5fb892ae-7d5a-4809-a5e6-39159b7203d0`, created at `2026-09-25T05:53:49.7942Z`, **stable 100%**.

The candidate changes versioned environment variables, using the same source bundle. This proves the Versions/Deployments flow; it does not test building a candidate from a GitHub PR.

## Observed sequence

| Step                                    | Evidence                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Create target and deploy stable         | Initial deployment `22c05edd-4a11-4484-8182-19558b4e63f1`, stable 100%                                                                |
| Baseline                                | First 20 attempts: 19 valid stable responses, one client `fetch failed` without a response. Fresh batch: 20/20 valid stable responses |
| Upload candidate without deploying      | API still reported the same initial deployment; production 20/20 stable                                                               |
| Independent candidate smoke test        | Preview 20/20 candidate; health and greeting payloads correct                                                                         |
| Real 90/10 deployment                   | Deployment `1b7574b1-d9e1-493a-a181-408e46285e03`; 200 ordinary requests: **178 stable, 22 candidate**, zero validation errors        |
| Explicit version overrides during split | 10/10 candidate and 10/10 stable as requested                                                                                         |
| Restore stable                          | API confirmed stable 100%; 40/40 ordinary requests reached stable                                                                     |
| Candidate override after restore        | 5/5 reached stable: inactive override fell back to normal routing                                                                     |
| Candidate preview after restore         | 5/5 still reached candidate                                                                                                           |
| Error responses                         | 400, 404 and 405 retained correct stable version attribution                                                                          |

Probes alternated `/health` and `/api/greeting?name=DeployGuard`, with concurrency five. They checked HTTP status, endpoint payload, matching header/body UUID and release, matching request ID, and `no-store`. Ordinary split requests did not set version overrides or affinity.

Split results by endpoint: stable received 87 health and 91 greeting requests; candidate received 13 health and 9 greeting requests. Client round-trip p50/p95 was 342.74/903.49 ms for stable and 247.96/903.78 ms for candidate. These include network and client overhead; 22 candidate samples do not establish a performance advantage or production health. The initial transport failure cannot be attributed to either runtime version or a server-side cause.

## Free-plan telemetry assessment

| Source                               | Verified capability                                                                                                          | Appropriate use and limitation                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Synthetic HTTP probes                | Exact response version, status, expected body, request ID and client round-trip time                                         | Strong V1 validation input for the observed requests. No response means attribution can be unknown; never treat it as a successful candidate check                                                                                                                                               |
| `wrangler tail`                      | `scriptVersion.id`, runtime outcome, exceptions, CPU/wall time, HTTP response and structured application log                 | All 200 split requests appeared, matching 178/22 exactly. Interactive, nonpersistent and subject to sampling/drop at volume; not a durable monitoring backend                                                                                                                                    |
| GraphQL `workersInvocationsAdaptive` | Queries succeeded with `dimensions { scriptVersion status }`, `sum { requests errors }`, and CPU/wall-time p50/p99 quantiles | Per-version aggregate runtime health is available with current credentials. One snapshot returned stable 295 requests / 0 errors and candidate 57 / 0, across the entire verification window. These are not the isolated 200-request split batch; sampling and aggregation affect interpretation |
| Workers Logs                         | Enabled in target config at head sampling 1; documented Free allowance is 200,000 log events/day with three-day retention    | Structured `version_id`, route and status support HTTP-level investigation. REST query attempt returned 403 / code 10000 with current credentials; stored-log retrieval was not verified                                                                                                         |
| Tail Worker / Workers Logpush        | Documented paid-plan facilities                                                                                              | Excluded from the Free-plan V1                                                                                                                                                                                                                                                                   |

GraphQL window used `2026-09-25T05:45:00Z` through `2026-09-25T06:00:00Z`. An unbounded query was rejected for exceeding the account's allowed query window; always supply explicit time bounds. Returned aggregate timing values require the schema's units when displayed; CPU time and Worker wall time are different from probe round-trip latency.

The 400/404/405 probes all produced runtime outcome `ok`. A normal returned HTTP error is not a runtime exception. Therefore aggregate runtime `errors` alone cannot establish endpoint success or the HTTP 5xx rate. Use probe results and structured status logs for those checks. Distinguish intentional invalid-input probes from failed normal traffic.

The stored-log API documents **Workers Observability Write** permission. The current Wrangler OAuth scopes do not include that permission; the observed 403 is an access limitation, not proof that the Free plan lacks logs. No credentials were refreshed or permissions expanded. At this target's logging level, an invocation and one console event consume approximately two log events per request, before any additional platform events.

Official references: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [real-time logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/), [GraphQL Workers metrics](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/), [metrics semantics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), [telemetry query permissions](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/), [Tail Workers](https://developers.cloudflare.com/workers/observability/logs/tail-workers/), and [Logpush](https://developers.cloudflare.com/workers/observability/logs/logpush/).

## Constraints and V1 implications

1. Cloudflare performs weighted routing per request; a configured 90/10 split need not yield exactly 180/20 in 200 requests. DeployGuard must require enough candidate samples before deciding. Gradual deployments support at most two versions, selected from the eligible recent versions. [Gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/)
2. Version URLs allow pre-traffic smoke tests, but do not provide Workers Logs, Wrangler tail or Logpush logs. The five post-restore preview probes were absent from the live tail, while production probes appeared. Preview URLs share bound resources and are not data isolation. Workers that implement Durable Objects cannot use these version URLs; this stateless target can. [Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
3. Version overrides only select versions in the current deployment, including a version assigned 0%. The 0% staging option was documented but not exercised here. Inactive overrides silently fall back, as observed; assert returned version IDs. [Version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/)
4. Rolling back code/configuration does not reverse data writes. This target is deliberately stateless. Its response UUID comes from Cloudflare's metadata binding, not a manually invented release label. [Versions](https://developers.cloudflare.com/workers/versions-and-deployments/) and [version metadata](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/)
5. Workers Free has 100,000 requests/day and 10 ms CPU per invocation. Keep generated traffic bounded and account for other Workers sharing the account quota. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

For the scoped V1, use one configured account and target, direct version-attributed probes for deterministic validation, and per-version GraphQL metrics as supporting runtime evidence. Store deployment history and small aggregate probe results in the existing Agent's SQLite storage when that feature is built. Use stored logs for investigation after access is resolved. D1, R2, multiple projects and a paid Tail Worker are unnecessary for this demo. Missing, delayed or insufficient telemetry must produce an inconclusive/hold result, not automatic promotion.

## Checks and evidence

Target generated types, TypeScript, lint and formatting passed via `npm run demo:check`. Root starter checks passed via `npm run check`. Live probes above verified deployment behavior and the error response contract. This run did not inject a failing canary or test automatic safety rules.

Raw probe records, deployment API snapshots and tail output are local ignored artifacts in `.wrangler/demo-verification/`; they are not a deployed monitoring service. No secrets are included in this report. The target remains deployed at stable 100%, with its candidate preview available for further disposable testing.
