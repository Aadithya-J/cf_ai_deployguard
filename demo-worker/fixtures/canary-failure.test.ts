import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./canary-failure.ts";

const env = {
  GREETING: "Hello",
  RELEASE: "stable-v1",
  WORKER_VERSION: {
    id: "test-version",
    tag: "rollback-rehearsal",
    timestamp: "2026-09-25T00:00:00Z"
  }
} as Env;

test("rollback fixture preserves attribution and fails only production health", async () => {
  for (const [host, path, healthy] of [
    ["preview-deployguard-demo-target.jlaadithya.workers.dev", "/health", true],
    ["deployguard-demo-target.jlaadithya.workers.dev", "/health", false],
    [
      "deployguard-demo-target.jlaadithya.workers.dev",
      "/api/greeting?name=DeployGuard",
      true
    ]
  ] as const) {
    const response = await fixture.fetch(
      new Request(`https://${host}${path}`),
      env
    );
    const body = (await response.json()) as {
      ok?: boolean;
      greeting?: string;
      version: { id: string };
      requestId: string;
    };
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("x-deployguard-version"),
      env.WORKER_VERSION.id
    );
    assert.equal(body.version.id, env.WORKER_VERSION.id);
    assert.equal(response.headers.get("x-request-id"), body.requestId);
    assert.equal(response.headers.get("cache-control"), "no-store");
    if (path === "/health") assert.equal(body.ok, healthy);
    else assert.equal(body.greeting, "Hello, DeployGuard!");
  }
});
