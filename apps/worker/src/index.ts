import { Queue, Worker } from "bullmq";
import { MongoClient, ObjectId } from "mongodb";
import { createDoclingClient } from "./docling-client.js";
import { createDocumentIndexProcessor } from "./document-index-job.js";
import { indexLocalAttachment } from "./document-indexing.js";
import { createLocalEmbeddingClient } from "./local-models.js";
import { processLocalImport } from "./process-import.js";
import { createQdrantChunkWriter } from "./qdrant-vectors.js";
import { getInternalObjectUrl } from "./storage.js";

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
  const documentIndexQueue = new Queue("document-index", { connection });
  const docling = createDoclingClient({ url: process.env.DOCLING_URL ?? "http://docling:5001", fetch });
  const embedder = createLocalEmbeddingClient({ url: process.env.EMBEDDINGS_URL ?? "http://embeddings:80", fetch, dimensions: 1024, maxBatchSize: Number(process.env.TEI_MAX_CLIENT_BATCH_SIZE ?? 8) });
  const qdrant = createQdrantChunkWriter({ url: process.env.QDRANT_URL ?? "http://qdrant:6333", fetch });
  const documentIndexer = createDocumentIndexProcessor({
    findAttachment: attachmentId => database.collection("attachments").findOne({ _id: attachmentId, state: "active" }) as never,
    createInternalSourceUrl: getInternalObjectUrl,
    setDocumentState: async state => {
      const now = new Date();
      await database.collection("documents").updateOne({ sourceAttachmentId: state.attachmentId.toHexString() }, { $set: { ...state, sourceAttachmentId: state.attachmentId.toHexString(), updatedAt: now, ...(state.state === "processing" ? { startedAt: now } : {}) } }, { upsert: true });
    },
    ensureActiveCollection: () => qdrant.ensureActiveCollection(),
    indexAttachment: value => indexLocalAttachment(database as never, { ...value, converter: docling, embedder, upsertVectors: qdrant.upsert, embeddingModel: process.env.EMBEDDING_MODEL ?? "BAAI/bge-m3", embeddingDimensions: 1024 }),
  });
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
  const documentWorker = new Worker("document-index", async job => {
    const attachmentId = new ObjectId(job.data.attachmentId);
    await database.collection("jobs").updateOne({ queueJobId: job.id }, { $set: { state: "processing", progress: 5, attemptsMade: job.attemptsMade, updatedAt: new Date() } });
    const result = await documentIndexer.process(attachmentId);
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
  documentWorker.on("failed", async (job, error) => {
    await database.collection("jobs").updateOne({ queueJobId: job?.id }, { $set: { state: "failed", failure: error.message, updatedAt: new Date() } });
    if (job?.data.attachmentId && ObjectId.isValid(job.data.attachmentId)) {
      const attachmentId = new ObjectId(job.data.attachmentId);
      await database.collection("documents").updateOne({ sourceAttachmentId: attachmentId.toHexString() }, { $set: { state: "failed", failure: error.message, updatedAt: new Date() } }, { upsert: true });
    }
  });
  await database.collection("taskLedger").insertOne({ taskId: "runtime.worker", timestamp: new Date(), state: "ready", decision: "Start the local import worker process.", action: "Connected to MongoDB and Redis and declared the imports queue.", rationale: "Import work must be visible and isolated from UI requests.", evidence: "worker startup" });
  console.log("[worker] Ready for local import and document-index jobs", { importQueue: importQueue.name, documentIndexQueue: documentIndexQueue.name });
}

start().catch(error => { console.error("[worker] Failed to start", error); process.exit(1); });
