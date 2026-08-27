import { MongoClient } from "mongodb";

const url = process.env.MONGO_URL;
if (!url) throw new Error("MONGO_URL is required");

export const mongo = new MongoClient(url);

export async function getDatabase() {
  await mongo.connect();
  return mongo.db();
}

export async function ensureIndexes() {
  const db = await getDatabase();
  await Promise.all([
    db.collection("entries").createIndex({ fingerprint: 1 }, { unique: true, sparse: true }),
    db.collection("entries").createIndex({ workflowState: 1, createdAt: -1 }),
    db.collection("entries").createIndex({ platform: 1, sourceKinds: 1, createdAt: -1 }),
    db.collection("entries").createIndex({ text: "text", note: "text", tags: "text", topics: "text" }),
    db.collection("links").createIndex({ canonicalUrl: 1 }, { unique: true }),
    db.collection("attachments").createIndex({ checksumSha256: 1 }, { unique: true }),
    db.collection("attachments").createIndex({ entryIds: 1, state: 1 }),
    db.collection("documents").createIndex({ sourceAttachmentId: 1 }, { unique: true }),
    db.collection("documents").createIndex({ state: 1, indexedAt: -1 }),
    db.collection("documentChunks").createIndex({ fingerprint: 1 }, { unique: true }),
    db.collection("documentChunks").createIndex({ sourceAttachmentId: 1, ordinal: 1 }),
    db.collection("documentChunks").createIndex({ text: "text", headingPath: "text" }),
    db.collection("notebooks").createIndex({ state: 1, updatedAt: -1 }),
    db.collection("notebookNotes").createIndex({ notebookId: 1, createdAt: -1 }),
    db.collection("imports").createIndex({ state: 1, createdAt: -1 }),
    db.collection("importRows").createIndex({ importId: 1, state: 1 }),
    db.collection("jobs").createIndex({ importId: 1, createdAt: -1 }),
    db.collection("jobs").createIndex({ attachmentId: 1, createdAt: -1 }),
    db.collection("taskLedger").createIndex({ timestamp: -1 }),
    db.collection("taskLedger").createIndex({ taskId: 1, timestamp: -1 }),
  ]);
  return db;
}
