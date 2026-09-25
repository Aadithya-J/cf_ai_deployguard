import type { Run } from "./deployment/lifecycle";
import type { AnalysisRecord } from "./analysis/advisory";
import type { RunView } from "./dashboard/model";
const id =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
export const publicReadPath = (path: string) =>
  [
    "/api/deployment",
    "/api/deployment/state",
    "/api/deployment/history",
    "/api/analysis",
    "/api/analysis/catalog"
  ].includes(path) ||
  new RegExp(`^/api/(deployment|analysis)/${id}$`).test(path);
export const reviewerChatName = (name: string) =>
  new RegExp(`^reviewer-${id}$`).test(name);
// Explicit public fields: never forward approval capabilities, pending mutation
// intent, raw operation errors, or future internal fields added to stored records.
export function publicRun(r: Run) {
  return {
    id: r.id,
    candidate: r.candidate,
    stable: r.stable,
    phase: r.phase,
    policy: r.policy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    reason: r.reason,
    source: r.source
      ? {
          analysisId: r.source.analysisId,
          commitSha: r.source.commitSha,
          prUrl: r.source.prUrl
        }
      : undefined,
    request: r.request
      ? {
          prUrl: r.request.prUrl,
          expectedCommitSha: r.request.expectedCommitSha
        }
      : undefined,
    analysisId: r.analysisId,
    rehearsal: r.rehearsal
      ? {
          preset: r.rehearsal.preset,
          expectedStable: r.rehearsal.expectedStable
        }
      : undefined,
    expected: r.expected
      ? {
          id: r.expected.id,
          versions: r.expected.versions.map((v) => ({
            version_id: v.version_id,
            percentage: v.percentage
          }))
        }
      : undefined,
    canaryAt: r.canaryAt,
    promotionAt: r.promotionAt,
    samples: r.samples.map(publicSample),
    baseline: r.baseline?.map(publicSample),
    rollbackVerification: r.rollbackVerification
      ? {
          startedAt: r.rollbackVerification.startedAt,
          policy: r.rollbackVerification.policy,
          samples: r.rollbackVerification.samples.map(publicSample)
        }
      : undefined,
    events: r.events.map((e) => ({
      at: e.at,
      phase: e.phase,
      reason: e.reason
    }))
  };
}
function publicSample(s: Run["samples"][number]) {
  return {
    id: s.id,
    at: s.at,
    version: s.version,
    observedVersion: s.observedVersion,
    endpoint: s.endpoint,
    outcome: s.outcome,
    latencyMs: s.latencyMs
  };
}
export function publicAnalysis(r: AnalysisRecord) {
  const p = r.pr;
  return {
    id: r.id,
    candidate: r.candidate,
    target: r.target,
    status: r.status,
    advisoryOnly: r.advisoryOnly,
    provenance: r.provenance,
    pr: {
      url: p.url,
      repository: p.repository,
      number: p.number,
      title: p.title,
      commitSha: p.commitSha,
      baseSha: p.baseSha,
      mergeBaseSha: p.mergeBaseSha,
      changedFiles: p.changedFiles,
      diffSha256: p.diffSha256,
      capturedAt: p.capturedAt
    },
    model: r.model,
    promptVersion: r.promptVersion,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    analysis: r.analysis
      ? {
          summary: r.analysis.summary,
          affectedAreas: r.analysis.affectedAreas,
          riskLevel: r.analysis.riskLevel,
          likelyFailureModes: r.analysis.likelyFailureModes,
          suggestedChecks: r.analysis.suggestedChecks
        }
      : undefined,
    error:
      r.status === "failed" ? "Analysis unavailable for this run." : undefined
  };
}
export function publicData(path: string, data: unknown): unknown {
  if (data === null) return null;
  if (path === "/api/analysis/catalog") return data;
  if (path === "/api/deployment/history") return (data as Run[]).map(publicRun);
  if (path === "/api/deployment") return publicRun(data as Run);
  if (path === "/api/analysis")
    return (data as AnalysisRecord[]).map(publicAnalysis);
  if (path.startsWith("/api/analysis/"))
    return publicAnalysis(data as AnalysisRecord);
  const view = data as RunView;
  return {
    run: publicRun(view.run),
    analysis: view.analysis ? publicAnalysis(view.analysis) : null,
    health: view.health,
    deadlines: view.deadlines,
    allowedActions: { approve: false, rollback: false, reconcile: false },
    readOnly: true
  };
}
export async function publicResponse(path: string, response: Response) {
  const headers = { "cache-control": "no-store" };
  if (!response.ok)
    return Response.json(
      {
        error:
          response.status === 404
            ? "Record not found."
            : "Demo records are temporarily unavailable. Try refreshing."
      },
      { status: response.status, headers }
    );
  return Response.json(publicData(path, await response.json()), { headers });
}
