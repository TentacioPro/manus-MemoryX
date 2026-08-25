import type { Db } from "mongodb";

export type LedgerInput = {
  taskId: string;
  parentTaskId?: string | null;
  state: "planned" | "started" | "implemented" | "verified" | "completed" | "blocked" | "failed" | "cancelled" | "ready";
  decision: string;
  action: string;
  rationale: string;
  evidence: string;
};

export async function recordLedger(db: Db, input: LedgerInput) {
  await db.collection("taskLedger").insertOne({ ...input, timestamp: new Date() });
}
