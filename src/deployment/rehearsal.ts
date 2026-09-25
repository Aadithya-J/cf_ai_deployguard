// Fixed, previously uploaded disposable fault fixture. Never accept these from a browser.
export const REHEARSAL = Object.freeze({
  id: "rollback-demo",
  candidate: "366a3cce-118d-41f6-bef6-63d6f836703b",
  stable: "eb3a0ea3-b238-40c0-833e-62dc61c7f35e",
  prUrl: "https://github.com/Aadithya-J/deployguard/pull/3",
  expectedCommitSha: "c1abd8a4e4500826f82346283952f9f8fe6cc792"
});
export interface RehearsalState {
  id: string;
  candidate: string;
  stable: string;
  availableAt: number;
  lastRunId?: string;
}

export const HEALTHY_REHEARSAL = Object.freeze({
  ...REHEARSAL,
  id: "promotion-demo",
  candidate: "892838ac-3d86-4c35-ae7a-947e3e9611a7",
  prUrl: "https://github.com/Aadithya-J/deployguard/pull/2",
  expectedCommitSha: "e74b06b394e52c6c7d2427d49dba63e844f7c39c"
});
