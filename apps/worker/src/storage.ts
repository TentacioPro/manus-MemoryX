import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { Transform } from "node:stream";
import { Client as MinioClient } from "minio";
import type { Db, ObjectId } from "mongodb";

const bucket = process.env.MINIO_BUCKET ?? "knowledge-vault";
const minio = new MinioClient({ endPoint: process.env.MINIO_ENDPOINT ?? "minio", port: Number(process.env.MINIO_PORT ?? 9000), useSSL: process.env.MINIO_USE_SSL === "true", accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
const safeName = (value: string) => basename(value).replace(/[^a-zA-Z0-9._-]+/g, "-") || "file";

async function ensureBucket() { if (!(await minio.bucketExists(bucket))) await minio.makeBucket(bucket); }

export async function saveStream(db: Db, input: { stream: NodeJS.ReadableStream; filename: string; mimeType: string; importId: ObjectId; kind: "attachment" | "import" }) {
  await ensureBucket();
  const temporaryKey = `temporary/${randomUUID()}-${safeName(input.filename)}`;
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const tap = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); sizeBytes += chunk.length; callback(null, chunk); } });
  const upload = minio.putObject(bucket, temporaryKey, tap, undefined, { "Content-Type": input.mimeType || "application/octet-stream" });
  input.stream.pipe(tap);
  await upload;
  const checksumSha256 = hash.digest("hex");
  const objectKey = input.kind === "import" ? `imports/${input.importId.toHexString()}/${checksumSha256}-${safeName(input.filename)}` : `attachments/${checksumSha256}/${safeName(input.filename)}`;
  if (input.kind === "attachment") {
    const existing = await db.collection("attachments").findOne({ checksumSha256, state: "active" });
    if (existing) { await minio.removeObject(bucket, temporaryKey); return { id: existing._id, objectKey: existing.objectKey, duplicate: true }; }
  }
  await minio.copyObject(bucket, objectKey, `/${bucket}/${temporaryKey}`);
  await minio.removeObject(bucket, temporaryKey);
  if (input.kind === "import") return { objectKey, checksumSha256, sizeBytes, duplicate: false };
  const result = await db.collection("attachments").insertOne({ objectKey, filename: input.filename, mimeType: input.mimeType || "application/octet-stream", sizeBytes, checksumSha256, sourceImportId: input.importId, entryIds: [], state: "active", createdAt: new Date(), updatedAt: new Date() });
  return { id: result.insertedId, objectKey, duplicate: false };
}

export const saveLocalImportArchive = (db: Db, importId: ObjectId, path: string, mimeType: string) => saveStream(db, { stream: createReadStream(path), filename: basename(path), mimeType, importId, kind: "import" });

export const getInternalObjectUrl = (objectKey: string) => minio.presignedGetObject(bucket, objectKey, 10 * 60);
