import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardRequest } from "./access.ts";
import { publicRun } from "./demo.ts";
import type { Run } from "./deployment/lifecycle.ts";
const origin = "https://deployguard.example";
const secret = "test-only-secret";
function fixture() {
  const calls: Request[] = [];
  const ports = {
    secret,
    controller: async (r: Request) => {
      calls.push(r);
      return Response.json(
        r.method === "POST"
          ? { id: "preset-run", samples: [], events: [] }
          : null,
        { status: r.method === "POST" ? 202 : 200 }
      );
    },
    agent: async (r: Request) => {
      calls.push(r);
      return Response.json({ ok: true });
    }
  };
  const request = (
    path: string,
    method = "GET",
    cookie = "",
    body?: unknown,
    source = origin
  ) =>
    dashboardRequest(
      new Request(origin + path, {
        method,
        headers: { origin: source, cookie },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
      ports
    );
  async function guest() {
    const r = await request("/api/reviewer-session", "POST", "", {});
    return {
      cookie: r.headers.get("set-cookie")!.split(";")[0],
      name: ((await r.json()) as { name: string }).name
    };
  }
  return { calls, request, guest };
}
test("anonymous reads are whitelisted; all ordinary mutations remain protected", async () => {
  const f = fixture();
  assert.equal((await f.request("/api/deployment")).status, 200);
  for (const path of [
    "/api/deployment/start",
    "/api/deployment/approve",
    "/api/deployment/rollback",
    "/api/deployment/reconcile",
    "/api/analysis",
    "/api/deployment/rehearsal"
  ]) {
    assert.equal((await f.request(path, "POST", "", {})).status, 401);
  }
  assert.equal((await f.request("/api/deployment/start")).status, 401);
  assert.equal(f.calls.length, 1);
});
test("reviewer sessions isolate chat and cannot become admin sessions", async () => {
  const f = fixture();
  const a = await f.guest();
  const b = await f.guest();
  assert.notEqual(a.name, b.name);
  assert.equal(
    (await f.request(`/agents/chat-agent/${a.name}`, "GET", a.cookie)).status,
    200
  );
  assert.equal(
    (await f.request(`/agents/chat-agent/${b.name}`, "GET", a.cookie)).status,
    401
  );
  assert.equal(
    (
      await f.request(
        "/agents/chat-agent/deployguard-inspector",
        "GET",
        a.cookie
      )
    ).status,
    401
  );
  assert.equal(
    (
      await f.request(
        "/api/deployment/start",
        "POST",
        a.cookie.replace("deployguard_reviewer", "deployguard_session"),
        {}
      )
    ).status,
    401
  );
  assert.equal(
    (
      await f.request(
        `/agents/chat-agent/${a.name}`,
        "POST",
        a.cookie,
        {},
        "https://other.example"
      )
    ).status,
    401
  );
});
test("public rehearsal requires its own session and same origin and rejects every custom parameter", async () => {
  const f = fixture();
  const a = await f.guest();
  assert.equal(
    (await f.request("/api/demo/rehearsal", "POST", "", {})).status,
    401
  );
  assert.equal(
    (
      await f.request(
        "/api/demo/rehearsal",
        "POST",
        a.cookie,
        {},
        "https://other.example"
      )
    ).status,
    401
  );
  for (const body of [
    { candidate: "anything" },
    { stable: "anything" },
    { policy: {} },
    [],
    null
  ])
    assert.equal(
      (await f.request("/api/demo/rehearsal", "POST", a.cookie, body)).status,
      400
    );
  assert.equal(f.calls.length, 0);
});
test("public projection excludes approval capability, intent and internal errors", () => {
  const raw = {
    id: "run",
    samples: [],
    events: [],
    approval: { id: "secret-approval" },
    intent: { secret: "pending" },
    failure: { message: "internal" },
    futureSecret: "hidden"
  } as unknown as Run;
  const result = JSON.stringify(publicRun(raw));
  for (const value of ["secret-approval", "pending", "internal", "hidden"])
    assert.ok(!result.includes(value));
});

test("valid public rehearsal forwards only the fixed internal command", async () => {
  const f = fixture();
  const a = await f.guest();
  const response = await f.request("/api/demo/rehearsal", "POST", a.cookie, {});
  assert.equal(response.status, 202);
  assert.equal(f.calls.length, 1);
  assert.equal(new URL(f.calls[0].url).pathname, "/api/deployment/rehearsal");
  assert.equal(await f.calls[0].text(), "{}");
  assert.equal(f.calls[0].headers.get("authorization"), `Bearer ${secret}`);
});

test("public demo approval only forwards bounded IDs to the dedicated command", async () => {
  const f = fixture();
  const a = await f.guest();
  const body = {
    runId: "11111111-1111-4111-8111-111111111111",
    approvalId: "22222222-2222-4222-8222-222222222222"
  };
  assert.equal(
    (await f.request("/api/demo/approve", "POST", "", body)).status,
    401
  );
  assert.equal(
    (
      await f.request("/api/demo/approve", "POST", a.cookie, {
        ...body,
        candidate: "other"
      })
    ).status,
    400
  );
  assert.equal(
    (
      await f.request("/api/demo/healthy", "POST", a.cookie, {
        candidate: "other"
      })
    ).status,
    400
  );
  assert.equal(
    (await f.request("/api/demo/approve", "POST", a.cookie, body)).status,
    202
  );
  assert.equal(
    new URL(f.calls[0].url).pathname,
    "/api/deployment/approve-demo"
  );
  assert.deepEqual(JSON.parse(await f.calls[0].text()), body);
});

test("only healthy demo read responses expose the limited demo approval", () => {
  const base = {
    id: "run",
    phase: "awaiting_approval",
    samples: [],
    events: [],
    approval: { id: "limited-demo-approval", expiresAt: 123 }
  } as unknown as Run;
  assert.equal(publicRun(base).rehearsal, undefined);
  const failed = {
    ...base,
    rehearsal: { preset: "rollback-demo" as const, expectedStable: "stable" }
  };
  assert.equal(publicRun(failed).rehearsal?.approvalId, undefined);
  const healthy = {
    ...base,
    rehearsal: { preset: "promotion-demo" as const, expectedStable: "stable" }
  };
  assert.equal(
    publicRun(healthy).rehearsal?.approvalId,
    "limited-demo-approval"
  );
  assert.equal(
    publicRun({ ...healthy, phase: "promoting" }).rehearsal?.approvalId,
    undefined
  );
});
