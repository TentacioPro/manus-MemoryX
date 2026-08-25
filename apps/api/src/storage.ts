import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { Client as MinioClient } from "minio";
import type { Db, ObjectId } from "mongodb";
import { recordLedger } from "./ledger.js";

const bucket = process.env.MINIO_BUCKET ?? "knowledge-vault";

export const minio = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT ?? "minio",
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

const safeFilename = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "attachment";

export async function ensureBucket() {
  if (!(await minio.bucketExists(bucket))) await minio.makeBucket(bucket);
}

export async function saveAttachment(
  db: Db,
  input: { stream: NodeJS.ReadableStream; filename: string; mimeType: string; sourceImportId?: ObjectId; entryIds?: ObjectId[] },
) {
  await ensureBucket();
  const temporaryKey = `temporary/${randomUUID()}/${safeFilename(input.filename)}`;
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const hashingStream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      sizeBytes += chunk.length;
      callback(null, chunk);
    },
  });
  const upload = minio.putObject(bucket, temporaryKey, hashingStream, undefined, { "Content-Type": input.mimeType || "application/octet-stream" });
  input.stream.pipe(hashingStream);
  await upload;
  const checksumSha256 = hash.digest("hex");
  const attachments = db.collection("attachments");
  const existing = await attachments.findOne({ checksumSha256, state: "active" });

  if (existing) {
    await minio.removeObject(bucket, temporaryKey);
    if (input.entryIds?.length) await attachments.updateOne({ _id: existing._id }, { $addToSet: { entryIds: { $each: input.entryIds } } });
    return { attachment: existing, deduplicated: true };
  }

  const objectKey = `attachments/${checksumSha256}/${randomUUID()}-${safeFilename(input.filename)}`;
  await minio.copyObject(bucket, objectKey, `/${bucket}/${temporaryKey}`);
  await minio.removeObject(bucket, temporaryKey);
  const result = await attachments.insertOne({
    objectKey,
    filename: input.filename,
    mimeType: input.mimeType || "application/octet-stream",
    sizeBytes,
    checksumSha256,
    sourceImportId: input.sourceImportId ?? null,
    entryIds: input.entryIds ?? [],
    state: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const attachment = await attachments.findOne({ _id: result.insertedId });
  if (!attachment) throw new Error("Attachment metadata was not created");
  return { attachment, deduplicated: false };
}

export async function getAttachmentDownloadUrl(db: Db, attachmentId: ObjectId) {
  const attachment = await db.collection("attachments").findOne({ _id: attachmentId, state: "active" });
  if (!attachment) return null;
  const url = await minio.presignedGetObject(bucket, attachment.objectKey, 60 * 10);
  return { attachment, url };
}

export async function deleteOrphanAttachment(db: Db, attachmentId: ObjectId) {
  const attachments = db.collection("attachments");
  const attachment = await attachments.findOne({ _id: attachmentId, state: "active" });
  if (!attachment) return { deleted: false, reason: "Attachment not found or already removed" };
  const referencedEntries = await db.collection("entries").countDocuments({ attachmentIds: attachmentId });
  if (referencedEntries > 0 || attachment.entryIds?.length > 0) return { deleted: false, reason: "Attachment is still referenced by an archive entry" };

  await attachments.updateOne({ _id: attachmentId }, { $set: { state: "orphaned", orphanedAt: new Date(), updatedAt: new Date() } });
  const sameObjectCount = await attachments.countDocuments({ objectKey: attachment.objectKey, state: "active" });
  if (sameObjectCount === 0) await minio.removeObject(bucket, attachment.objectKey);
  await attachments.deleteOne({ _id: attachmentId, state: "orphaned" });
  await recordLedger(db, { taskId: "attachment.delete", state: "completed", decision: "Delete only an orphaned attachment object.", action: `Removed orphan attachment ${attachmentId.toHexString()} from metadata and object storage.`, rationale: "Object storage is cleaned only after all active database entry references have been removed.", evidence: `objectKey=${attachment.objectKey}; liveReferences=${referencedEntries}` });
  return { deleted: true };
}
