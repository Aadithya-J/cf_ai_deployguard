# GitHub PR advisory analysis

## Flow and trust boundaries

1. An authenticated developer supplies a GitHub PR URL and an already uploaded candidate version UUID.
2. Verify the candidate exists in the fixed demo Worker using Cloudflare's version API.
3. Validate the URL and GitHub PR identity. V1 accepts open, non-draft, unmerged PRs on `github.com`.
4. Record the immutable head commit SHA and base SHA. Resolve the merge base, then fetch the diff using the immutable merge-base/head pair. Read the PR again and reject if either SHA or the file count changed during retrieval.
5. Persist an immutable association between the candidate and this PR snapshot, including the diff SHA-256 hash. The same candidate cannot later be reassigned to a different snapshot. Retrying analysis for the same snapshot is allowed.
6. Call Workers AI Llama 3.3 in nonstreaming JSON-schema mode. Treat title/diff as untrusted data, provide no tools, and validate the output independently using Zod.
7. Persist structured advisory output or an explicit failed-analysis record. No deployment operation follows from analysis.

**Association is not build provenance.** `provenance: "operator_association_unverified"` explicitly records that the developer selected this version. Neither GitHub nor the Workers version API proves that it was built from the captured commit. Uploading/building Workers and verifying artifact attestations remain outside this feature.

## API

Uses the same admin bearer authentication and fixed singleton Durable Object as deployment control. GitHub/AI work runs outside the deployment/alarm serialization queue; only the short immutable association reservation uses that queue.

```http
POST /api/analysis
Authorization: Bearer <DEPLOYGUARD_ADMIN_TOKEN>
Content-Type: application/json

{
  "prUrl": "https://github.com/owner/repository/pull/123",
  "candidate": "<already-uploaded-version-uuid>"
}
```

- `201`: complete record, including `id`, candidate, immutable PR metadata, `advisoryOnly: true`, model/prompt version and `analysis`.
- `502`: persisted failed model analysis; includes the record ID for investigation/retry.
- `422`: invalid URL/PR/candidate, unavailable GitHub data, unsupported diff, or immutable association conflict.
- `409`: another analysis is running in the current coordinator instance.
- `GET /api/analysis/<id>`: retrieve a record.
- `GET /api/analysis`: up to 100 records, key-limited then sorted by creation time; pagination is deferred.
- `GET /api/analysis/catalog`: the fixed check catalog.

Model output:

```json
{
  "summary": "Describes the change",
  "affectedAreas": ["request handling"],
  "riskLevel": "low",
  "likelyFailureModes": [
    "A changed response shape could break existing clients."
  ],
  "suggestedChecks": ["greeting_contract", "version_attribution"]
}
```

`riskLevel` is `low`, `medium` or `high`. Allowed check IDs are `health_contract`, `greeting_contract`, `version_attribution`, `error_rate_comparison`, `latency_comparison`, and `invalid_input_contract`. Unknown/duplicate check IDs, extra fields and malformed output fail validation. Suggested checks do not change the controller's fixed checks or thresholds, and manual checks do not execute automatically.

A deployment start may optionally include `analysisId` with `candidate`. The server verifies that the analysis is complete and matches that candidate, then records the analysis ID, commit SHA and PR URL on the run. The policy does not read the model's risk level, suggestions or prose. Analysis is not required to run the independently usable deterministic controller.

## Configuration and limits

- Reuses the existing `AI` binding and `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. No new dependencies, bindings or data services.
- `DEPLOYGUARD_API_TOKEN` validates the version; `DEPLOYGUARD_ADMIN_TOKEN` protects the API. No tokens are exposed to the frontend or model.
- Optional `GITHUB_TOKEN` allows private repositories and authenticated API limits. Use a token restricted to the intended repository with read permissions for pull requests and contents. Without it, only publicly accessible PRs can be analyzed.
- GitHub requests go only to `api.github.com`, use GET, reject redirects and have 15-second timeouts. No comments, statuses, reviews, merges or other GitHub writes are implemented.
- V1 accepts 1–100 changed files and at most 24,000 UTF-8 bytes of diff. Oversized, empty, binary, or file-count-mismatched diffs are rejected rather than silently truncated. Submodule contents, unchanged code and repository context are not fetched.
- The model call is limited to 1,800 output tokens and a 60-second application timeout. A timeout does not guarantee cancellation of inference already running on Cloudflare; it cannot later change the failed record or deployment.
- PR title, SHAs, diff hash and analysis persist. The raw diff is sent to Workers AI but is not persisted by this application. Private source is therefore shared with Workers AI when analyzing a private repository.
- An interrupted synchronous request is not automatically retried. Reads present an `analyzing` record older than two minutes as failed/interrupted; the underlying original record remains unchanged for audit purposes. A retry produces a new analysis ID for the same association.

## Review before dashboard work

1. The model is advisory and can be wrong. A live synthetic check produced valid JSON but initially suggested every catalog check and estimated medium risk for a greeting change. The prompt was tightened, but schema validity does not guarantee calibrated risk or useful explanations. The dashboard should label this as AI advice and show source SHA and provenance.
2. The PR may advance after analysis. Historical records deliberately remain bound to the captured SHA; they do not claim to describe the current PR head. A new head requires a newly associated uploaded version.
3. The merge-base/head snapshot and hash enable traceability, but do not prove build provenance. Decide how the uploader will attest version-to-commit mapping before using real applications.
4. Unsupported/large/binary diffs and GitHub rate-limit/access failures are explicit errors. No partial analysis, background ingestion, chunked summaries or automatic retries were added.
5. There is no dashboard, GitHub OAuth/App installation flow, per-user identity or durable analysis job queue yet. The shared admin token and optional repository token fit the current single-developer demo.
6. No user-supplied PR/version pair was available for a complete live integration test. Automated mocked tests cover the retrieval/association flow, and a real Workers AI call verified schema output using a synthetic diff. Deployment mutations were not performed during this work.

## Verification and official references

`npm test` covers immutable SHA diff selection, moving PR rejection, URL validation, draft/binary/oversize/access rejection, output schema/catalog enforcement, candidate association, model failure persistence, HTTP failure thresholds and post-promotion verification. `npm run check` validates TypeScript, lint and formatting. The full frontend/Worker build is checked separately.

- [GitHub pull request API](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)
- [GitHub compare commits API](https://docs.github.com/en/rest/commits/commits#compare-two-commits)
- [Workers AI JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)
- [Llama 3.3 model](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)
