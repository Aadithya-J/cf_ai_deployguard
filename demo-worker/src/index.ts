// Disposable, stateless HTTP target. Never attach production data or secrets.
export default {
  fetch(request: Request, env: Env): Response {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();
    let status = 200;
    let result: Record<string, unknown>;

    if (request.method !== "GET") {
      status = 405;
      result = { error: "Method not allowed" };
    } else if (url.pathname === "/health") {
      result = { ok: true };
    } else if (url.pathname === "/api/greeting") {
      const name = url.searchParams.get("name")?.trim() || "DeployGuard";
      if (name.length > 80) {
        status = 400;
        result = { error: "Name must be at most 80 characters" };
      } else {
        result = { greeting: `${env.GREETING}, ${name}!` };
      }
    } else {
      status = 404;
      result = { error: "Not found" };
    }

    const version = {
      id: env.WORKER_VERSION.id,
      tag: env.WORKER_VERSION.tag,
      release: env.RELEASE
    };

    // One structured event per request; do not log query values or headers.
    console.log({
      event: "deployguard.demo.request",
      request_id: requestId,
      version_id: version.id,
      release: version.release,
      route:
        url.pathname === "/health" || url.pathname === "/api/greeting"
          ? url.pathname
          : "unmatched",
      method: request.method,
      status,
      probe_run: (request.headers.get("x-deployguard-probe") || "").slice(0, 80)
    });

    return Response.json(
      { ...result, version, requestId },
      {
        status,
        headers: {
          "cache-control": "no-store",
          "x-deployguard-version": version.id,
          "x-deployguard-release": version.release,
          "x-request-id": requestId,
          ...(status === 405 ? { allow: "GET" } : {})
        }
      }
    );
  }
} satisfies ExportedHandler<Env>;
