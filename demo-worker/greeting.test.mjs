import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./src/index.ts";

const env = {
  GREETING: "Hello",
  RELEASE: "candidate-test",
  WORKER_VERSION: { id: "test-version-id", tag: "test-tag" }
};

async function request(t, query, status, result) {
  const log = t.mock.method(console, "log", () => {});
  const response = worker.fetch(
    new Request(`https://demo.example/api/greeting${query}`),
    env
  );
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(body, {
    ...result,
    version: { ...env.WORKER_VERSION, release: env.RELEASE },
    requestId: body.requestId
  });
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers.get("x-request-id"), body.requestId);
  assert.equal(
    response.headers.get("x-deployguard-version"),
    env.WORKER_VERSION.id
  );
  assert.equal(response.headers.get("x-deployguard-release"), env.RELEASE);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(log.mock.calls.length, 1);
  assert.equal(log.mock.calls[0].arguments[0].status, status);
  assert.equal(log.mock.calls[0].arguments[0].route, "/api/greeting");
}

test("omitted name preserves the default greeting", async (t) => {
  await request(t, "", 200, { greeting: "Hello, DeployGuard!" });
});

for (const name of [
  "Ada",
  "  Ada Lovelace  ",
  "José O’Neill",
  "李明",
  "a".repeat(80)
]) {
  test(`personalizes a valid name: ${JSON.stringify(name)}`, async (t) => {
    await request(t, `?${new URLSearchParams({ name })}`, 200, {
      greeting: `Hello, ${name.trim()}!`
    });
  });
}

for (const name of [
  "",
  "   ",
  "Ada\n",
  "A\tB",
  "A\0B",
  "A\u007fB",
  "A\u0085B"
]) {
  test(`rejects blank or control characters: ${JSON.stringify(name)}`, async (t) => {
    await request(t, `?${new URLSearchParams({ name })}`, 400, {
      error: "Name must be non-blank and contain no control characters"
    });
  });
}

test("rejects names over the 80-character limit", async (t) => {
  await request(t, `?name=${"a".repeat(81)}`, 400, {
    error: "Name must be at most 80 characters"
  });
});

test("rejects ambiguous duplicate name parameters", async (t) => {
  await request(t, "?name=Ada&name=Grace", 400, {
    error: "Provide only one name"
  });
});
