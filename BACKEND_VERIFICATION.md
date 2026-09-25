# Deployed backend verification — 2026-09-25

## Scope and result

The real `deployguard` Worker and its singleton SQLite Durable Object performed GitHub retrieval, Workers AI analysis, candidate validation, smoke testing, a Cloudflare percentage deployment, health evaluation, explicit test approval, full promotion and post-promotion verification. Local files were only the test client's evidence; the authoritative run and analysis are stored remotely.

- Backend: https://deployguard.jlaadithya.workers.dev
- Target: `deployguard-demo-target` in the existing single account.
- PR: https://github.com/Aadithya-J/deployguard/pull/1
- Captured commit: `6da8ddb71532d280df82f33fc38ba211b38431f4`
- Candidate: `eb3a0ea3-b238-40c0-833e-62dc61c7f35e`
- Original stable: `3ee6a076-7813-41ce-ad03-0e6ed384b31e`
- Persisted run: `c59bccf7-86cf-4aa1-9bd9-29d63b184f99`
- Persisted analysis: `fe0e0b87-b82c-44b7-989a-e2ecf279b4d7`
- Outcome: **promoted**. The target now serves the PR candidate at **100%**; this test did not restore the old version afterward.

## Observed lifecycle

Times are UTC, rounded to seconds. These transitions come from the persisted run's event history, including phases too brief to observe in client polling.

| Time     | Event                                                              |
| -------- | ------------------------------------------------------------------ |
| 07:23:56 | Run persisted in `analyzing`; target lock acquired                 |
| 07:24:07 | Immutable PR analysis persisted; candidate validated               |
| 07:24:12 | Candidate version URL smoke checks passed                          |
| 07:24:18 | Actual stable 90% / candidate 10% deployment confirmed             |
| 07:25:07 | Canary policy passed with 40 samples; approval required            |
| 07:25:13 | Authenticated test client submitted explicit approval              |
| 07:25:18 | Candidate 100% deployment confirmed; post-promotion checking began |
| 07:25:52 | Post-promotion checks passed; run became `promoted`                |

The test client exercised the human approval API for this authorized rehearsal. The model did not submit approval or choose any deployment action.

Cloudflare's canary deployment ID was `15c95936-b43d-45cd-8589-7530150e3afe`. An independent batch of 100 ordinary `/health` requests, without version overrides, reached stable 86 times and candidate 14 times; all returned HTTP 200 with version attribution. Finite random samples need not match the configured percentage exactly.

Final deployment ID: `ef62d217-3eab-468d-abff-23a8d69bdaa9`, candidate 100%. The post-promotion window lasted approximately 35 seconds and collected 14 passing requests, seven per endpoint. Canary probes used explicit version overrides; post-promotion probes used ordinary production routing and a frozen stable baseline.

## Persistence across backend deployment

After the successful run, the backend was redeployed as version `9f2db4dd-1e32-42af-a733-e4b846fc31af`. At 07:27:52 UTC, authenticated reads returned an identical run and analysis, and all three attempts remained in history. The target deployment ID was unchanged. A further 20 ordinary requests all returned HTTP 200 and the candidate UUID in both headers and body. This verifies remote durable persistence across a backend deployment; it does not claim that a forced crash was tested.

## API and safety verification

- Unauthenticated read: HTTP 401.
- Second start while the run was active: HTTP 409.
- Incorrect approval token: HTTP 409.
- Correct approval for current run/evidence: HTTP 202.
- Replayed approval after completion: HTTP 409.
- Historical run endpoint and history list returned the persisted terminal record.
- Both deployment mutations were confirmed through Cloudflare's API with expected allocation and run annotation.
- No rollback was induced in this live successful run. Automated tests cover unhealthy/inconclusive outcomes, rollback, rollback failure, stale evidence, ambiguous mutations and external drift.

Frontend read endpoints (admin bearer required):

| Endpoint                          | Contents                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `GET /api/deployment/state`       | Current run, linked analysis, health decision/counts, deadlines, allowed actions |
| `GET /api/deployment/<run-id>`    | Same combined view for a stored run                                              |
| `GET /api/deployment/history`     | Stored runs, currently limited to 100                                            |
| `GET /api/analysis/<analysis-id>` | Immutable PR association and structured advisory output                          |

The view is persisted evidence, not a new Cloudflare control-plane query. Commands independently recheck safety. Terminal `health.decision` is null; the recorded outcome and evidence remain available.

## PR analysis result

Workers AI Llama 3.3 returned schema-valid **medium** risk advice: the greeting input validation could change endpoint behavior, with invalid-input, greeting-contract, attribution, error-rate, latency and health checks suggested. The exact response is in the persisted analysis record.

The output still suggested all six catalog checks and described “non-UTF-16 characters,” an imprecise claim about JavaScript strings. Treat this as advisory text requiring review, not a factual diagnosis. The controller ignored the risk rating and suggestions. The fixed lifecycle checks do not automatically execute the suggested invalid-input catalog check; the earlier separate PR verification covered 20 input cases.

## Differences found only on the deployed path

Two real runtime incompatibilities were missed by Node-based tests:

1. Storing native `fetch` on an adapter and calling it as a method caused **Illegal invocation**. Both adapters now bind its global receiver.
2. Workers rejected `redirect: "error"`. Requests now use `manual`; API non-success responses reject redirects without forwarding credentials. Attributed target non-200 responses are health errors, and unattributed responses remain unknown.

Failed runs `93757920-5cba-4108-b6c0-afe1afcd81b7` and `c99f8d9d-3793-41b6-b5d8-b90eed178b39` remain in history. Both rejected before target traffic changed. Runs now retain a bounded error message and failing phase for inspection.

Regression tests check fetch receiver and redirect mode. `npm test`: **33 passed**. `npm run check`: formatting, lint and TypeScript passed. `npm run deploy`: frontend/Worker build and real deployment succeeded.

## Configuration and remaining limits

- Dedicated `.dev.vars` `CLOUDFLARE_API_TOKEN` was installed as remote `DEPLOYGUARD_API_TOKEN`, the application's binding name. `GITHUB_TOKEN` was installed under its existing name. A separate generated `DEPLOYGUARD_ADMIN_TOKEN` was stored locally and remotely. Secrets remain configured for backend operation; none were committed or printed.
- `CLOUDFLARE_ACCOUNT_ID` was checked against the fixed configured account. No multiple-account/project support or additional storage service was added.
- Candidate-to-commit association remains operator supplied, not cryptographically verified build provenance.
- Synthetic health from this coordinator is not global production telemetry. No monitoring ingestion was added.
- Shared bearer authentication, no per-user approval identity, bounded unpaginated history, external-writer races and manual recovery of ambiguous writes remain V1 limits. Resolve dashboard authentication and recovery UX before wider use.
- This rehearsal verifies successful live progression, not process termination at every intermediate checkpoint or a live induced-failure rollback.

Official references consulted: [Workers request/redirect behavior](https://developers.cloudflare.com/workers/runtime-apis/request/), [illegal invocation errors](https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors), [secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [DO alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), and [version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/).
