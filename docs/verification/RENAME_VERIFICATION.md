# Submission rename and live verification

Verified 2026-09-25 after renaming the repository to [`Aadithya-J/cf_ai_deployguard`](https://github.com/Aadithya-J/cf_ai_deployguard).

## What changed

- Updated the Git remote and demo PR URLs; committed development prompts and pushed the pending project commits.
- Kept the `deployguard` Worker name, bindings, storage, and deployed URL.
- Legacy PR inputs resolve explicitly to the new name. GitHub responses for this repository must match its verified repository ID, `1386919200`.
- Saved candidate associations accept this specific rename while still requiring matching candidate, PR number, head SHA, merge-base SHA, and diff hash. An advancing target branch alone does not change the analyzed diff.
- Historical records retain their captured metadata; no records were deleted or rewritten.

## Verification

- All **56 tests** passed, including new rename, repository identity, and immutable-association regression tests.
- `npm run check`, `npm run demo:check`, and the production build passed.
- GitHub Sanity Check and Semgrep passed for the implementation commit `6c8139d`.
- All **12 pre-existing runs** were byte-for-byte equivalent as parsed public JSON after deployment. All **six pre-existing analyses** matched their live PR snapshots through the renamed repository.
- A reviewer chat session called `getDeployment` and correctly explained historical rollback run `d64dfe52-f344-48d6-80ff-874d3eb26dbc`.

Deployed application version: `c607321d-aafe-43e2-ada9-88e49bf44d87`.

| Live run                               | Result                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `78748074-690f-4c77-8182-4dcb873b05dd` | First healthy attempt conservatively rolled back: early post-promotion probes still reached stable, so attribution was unknown and verification expired. Recovery was verified. |
| `e4be34f7-e156-4292-b0ef-7ecc0a731fa6` | Healthy retry completed analysis, smoke, canary, reviewer approval, temporary promotion, post-promotion health verification, and stable recovery; final state `demo_complete`.  |
| `fc6b6167-2b38-4b69-8b0d-ed2fcd0090b8` | Failure preset completed analysis and smoke, failed canary health policy, and verified stable recovery; final state `rolled_back`.                                              |

Both successful end-to-end checks used PR URLs under `cf_ai_deployguard`. Safety thresholds were not relaxed for the retry. Cloudflare's deployment status independently confirmed stable version `eb3a0ea3-b238-40c0-833e-62dc61c7f35e` at **100%** after the final run.

The repository remained private. The live app supports public review; repository and PR access must be arranged before submitting the GitHub URL.

## Earlier evidence

These reports document earlier implementation stages and their then-current behavior:

- [Initial target version/traffic checks](TARGET_VERIFICATION.md)
- [PR #1 endpoint and AI checks](PR1_VERIFICATION.md), with [original structured output](PR1_ANALYSIS.json)
- [Backend integration](BACKEND_VERIFICATION.md)
- [Rollback and traffic recovery](ROLLBACK_VERIFICATION.md)
- [Dashboard and reviewer demos](DASHBOARD_VERIFICATION.md)
