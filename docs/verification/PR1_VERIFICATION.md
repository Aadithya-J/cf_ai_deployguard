# PR #1: uploaded candidate and live verification

Verified on 2026-09-25 against Cloudflare-hosted endpoints.

## Immutable source and uploaded version

- PR: [fix(demo): validate personalized greeting names](https://github.com/Aadithya-J/cf_ai_deployguard/pull/1)
- Head commit: `6da8ddb71532d280df82f33fc38ba211b38431f4`
- Base/merge-base commit: `c067fb9044344fe8d863dd4e56eb4226966e1c03`
- Diff SHA-256: `016058a45f2f51b78046fe55cf26460e52bb38159b11810288a0688c84f9079e`
- Candidate version: `eb3a0ea3-b238-40c0-833e-62dc61c7f35e`
- Version tag and release: `pr-1-6da8ddb`
- Candidate URL: <https://eb3a0ea3-deployguard-demo-target.jlaadithya.workers.dev>

The source and Wrangler configuration were retrieved directly from the captured commit. The inspected Worker source was uploaded using `wrangler versions upload`; only the release variable was overridden to identify this candidate (`GREETING` remains `Hello`). The upload message includes the full commit SHA. This is recorded operator provenance, not a cryptographic build attestation. The repository's working tree was not switched to or merged with the PR branch.

## What changed

Three files changed: the demo Worker implementation, its README, and a new greeting test file. The greeting endpoint now:

- Keeps `DeployGuard` as the default when the name parameter is omitted.
- Trims supplied names and accepts Unicode, spaces and punctuation.
- Rejects blank names, duplicate name parameters and Unicode control characters with HTTP 400.
- Applies the 80 UTF-16-code-unit limit after trimming.

These deliberately change earlier behavior: empty names previously used the default; duplicate parameters used the first value; surrounding whitespace was preserved. Existing clients using those inputs will observe different responses. Health handling and response version metadata are unchanged by the diff.

## Live tests

All **20/20** cases passed against the uploaded candidate URL:

| Cases                                                                                      | Count | Expected result                             |
| ------------------------------------------------------------------------------------------ | ----- | ------------------------------------------- |
| Health and omitted-name default                                                            | 2     | HTTP 200 with correct content               |
| Valid names: ASCII, trimming, accented punctuation, Chinese, 80 ASCII characters, 40 emoji | 6     | HTTP 200 with correct personalized greeting |
| Empty/blank name and newline, tab, NUL, DEL, C1 control characters                         | 7     | HTTP 400 with the validation error          |
| 81 ASCII characters and 41 emoji                                                           | 2     | HTTP 400 for excessive length               |
| Duplicate name parameters                                                                  | 1     | HTTP 400                                    |
| Unknown path and unsupported method                                                        | 2     | HTTP 404 and 405                            |

Every case also checked matching candidate UUID in the header and JSON, release attribution, request ID agreement, and `Cache-Control: no-store`. Intentional invalid-input cases are contract tests, not evidence of an unhealthy canary. Forty emoji occupy 80 UTF-16 code units; 41 occupy 82, matching the documented boundary.

The active deployment was read before and after upload/testing:

- Deployment ID remained `5fb892ae-7d5a-4809-a5e6-39159b7203d0`.
- Stable version `3ee6a076-7813-41ce-ad03-0e6ed384b31e` remained at **100%**.
- A production `/health` request returned HTTP 200 and the stable UUID.
- The candidate was not promoted or assigned normal production traffic.

## Live advisory analysis

The application's `createAnalysis` pipeline validated the uploaded version, fetched/revalidated the authenticated PR snapshot, and called Workers AI using `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The response passed the application's strict schema and check-catalog validation. The result and immutable candidate association were saved locally for this verification.

- Analysis ID: `71e188d1-dd1c-4777-adcd-0a8ce45f7b85`
- Status: `complete`
- AI risk estimate: **medium**
- Affected area: greeting endpoint validation
- AI summary: input validation changes may affect greeting behavior and performance.
- Suggested checks: invalid-input contract, greeting contract, version attribution, error-rate comparison, latency comparison, and health contract.

The full original structured output is in [PR1_ANALYSIS.json](PR1_ANALYSIS.json). AI did not call deployment operations, alter thresholds or start a deployment run.

## Interpretation and limits

The live evidence supports the intended input-validation behavior and version attribution. It does not establish comparative canary error rates or latency; no percentage rollout was requested for this PR test.

The AI still selected the entire check catalog and described “non-UTF-16 characters” imprecisely. JavaScript represents Unicode strings using UTF-16 code units; the meaningful concern is the length boundary for supplementary characters, which the emoji tests verified. Treat model risk and failure explanations as reviewable advice, not validated facts.

Anonymous GitHub access returned 404; authenticated access through the existing GitHub CLI login succeeded. The deployed application will need an appropriate `GITHUB_TOKEN` for this repository. Credentials were used in memory for the check and were not added to the repository or provisioned as application secrets.

This exercised live GitHub, Workers AI and the uploaded candidate. Analysis persistence used local files rather than the controller's Durable Object HTTP endpoint, so that endpoint's full integration remains a separate verification step. Candidate version URLs also lack ordinary Workers Logs/live-tail support; response assertions were the test evidence.
