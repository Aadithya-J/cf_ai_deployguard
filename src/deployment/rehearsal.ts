// Fixed, previously uploaded disposable fault fixture. Never accept these from a browser.
export const REHEARSAL = Object.freeze({
  id: "rollback-demo",
  candidate: "5cbecc7e-00f5-41dc-a285-6b0480b31342",
  stable: "eb3a0ea3-b238-40c0-833e-62dc61c7f35e",
  cooldownMs: 300_000
});
export interface RehearsalState {
  id: string;
  candidate: string;
  stable: string;
  availableAt: number;
  lastRunId?: string;
}
