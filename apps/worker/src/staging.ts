import type { Db, ObjectId } from "mongodb";
import type { ParsedCandidate } from "./parsers.js";

export async function stageParsedRows(db: Db, importId: ObjectId, rows: ParsedCandidate[], summary: Record<string, unknown> = {}) {
  await db.collection("importRows").deleteMany({ importId, state: { $in: ["staged", "failed", "cancelled"] } });
  if (rows.length) await db.collection("importRows").insertMany(rows.map(row => ({ importId, ordinal: row.ordinal, candidate: row.candidate, warnings: row.warnings, duplicateState: row.duplicateState ?? "unique", state: "staged", createdAt: new Date(), updatedAt: new Date() })));
  await db.collection("imports").updateOne({ _id: importId }, { $set: { state: "review_required", updatedAt: new Date(), stateReason: "Local export parsed; review candidates before archive commitment.", summary: { ...summary, parsed: rows.length, staged: rows.length } } });
  return rows.length;
}
