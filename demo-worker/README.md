# Disposable DeployGuard target

One stateless Worker in the configured Cloudflare account. No D1, R2, Durable Objects, secrets, or additional packages. The Agent application and this target have separate Wrangler configurations.

## HTTP contract

| Request                              | Result                                               |
| ------------------------------------ | ---------------------------------------------------- |
| `GET /health`                        | 200, `ok: true`                                      |
| `GET /api/greeting?name=DeployGuard` | 200, greeting from the version's `GREETING` variable |
| Name longer than 80 characters       | 400                                                  |
| Unknown path                         | 404                                                  |
| Method other than GET                | 405                                                  |

Every Worker-generated response carries `x-deployguard-version` (Cloudflare version UUID), `x-deployguard-release`, and `x-request-id`. JSON includes matching `version` and `requestId` fields. Responses use `Cache-Control: no-store`. Platform failures that occur before the handler runs cannot carry these application headers.

One structured console event records version, normalized route, HTTP status and request ID. An optional `x-deployguard-probe` identifier correlates a probe batch. Invocation logs are also enabled. These are diagnostic events; no monitoring service or deployment controller is implemented.

## Local checks

Run from the repository root:

```sh
npm run demo:check
npx wrangler dev --config demo-worker/wrangler.jsonc
```

`demo:check` generates the target's ignored runtime types, then checks TypeScript, lint and formatting. Local version metadata is not evidence of a deployed version; verify UUIDs remotely.

## Manual deployment sequence

These commands mutate the disposable target. Always use its explicit config; the root deploy script deploys the Agent application.

```sh
# Initial stable deployment; record its version UUID from the output.
npx wrangler deploy --config demo-worker/wrangler.jsonc

# Upload candidate with changed versioned configuration; production stays stable.
npx wrangler versions upload --config demo-worker/wrangler.jsonc \
  --tag candidate-v2 --message 'Disposable candidate: Hi greeting' \
  --var RELEASE:candidate-v2 --var GREETING:Hi

# Smoke-test the version preview URL printed by upload, checking the UUID.
curl -i 'https://<candidate-preview-host>/health'
curl -i 'https://<candidate-preview-host>/api/greeting?name=DeployGuard'

# Substitute the recorded full UUIDs.
npx wrangler versions deploy '<stable-uuid>@90' '<candidate-uuid>@10' \
  --config demo-worker/wrangler.jsonc --yes

# Observe version attribution while generating ordinary requests.
npx wrangler tail --config demo-worker/wrangler.jsonc --format json

# Finish by restoring stable, including when validation fails.
npx wrangler versions deploy '<stable-uuid>@100' \
  --config demo-worker/wrangler.jsonc --yes
npx wrangler deployments status --config demo-worker/wrangler.jsonc
```

While both versions belong to the active deployment, a request can select one:

```sh
curl -i 'https://deployguard-demo-target.jlaadithya.workers.dev/health' \
  -H 'Cloudflare-Workers-Version-Overrides: deployguard-demo-target="<candidate-uuid>"'
```

Always assert the returned UUID. An override for a version outside the active deployment falls back to normal routing. Preview URLs remain independently accessible after restoring stable. This target is intentionally public and contains no sensitive data.

See [the verification report](VERIFICATION.md) for actual versions, deployment IDs, observations, constraints and official documentation.
