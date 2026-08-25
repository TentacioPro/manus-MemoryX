import { Queue, Worker } from "bullmq";
import { MongoClient, ObjectId } from "mongodb";
import { processLocalImport } from "./process-import.js";

const mongoUrl = process.env.MONGO_URL ?? "";
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://redis:6379");
const importDirectory = process.env.IMPORT_DIR ?? "/imports";
if (!mongoUrl) throw new Error("MONGO_URL is required");

async function start() {
  const mongo = new MongoClient(mongoUrl);
  await mongo.connect();
  const database = mongo.db();
  await database.collection("taskLedger").createIndex({ timestamp: -1 });
  await database.collection("imports").createIndex({ state: 1, createdAt: -1 });
  const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) };
  const importQueue = new Queue("imports", { connection });
  const worker = new Worker("imports", async job => {
    const importId = job.data.importId;
    const importObjectId = new ObjectId(importId);
    await database.collection("jobs").updateOne({ queueJobId: job.id }, { $set: { state: "processing", progress: 5, updatedAt: new Date() } });
    await database.collection("imports").updateOne({ _id: importObjectId, state: "queued" }, { $set: { state: "processing", updatedAt: new Date(), stateReason: "Worker accepted local parsing job." } });
    await database.collection("importRows").updateMany({ importId: importObjectId, state: "failed" }, { $set: { state: "staged", failure: null, stateReason: "Returned to staging for local job retry.", updatedAt: new Date() } });
    const importRecord = await database.collection("imports").findOne({ _id: importObjectId });
    await database.collection("jobs").updateOne({ queueJobId: job.id }, { $set: { progress: 20, updatedAt: new Date() } });
    if (!importRecord) throw new Error("Import record was not found");
    const result = await processLocalImport(database, importRecord as never, importDirectory);
    await database.collection("jobs").updateOne({ queueJobId: job.id }, { $set: { state: "completed", progress: 100, updatedAt: new Date() } });
    return result;
  }, { connection });
  worker.on("completed", async job => {
    await database.collection("jobs").updateOne({ queueJobId: job.id }, { $set: { state: "completed", progress: 100, updatedAt: new Date() } });
  });
  worker.on("failed", async (job, error) => {
    await database.collection("jobs").updateOne({ queueJobId: job?.id }, { $set: { state: "failed", failure: error.message, updatedAt: new Date() } });
    if (job?.data.importId) {
      const importObjectId = new ObjectId(job.data.importId);
      await database.collection("imports").updateOne({ _id: importObjectId }, { $set: { state: "failed", failure: error.message, updatedAt: new Date() } });
      await database.collection("importRows").updateMany({ importId: importObjectId, state: { $in: ["staged", "reviewed"] } }, { $set: { state: "failed", failure: error.message, updatedAt: new Date() } });
    }
  });
  await database.collection("taskLedger").insertOne({ taskId: "runtime.worker", timestamp: new Date(), state: "ready", decision: "Start the local import worker process.", action: "Connected to MongoDB and Redis and declared the imports queue.", rationale: "Import work must be visible and isolated from UI requests.", evidence: "worker startup" });
  console.log("[worker] Ready for import jobs", { queue: importQueue.name });
}

start().catch(error => { console.error("[worker] Failed to start", error); process.exit(1); });
