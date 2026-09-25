# DeployGuard

An AI-assisted progressive deployment dashboard for one Cloudflare account and the disposable `deployguard-demo-target` Worker. Built from the official [Cloudflare Agents starter](https://github.com/cloudflare/agents-starter).

The dashboard is the primary interface. It shows persisted deployment history, immutable PR analysis, live synthetic health evidence, approval and recovery controls, and final outcomes. **Ask DeployGuard** is a secondary, read-only chat interface for questions about stored runs.

## Run locally

```sh
npm install
npm run dev
```

Open the URL printed by Vite. Workers AI uses the remote binding, so local development requires Cloudflare authentication. Local Durable Object storage is separate from the deployed dashboard's history.

Configure ignored `.dev.vars`:

```dotenv
DEPLOYGUARD_ADMIN_TOKEN=<strong-dashboard-admin-token>
DEPLOYGUARD_API_TOKEN=<dedicated-cloudflare-token>
GITHUB_TOKEN=<repository-read-token>
```

The Cloudflare token needs Workers Scripts Write for the configured account. `GITHUB_TOKEN` is needed for private PRs. If your supplied token is named `CLOUDFLARE_API_TOKEN`, install its value as `DEPLOYGUARD_API_TOKEN` for the application's binding; Wrangler's credential name is separate.

The app opens in public reviewer mode. Use **Admin sign in** with `DEPLOYGUARD_ADMIN_TOKEN` for custom deployments and manual controls. The server issues an eight-hour signed, HttpOnly, SameSite=Strict cookie (Secure on HTTPS); neither the admin token nor service credentials are saved in browser storage. This is shared single-operator authentication, not a user/role system. Existing bearer-token API clients remain supported. Rotate the admin secret to invalidate signed sessions. Sign-out clears the browser cookie and closes the mounted chat connection; it does not revoke a copied cookie independently of expiry or secret rotation.

## Reviewer demo

No new PR, token or version upload is needed. The deployed dashboard offers two choices:

- **Try a successful deployment:** analyzes PR #2 and runs a healthy canary. Reviewers approve a temporary real 100% promotion. After health verification, the backend restores the original stable and verifies recovery before reporting **Demo complete · stable restored**.
- **See automatic rollback:** analyzes PR #3 and tests a candidate whose greeting endpoint intentionally returns HTTP 503 about 70% of the time. The HTTP error policy triggers rollback and recovery verification. No reviewer approval is needed.

Completed runs, including the original PR #1 example, remain available in **History**. **Ask DeployGuard** opens by default and can be toggled closed. Both live demos continue if the browser closes.

Both start commands accept no custom parameters and pin the PR head as well as the candidate. A moved PR head fails analysis conservatively. Its candidate and expected stable UUIDs are pinned in `src/deployment/rehearsal.ts`; a changed stable rejects validation before traffic changes. Both presets share the existing Durable Object lock, which prevents overlap; a persisted five-minute cooldown limits repeat starts. Public reviewers can approve only the prepared healthy demo, using a run-specific, expiring approval. They cannot approve ordinary deployments, manually roll back, reconcile, create arbitrary analyses or start arbitrary deployments. If recovery needs attention, an admin must investigate.

Public read responses omit ordinary admin approval capabilities, pending mutation intents and internal errors. Reviewer chat uses a separate signed, HttpOnly cookie and an isolated conversation, with a 20-question budget per conversation. It only reads public deployment fields. This budget is not global abuse protection: new sessions can be created. Rehearsals are shared real target activity, not private simulations; other visitors can watch the active run. Private GitHub links may be inaccessible to reviewers, but stored PR analysis remains visible.

## Admin dashboard flow

1. Upload a candidate version independently using the [demo Worker instructions](demo-worker/README.md).
2. Select **New deployment** and supply its UUID, optionally a GitHub PR URL and expected head SHA.
3. Follow analysis, validation, preview smoke tests, and the real 90/10 canary. The backend continues working when the browser closes.
4. Review evidence, then explicitly approve a healthy candidate. Promotion includes a post-promotion health check.
5. Failed canaries restore stable automatically. `Verifying recovery` keeps the target locked until stable ordinary traffic passes the recovery window. `Needs attention` retains the lock for investigation/reconciliation.

The dashboard polls existing read endpoints every five seconds. Stale or failed refreshes disable controls. Historical records show their own recorded allocation, not a claim about current routing. Health tables show HTTP errors, p95 latency, critical assertions and unknown attribution per endpoint/version. The AI's suggested checks are advice, not executed test results.

Chat uses Workers AI Llama 3.3 and the existing persistent ChatAgent, with only `listDeployments` and `getDeployment` read tools. The starter's unrelated weather, calculation, scheduling, image and external MCP controls were removed. Chat cannot approve, promote, roll back or run checks. Admin chat uses a separate `deployguard-inspector` conversation so old starter messages do not supply product context. Answers can be inaccurate; use the dashboard evidence to verify them.

## Checks and deployment

```sh
npm test
npm run check
npm run demo:check
npm run deploy
```

DeployGuard secrets must be installed separately with Wrangler; never commit `.dev.vars`. `npm run deploy` deploys the dashboard/controller application, not the demo target. Run `npm run types` after changing bindings. No D1, R2, multi-project support or monitoring ingestion is required for V1.

## Architecture and verification

- [Deterministic lifecycle, policy and API](DEPLOYMENT_LIFECYCLE.md)
- [GitHub PR analysis and advisory boundary](PR_ANALYSIS.md)
- [Deployed backend verification](BACKEND_VERIFICATION.md)
- [Live failure and traffic-confirmed rollback](demo-worker/ROLLBACK_VERIFICATION.md)
- [Dashboard verification](DASHBOARD_VERIFICATION.md)

Limits: synthetic probes from one coordinator do not prove global production health; PR association does not prove build provenance; history is capped at 100 unpaginated records; deployment API read/write races with external writers remain possible. Use the controller as the sole deployment writer during an active run.

The failure fixture deliberately behaves differently on preview and ordinary hostnames, so smoke passes and the demo exercises canary error thresholds. Randomness changes failure timing, not the safety rules. If a reviewer does not approve a healthy demo within the existing 60-second approval window, it restores stable without claiming a successful promotion. Reset failures remain `needs_attention` and block subsequent runs. Both presets expect stable `eb3a0ea3-b238-40c0-833e-62dc61c7f35e`; an ordinary admin promotion to a different stable requires explicitly updating the presets before further rehearsals.
