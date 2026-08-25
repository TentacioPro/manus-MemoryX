import { Queue } from "bullmq";
import type { Db, ObjectId } from "mongodb";
import { transitionImport } from "./imports.js";

const parsed = new URL(process.env.REDIS_URL ?? "redis://redis:6379");
const connection = { host: parsed.hostname, port: Number(parsed.port || 6379) };
const importsQueue = new Queue("imports", { connection });

export async function enqueueImport(db: Db, importId: ObjectId) {
  const job = await importsQueue.add("process-import", { importId: importId.toHexString() }, { attempts: 3, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 1000, removeOnFail: 1000 });
  await db.collection("jobs").insertOne({ queueJobId: job.id, importId, kind: "process-import", state: "queued", progress: 0, attemptsMade: 0, createdAt: new Date(), updatedAt: new Date() });
  await db.collection("imports").updateOne({ _id: importId }, { $addToSet: { jobIds: job.id }, $set: { updatedAt: new Date() } });
  await transitionImport(db, importId, "queued", { reason: "Scheduled import parsing in the local Redis worker." });
  return job.id;
}
