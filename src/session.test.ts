import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorized,
  issueSession,
  validSession,
  sessionResponse
} from "./session.ts";
const origin = "https://deployguard.example";
const secret = "test-only-long-admin-secret";
test("session signatures reject tampering, expiry and rotated secrets", async () => {
  const now = Date.now();
  const token = await issueSession(secret, now);
  const req = (value: string) =>
    new Request(origin, {
      headers: { cookie: `deployguard_session=${value}` }
    });
  assert.equal(await validSession(req(token), secret, now), true);
  assert.equal(
    await validSession(
      req(token.slice(0, -1) + (token.endsWith("0") ? "1" : "0")),
      secret,
      now
    ),
    false
  );
  assert.equal(
    await validSession(req(token), secret, now + 8 * 60 * 60 * 1000),
    false
  );
  assert.equal(await validSession(req(token), "rotated", now), false);
});
test("browser writes and websocket handshakes require same-origin; bearer API remains supported", async () => {
  const cookie = `deployguard_session=${await issueSession(secret)}`;
  for (const method of ["GET", "POST"]) {
    const headers = { cookie, origin };
    assert.equal(
      await authorized(new Request(origin, { method, headers }), secret),
      true
    );
    assert.equal(
      await authorized(
        new Request(origin, {
          method,
          headers: {
            ...headers,
            origin: "https://evil.example",
            upgrade: "websocket"
          }
        }),
        secret
      ),
      false
    );
  }
  assert.equal(
    await authorized(
      new Request(origin, { method: "POST", headers: { cookie } }),
      secret
    ),
    false
  );
  assert.equal(
    await authorized(
      new Request(origin, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` }
      }),
      secret
    ),
    true
  );
});
test("session endpoint sets protected cookie, rejects wrong token and clears on logout", async () => {
  const request = (method: string, token?: string) =>
    new Request(origin + "/api/session", {
      method,
      headers: { origin, "content-type": "application/json" },
      body: token ? JSON.stringify({ token }) : undefined
    });
  assert.equal(
    (await sessionResponse(request("POST", "wrong"), secret)).status,
    401
  );
  const response = await sessionResponse(request("POST", secret), secret);
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.ok(!cookie.includes(secret));
  assert.match(
    (await sessionResponse(request("DELETE"), secret)).headers.get(
      "set-cookie"
    )!,
    /Max-Age=0/
  );
});
