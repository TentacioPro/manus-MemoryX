import type { Db, ObjectId } from "mongodb";
import { ObjectId as MongoObjectId } from "mongodb";
import { upsertEntry, type EntryCandidate } from "./archive.js";
import { transitionImport } from "./imports.js";
import { recordLedger } from "./ledger.js";

export type ImportRowState = "staged" | "reviewed" | "committed" | "rejected" | "failed" | "cancelled";
const nextStates: Record<ImportRowState, ImportRowState[]> = {
  staged: ["reviewed", "rejected", "failed", "cancelled"],
  reviewed: ["committed", "rejected", "failed", "cancelled"],
  committed: [],
  rejected: ["reviewed", "cancelled"],
  failed: ["staged", "cancelled"],
  cancelled: ["staged"],
};

export async function transitionImportRow(db: Db, rowId: ObjectId, state: ImportRowState, details: { reason?: string; failure?: string; entryId?: ObjectId } = {}) {
  const rows = db.collection("importRows");
  const row = await rows.findOne({ _id: rowId });
  if (!row) throw new Error("Import row not found");
  const current = row.state as ImportRowState;
  if (current !== state && !nextStates[current]?.includes(state)) throw new Error(`Cannot move import row from ${current} to ${state}`);
  await rows.updateOne({ _id: rowId }, { $set: { state, stateReason: details.reason ?? null, failure: details.failure ?? null, entryId: details.entryId ?? row.entryId ?? null, updatedAt: new Date() } });
  await recordLedger(db, { taskId: `import-row.${rowId.toHexString()}`, state: state === "failed" ? "failed" : state === "cancelled" ? "cancelled" : "completed", decision: `Move import row from ${current} to ${state}.`, action: details.reason ?? "Updated row review state.", rationale: "Every candidate must have a traceable review decision before it can be committed to the archive.", evidence: details.failure ?? details.entryId?.toHexString() ?? "state update" });
  return { ...row, state };
}

export async function reviewImportRow(db: Db, rowId: ObjectId, accepted: boolean, reason?: string) {
  return transitionImportRow(db, rowId, accepted ? "reviewed" : "rejected", { reason: reason ?? (accepted ? "Approved for archive commitment." : "Rejected during local review.") });
}

export async function cancelImportRow(db: Db, rowId: ObjectId, reason?: string) {
  return transitionImportRow(db, rowId, "cancelled", { reason: reason ?? "Cancelled by local archive user during review." });
}

export async function retryFailedRows(db: Db, importId: ObjectId) {
  const result = await db.collection("importRows").updateMany({ importId, state: "failed" }, { $set: { state: "staged", failure: null, stateReason: "Returned to staging for retry.", updatedAt: new Date() } });
  return result.modifiedCount;
}

export async function commitReviewedRows(db: Db, importId: ObjectId) {
  const importRecord = await db.collection("imports").findOne({ _id: importId });
  if (!importRecord || importRecord.state !== "review_required") throw new Error("Only imports awaiting review can be committed");
  const rows = await db.collection("importRows").find({ importId, state: "reviewed" }).sort({ ordinal: 1 }).toArray();
  let created = 0;
  let merged = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const result = await upsertEntry(db, row.candidate as EntryCandidate);
      await transitionImportRow(db, row._id, "committed", { reason: "Approved candidate committed to archive.", entryId: result.entryId });
      if (result.created) created += 1; else merged += 1;
    } catch (error) {
      failed += 1;
      await transitionImportRow(db, row._id, "failed", { reason: "Archive commitment failed.", failure: error instanceof Error ? error.message : "Unknown error" });
    }
  }
  const stillReviewable = await db.collection("importRows").countDocuments({ importId, state: { $in: ["staged", "reviewed"] } });
  if (stillReviewable === 0) await transitionImport(db, importId, "committed", { reason: "All reviewed rows were committed, rejected, or recorded as failed.", summary: { created, merged } });
  else await db.collection("imports").updateOne({ _id: importId }, { $inc: { "summary.created": created, "summary.merged": merged }, $set: { updatedAt: new Date() } });
  return { rowsAttempted: rows.length, created, merged, failed, stillReviewable };
}

export const parseImportRowId = (id: string) => new MongoObjectId(id);
