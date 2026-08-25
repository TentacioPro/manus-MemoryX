import { lookup } from "mime-types";
import type { Db, ObjectId } from "mongodb";
import { parseLocalImport } from "./parsers.js";
import { saveLocalImportArchive } from "./storage.js";
import { stageParsedRows } from "./staging.js";

type ImportRecord = { _id: ObjectId; fileName?: string; kind: "whatsapp" | "instagram" | "youtube" | "manual" | "csv"; sourceLabel: string; archiveObjectKey?: string; summary?: Record<string, unknown> };

export async function processLocalImport(
  db: Db,
  importRecord: ImportRecord,
  importDirectory: string,
  dependencies: {
    parse?: typeof parseLocalImport;
    saveArchive?: typeof saveLocalImportArchive;
    stage?: typeof stageParsedRows;
  } = {},
) {
  if (!importRecord.fileName) throw new Error("Import has no local file name");
  const parse = dependencies.parse ?? parseLocalImport;
  const saveArchive = dependencies.saveArchive ?? saveLocalImportArchive;
  const stage = dependencies.stage ?? stageParsedRows;
  if (!importRecord.archiveObjectKey) {
    const archive = await saveArchive(db, importRecord._id, `${importDirectory}/incoming/${importRecord.fileName}`, lookup(importRecord.fileName) || "application/octet-stream");
    await db.collection("imports").updateOne({ _id: importRecord._id }, { $set: { archiveObjectKey: archive.objectKey, archiveChecksumSha256: archive.checksumSha256, archiveSizeBytes: archive.sizeBytes, updatedAt: new Date() } });
  }
  const rows = await parse(db, importRecord as never, importDirectory);
  await stage(db, importRecord._id, rows, importRecord.summary ?? {});
  return { parsed: rows.length, kind: importRecord.kind, message: "Local export parsed and staged for review." };
}
