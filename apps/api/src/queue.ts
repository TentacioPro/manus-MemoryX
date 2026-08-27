import { Queue } from "bullmq";
import type { Db, ObjectId } from "mongodb";
import { transitionImport } from "./imports.js";

const parsed = new URL(process.env.REDIS_URL ?? "redis://redis:6379");
const connection = { host: parsed.hostname, port: Number(parsed.port || 6379) };
const importsQueue = new Queue("imports", { connection });
const documentIndexQueue = new Queue("document-index", { connection });

type QueueLike = { add(name: string, data: Record<string, string>, options: { attempts: number; backoff: { type: "exponential"; delay: number }; removeOnComplete: number; removeOnFail: number }): Promise<{ id?: string | number | undefined }> };
const retryOptions = { attempts: 3, backoff: { type: "exponential" as const, delay: 1000 }, removeOnComplete: 1000, removeOnFail: 1000 };

export async function enqueueImport(db: Db, importId: ObjectId) {
  const job = await importsQueue.add("process-import", { importId: importId.toHexString() }, retryOptions);
  await db.collection("jobs").insertOne({ queueJobId: job.id, importId, kind: "process-import", state: "queued", progress: 0, attemptsMade: 0, createdAt: new Date(), updatedAt: new Date() });
  await db.collection("imports").updateOne({ _id: importId }, { $addToSet: { jobIds: job.id }, $set: { updatedAt: new Date() } });
  await transitionImport(db, importId, "queued", { reason: "Scheduled import parsing in the local Redis worker." });
  return job.id;
}

export async function enqueueDocumentIndex(db: Db, attachmentId: ObjectId, queue: QueueLike = documentIndexQueue) {
  const job = await queue.add("index-document", { attachmentId: attachmentId.toHexString() }, retryOptions);
  if (!job.id) throw new Error("Local document-index queue did not return a job identifier");
  await db.collection("jobs").insertOne({ queueJobId: job.id, attachmentId, kind: "index-document", state: "queued", progress: 0, attemptsMade: 0, createdAt: new Date(), updatedAt: new Date() });
  return job.id;
}
