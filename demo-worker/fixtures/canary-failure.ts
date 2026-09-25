import target from "../src/index.ts";

// Opt-in entry point for a disposable live rollback rehearsal only.
// Preview remains healthy; the normal target hostname violates /health's contract.
// No policy bypass, control endpoint, persistent state, or extra binding is needed.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = target.fetch(request, env);
    const url = new URL(request.url);
    if (
      request.method === "GET" &&
      url.hostname === "deployguard-demo-target.jlaadithya.workers.dev" &&
      url.pathname === "/health"
    ) {
      const body = (await response.json()) as Record<string, unknown>;
      return Response.json(
        { ...body, ok: false, fault: "intentional-canary-health-assertion" },
        { status: response.status, headers: response.headers }
      );
    }
    return response;
  }
} satisfies ExportedHandler<Env>;
