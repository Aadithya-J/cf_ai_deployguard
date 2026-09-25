import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudflareTarget, TARGET } from "./cloudflare.ts";
import { POLICY, type Run } from "./lifecycle.ts";
const stable = "11111111-1111-4111-8111-111111111111";
const candidate = "22222222-2222-4222-8222-222222222222";
const run: Run = {
  id: crypto.randomUUID(),
  stable,
  candidate,
  phase: "canary",
  policy: POLICY,
  createdAt: 0,
  updatedAt: 0,
  reason: "test",
  samples: [],
  events: []
};
function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch;
}
test("adapter uses version preview for smoke and pinned production requests for health", async () => {
  const seen: string[] = [];
  const target = new CloudflareTarget(
    "test-token",
    fakeFetch((url, init) => {
      seen.push(url);
      const headers = new Headers(init?.headers);
      assert.equal(
        headers.has("Authorization"),
        false,
        "API token must never reach probe target"
      );
      const version = headers
        .get("Cloudflare-Workers-Version-Overrides")
        ?.includes(stable)
        ? stable
        : candidate;
      const requestId = crypto.randomUUID();
      return Response.json(
        {
          ok: true,
          greeting: "Hi, DeployGuard!",
          version: { id: version, release: "test" },
          requestId
        },
        {
          headers: {
            "x-deployguard-version": version,
            "x-deployguard-release": "test",
            "x-request-id": requestId,
            "cache-control": "no-store"
          }
        }
      );
    })
  );
  assert.ok((await target.probe(run, true)).every((s) => s.outcome === "pass"));
  assert.ok(
    seen.every(
      (url) =>
        new URL(url).hostname === `${candidate.slice(0, 8)}-${TARGET.host}`
    )
  );
  seen.length = 0;
  const samples = await target.probe(run, false);
  assert.equal(samples.length, 4);
  assert.ok(samples.every((s) => s.outcome === "pass"));
  assert.ok(seen.every((url) => new URL(url).hostname === TARGET.host));
});
test("wrong version or transport failure is unknown, never healthy", async () => {
  const wrong = new CloudflareTarget(
    "test",
    fakeFetch(() =>
      Response.json({}, { headers: { "x-deployguard-version": "wrong" } })
    )
  );
  assert.ok(
    (await wrong.probe(run, false)).every((s) => s.outcome === "unknown")
  );
  const offline = new CloudflareTarget(
    "test",
    fakeFetch(() => {
      throw new Error("offline");
    })
  );
  assert.ok(
    (await offline.probe(run, false)).every((s) => s.outcome === "unknown")
  );
});
test("attributed HTTP or malformed payload failures are unhealthy", async () => {
  const target = new CloudflareTarget(
    "test",
    fakeFetch(
      () =>
        new Response("broken", {
          status: 500,
          headers: { "x-deployguard-version": candidate }
        })
    )
  );
  assert.ok(
    (await target.probe(run, true)).every((s) => s.outcome === "http_error")
  );
});
test("deployment adapter checks API envelope and uses percentage allocations without force", async () => {
  let called = 0;
  const versions = [
    { version_id: stable, percentage: 90 },
    { version_id: candidate, percentage: 10 }
  ];
  const target = new CloudflareTarget(
    "test-token",
    fakeFetch((url, init) => {
      called++;
      assert.equal(new URL(url).search, "");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer test-token"
      );
      const deployment = {
        id: "deployment",
        versions,
        annotations: { "workers/message": "test" }
      };
      if (init?.method === "POST") {
        assert.deepEqual(JSON.parse(String(init.body)), {
          strategy: "percentage",
          versions,
          annotations: { "workers/message": "test" }
        });
        return Response.json({ success: true, result: deployment });
      }
      return Response.json({
        success: true,
        result: { deployments: [deployment] }
      });
    })
  );
  await target.deploy(versions, "test");
  assert.deepEqual((await target.current()).versions, versions);
  assert.equal(called, 2);
  const denied = new CloudflareTarget(
    "test",
    fakeFetch(() =>
      Response.json({ success: false, result: {} }, { status: 403 })
    )
  );
  await assert.rejects(denied.current(), /403/);
});

test("HTTP 200 critical contract failure remains hard and post-promotion uses ordinary production traffic", async () => {
  const seen: Headers[] = [];
  const target = new CloudflareTarget(
    "test",
    fakeFetch((_url, init) => {
      seen.push(new Headers(init?.headers));
      return Response.json(
        { ok: false },
        { headers: { "x-deployguard-version": candidate } }
      );
    })
  );
  const samples = await target.probe(
    { ...run, phase: "verifying_promotion" },
    false
  );
  assert.equal(samples.length, 2);
  assert.ok(samples.every((s) => s.outcome === "assertion_failure"));
  assert.ok(seen.every((h) => !h.has("Cloudflare-Workers-Version-Overrides")));
});

test("stored fetch preserves the global receiver required by Workers", async () => {
  const nativeLikeFetch = function (
    this: unknown,
    _url: unknown,
    init?: RequestInit
  ) {
    assert.equal(this, globalThis);
    assert.equal(init?.redirect, "manual");
    return Promise.resolve(
      Response.json({ success: true, result: { id: candidate } })
    );
  } as typeof fetch;
  await new CloudflareTarget("test", nativeLikeFetch).validateVersion(
    candidate
  );
});
