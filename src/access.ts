import {
  authorized,
  reviewerName,
  reviewerSessionResponse,
  sameOrigin,
  sessionResponse
} from "./session.ts";
import { publicReadPath, publicResponse, publicRun } from "./demo.ts";
export interface DashboardAccess {
  secret?: string;
  controller(request: Request): Promise<Response>;
  agent(request: Request): Promise<Response>;
}
// One server-side boundary for both UI and direct API clients. Anonymous access
// only forwards explicit read routes; methods never inherit GET permissions.
export async function dashboardRequest(
  request: Request,
  ports: DashboardAccess
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/api/session") return sessionResponse(request, ports.secret);
  if (path === "/api/reviewer-session")
    return reviewerSessionResponse(request, ports.secret);
  const admin = await authorized(request, ports.secret);
  const denied = () =>
    Response.json(
      { error: "Admin authentication is required for this action." },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  if (
    ["/api/demo/rehearsal", "/api/demo/healthy", "/api/demo/approve"].includes(
      path
    )
  ) {
    const approval = path === "/api/demo/approve";
    let forwardedBody = "{}";
    if (request.method === "GET" && path !== "/api/demo/rehearsal")
      return denied();
    if (request.method !== "GET") {
      if (
        request.method !== "POST" ||
        !sameOrigin(request) ||
        !(await reviewerName(request, ports.secret))
      )
        return denied();
      const text = await request.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return Response.json(
          { error: "Invalid rehearsal request." },
          { status: 400 }
        );
      }
      if (
        text.length > 256 ||
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        (approval
          ? Object.keys(body).sort().join(",") !== "approvalId,runId" ||
            !Object.values(body).every(
              (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)
            )
          : Object.keys(body).length)
      )
        return Response.json(
          { error: "This rehearsal accepts no custom parameters." },
          { status: 400 }
        );
      forwardedBody = JSON.stringify(body);
    }
    if (!ports.secret)
      return Response.json(
        { error: "Rehearsal is not configured." },
        { status: 503 }
      );
    const forwarded = new Request(
      new URL(
        approval
          ? "/api/deployment/approve-demo"
          : path === "/api/demo/healthy"
            ? "/api/deployment/healthy-rehearsal"
            : "/api/deployment/rehearsal",
        request.url
      ),
      {
        method: request.method,
        headers: { Authorization: `Bearer ${ports.secret}` },
        ...(request.method === "POST" ? { body: forwardedBody } : {})
      }
    );
    const response = await ports.controller(forwarded);
    const data = await response.json();
    return Response.json(
      response.ok && request.method === "POST"
        ? publicRun(data as import("./deployment/lifecycle").Run)
        : data,
      { status: response.status, headers: { "cache-control": "no-store" } }
    );
  }
  if (path.startsWith("/agents/")) {
    const name = path.match(/^\/agents\/chat-agent\/([^/]+)(?:\/|$)/)?.[1];
    if (name === "deployguard-inspector") {
      if (!admin) return denied();
    } else {
      const reviewer = await reviewerName(request, ports.secret);
      if (!reviewer || name !== reviewer) return denied();
      if (
        (request.method !== "GET" ||
          request.headers.get("upgrade") === "websocket") &&
        !sameOrigin(request)
      )
        return denied();
    }
    return ports.agent(request);
  }
  if (path.startsWith("/api/deployment") || path.startsWith("/api/analysis")) {
    const publicRead = request.method === "GET" && publicReadPath(path);
    if (!admin && !publicRead) return denied();
    if (!ports.secret)
      return Response.json(
        { error: "Demo records are not configured." },
        { status: 503 }
      );
    const forwarded = new Request(request);
    forwarded.headers.set("Authorization", `Bearer ${ports.secret}`);
    const response = await ports.controller(forwarded);
    return admin ? response : publicResponse(path, response);
  }
  return new Response("Not found", { status: 404 });
}
