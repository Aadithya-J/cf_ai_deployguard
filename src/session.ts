const COOKIE = "deployguard_session";
const TTL = 8 * 60 * 60;
const encoder = new TextEncoder();
async function key(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
const hex = (data: ArrayBuffer) =>
  Array.from(new Uint8Array(data), (b) => b.toString(16).padStart(2, "0")).join(
    ""
  );
export async function issueSession(secret: string, now = Date.now()) {
  const payload = `${Math.floor(now / 1000) + TTL}.${crypto.randomUUID()}`;
  return `${payload}.${hex(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload)))}`;
}
export async function validSession(
  request: Request,
  secret: string,
  now = Date.now()
) {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!token) return false;
  const [expires, nonce, signature, extra] = token.split(".");
  if (
    extra ||
    !/^\d+$/.test(expires) ||
    !/^[\da-f-]{36}$/.test(nonce ?? "") ||
    !/^[\da-f]{64}$/.test(signature ?? "") ||
    Number(expires) <= now / 1000 ||
    Number(expires) > now / 1000 + TTL + 1
  )
    return false;
  return crypto.subtle.verify(
    "HMAC",
    await key(secret),
    Uint8Array.from(signature.match(/../g)!, (b) => parseInt(b, 16)),
    encoder.encode(`${expires}.${nonce}`)
  );
}
export function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}
export async function authorized(request: Request, secret?: string) {
  if (!secret) return false;
  if (request.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (
    (request.method !== "GET" ||
      request.headers.get("upgrade") === "websocket") &&
    !sameOrigin(request)
  )
    return false;
  return validSession(request, secret);
}
export async function sessionResponse(request: Request, secret?: string) {
  const headers = new Headers({ "cache-control": "no-store" });
  if (!secret)
    return Response.json(
      { error: "DEPLOYGUARD_ADMIN_TOKEN is not configured." },
      { status: 503, headers }
    );
  if (request.method === "GET")
    return Response.json(
      { authenticated: await validSession(request, secret) },
      { headers }
    );
  if (!sameOrigin(request))
    return Response.json(
      { error: "Same-origin request required." },
      { status: 403, headers }
    );
  let token = "";
  if (request.method === "POST") {
    let input: { token?: unknown };
    try {
      input = await request.json();
    } catch {
      return Response.json(
        { error: "Invalid request." },
        { status: 400, headers }
      );
    }
    if (typeof input?.token !== "string" || input.token !== secret)
      return Response.json(
        { error: "Admin token not recognized." },
        { status: 401, headers }
      );
    token = await issueSession(secret);
  } else if (request.method !== "DELETE")
    return new Response(null, { status: 405, headers });
  headers.set(
    "set-cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? TTL : 0}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`
  );
  return Response.json({ authenticated: Boolean(token) }, { headers });
}
