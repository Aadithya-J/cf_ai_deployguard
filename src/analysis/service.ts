import { z } from "zod";
import {
  analyze,
  MODEL,
  type AnalysisRecord,
  type ModelInput
} from "./advisory.ts";
import type { PullSnapshot } from "./github.ts";
export const analysisRequestSchema = z
  .object({ prUrl: z.string().max(500), candidate: z.string().uuid() })
  .strict();
export interface AnalysisPorts {
  snapshot(url: string): Promise<PullSnapshot>;
  validateVersion(id: string): Promise<void>;
  reserve(record: AnalysisRecord): Promise<void>;
  save(record: AnalysisRecord): Promise<void>;
  infer(input: ModelInput): Promise<unknown>;
}
// Deliberately no deploy, approve, rollback, tools or lifecycle capability in this interface.
export async function createAnalysis(
  input: unknown,
  ports: AnalysisPorts
): Promise<AnalysisRecord> {
  const { prUrl, candidate } = analysisRequestSchema.parse(input);
  await ports.validateVersion(candidate);
  const snapshot = await ports.snapshot(prUrl);
  const { diff: _, ...pr } = snapshot;
  const record: AnalysisRecord = {
    id: crypto.randomUUID(),
    candidate,
    target: "deployguard-demo-target",
    status: "analyzing",
    advisoryOnly: true,
    provenance: "operator_association_unverified",
    pr,
    model: MODEL,
    promptVersion: 1,
    createdAt: Date.now()
  };
  await ports.reserve(record);
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      record.analysis = await Promise.race([
        analyze(snapshot, ports.infer),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("AI analysis timeout")),
            60_000
          );
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
    record.status = "complete";
  } catch {
    record.status = "failed";
    record.error =
      "AI analysis unavailable, timed out, or failed schema validation; retry with the same immutable association";
  }
  record.completedAt = Date.now();
  await ports.save(record);
  return record;
}
