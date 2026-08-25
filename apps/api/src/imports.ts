import type { Db, ObjectId } from "mongodb";
import { ObjectId as MongoObjectId } from "mongodb";
import { recordLedger } from "./ledger.js";

export type ImportState = "received" | "queued" | "processing" | "review_required" | "committed" | "failed" | "cancelled";
export type ImportKind = "whatsapp" | "instagram" | "youtube" | "manual" | "csv";

const allowedTransitions: Record<ImportState, ImportState[]> = {
  received: ["queued", "cancelled"],
  queued: ["processing", "failed", "cancelled"],
  processing: ["review_required", "failed", "cancelled"],
  review_required: ["committed", "cancelled", "queued"],
  committed: [],
  failed: ["queued", "cancelled"],
  cancelled: ["queued"],
};

export async function createImport(db: Db, input: { kind: ImportKind; sourceLabel: string; fileName?: string; archiveObjectKey?: string; provenance: Record<string, unknown> }) {
  const now = new Date();
  const result = await db.collection("imports").insertOne({
    kind: input.kind,
    sourceLabel: input.sourceLabel,
    fileName: input.fileName ?? null,
    archiveObjectKey: input.archiveObjectKey ?? null,
    provenance: input.provenance,
    state: "received" as ImportState,
    warnings: [],
    summary: { parsed: 0, staged: 0, created: 0, merged: 0, invalidLinks: 0, duplicateMedia: 0 },
    jobIds: [],
    createdAt: now,
    updatedAt: now,
  });
  await recordLedger(db, { taskId: "import.received", state: "completed", decision: "Create a local import record before parsing.", action: `Created ${input.kind} import ${result.insertedId.toHexString()}.`, rationale: "All import provenance, warnings, job state, and review decisions need a durable audit anchor.", evidence: `sourceLabel=${input.sourceLabel}; fileName=${input.fileName ?? "manual"}` });
  return result.insertedId;
}

export async function transitionImport(db: Db, importId: ObjectId, nextState: ImportState, details: { warning?: string; summary?: Record<string, number>; failure?: string; reason?: string } = {}) {
  const imports = db.collection("imports");
  const current = await imports.findOne({ _id: importId });
  if (!current) throw new Error("Import not found");
  const currentState = current.state as ImportState;
  if (currentState !== nextState && !allowedTransitions[currentState]?.includes(nextState)) throw new Error(`Cannot move import from ${currentState} to ${nextState}`);

  const update: Record<string, unknown> = { state: nextState, updatedAt: new Date() };
  if (details.summary) update.summary = { ...current.summary, ...details.summary };
  if (details.failure) update.failure = details.failure;
  if (details.reason) update.stateReason = details.reason;
  const operation = details.warning ? { $set: update, $addToSet: { warnings: details.warning } } : { $set: update };
  await imports.updateOne({ _id: importId }, operation);
  await recordLedger(db, { taskId: `import.${importId.toHexString()}`, state: nextState === "failed" ? "failed" : nextState === "cancelled" ? "cancelled" : "completed", decision: `Move import from ${currentState} to ${nextState}.`, action: details.reason ?? "Updated the import workflow state.", rationale: "Import stages must be explicit, recoverable, and visible before archive commitment.", evidence: details.failure ?? details.warning ?? JSON.stringify(details.summary ?? {}) });
}

export async function addImportRows(db: Db, importId: ObjectId, rows: Array<{ ordinal: number; candidate: Record<string, unknown>; warnings?: string[]; duplicateState?: "unique" | "possible_duplicate" | "duplicate" }>) {
  if (!rows.length) return 0;
  const now = new Date();
  await db.collection("importRows").insertMany(rows.map(row => ({ importId, ordinal: row.ordinal, candidate: row.candidate, warnings: row.warnings ?? [], duplicateState: row.duplicateState ?? "unique", state: "staged", createdAt: now, updatedAt: now })));
  await db.collection("imports").updateOne({ _id: importId }, { $set: { updatedAt: now }, $inc: { "summary.staged": rows.length } });
  return rows.length;
}

export async function getImport(db: Db, value: string) { return db.collection("imports").findOne({ _id: new MongoObjectId(value) }); }
