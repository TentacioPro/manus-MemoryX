import express from "express";
import cors from "cors";
import Busboy from "busboy";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { ObjectId } from "mongodb";
import { appRouter } from "./routers.js";
import { ensureIndexes, getDatabase } from "./db.js";
import { deleteOrphanAttachment, getAttachmentDownloadUrl, saveAttachment } from "./storage.js";
import { recordLedger } from "./ledger.js";
import { createImport } from "./imports.js";
import { enqueueImport } from "./queue.js";
import { stageManualUrl } from "./manual-capture.js";
import { buildArchiveFilter } from "./archive-query.js";
import { attachImportMetadata } from "./import-summary.js";
import { removeAttachmentReference } from "./archive.js";

const port = Number(process.env.PORT ?? 8787);

async function start() {
  const db = await ensureIndexes();
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: () => ({ db }) }));
  app.get("/health", async (_req, res) => { await db.command({ ping: 1 }); res.json({ ok: true, service: "knowledge-vault-api", timestamp: new Date().toISOString() }); });
  app.get("/api/status", async (_req, res) => res.json({ api: "ready", privacyMode: "local-only" }));
  app.post("/api/local-imports", async (req, res, next) => {
    try {
      const { kind, sourceLabel, fileName, provenance = {} } = req.body as { kind?: string; sourceLabel?: string; fileName?: string; provenance?: Record<string, unknown> };
      if (!kind || !["whatsapp", "instagram", "youtube", "manual", "csv"].includes(kind) || !sourceLabel || !fileName) return res.status(400).json({ error: "kind, sourceLabel, and fileName are required" });
      const importId = await createImport(db, { kind: kind as "whatsapp" | "instagram" | "youtube" | "manual" | "csv", sourceLabel, fileName, provenance });
      const jobId = await enqueueImport(db, importId);
      return res.status(202).json({ importId, jobId, state: "queued" });
    } catch (error) { return next(error); }
  });
  app.post("/api/manual-captures", async (req, res, next) => {
    try {
      const { url, title, note, tags, topics, platform, contentType, sourceLabel, enrichment } = req.body as { url?: string; title?: string; note?: string; tags?: string[]; topics?: string[]; platform?: string; contentType?: string; sourceLabel?: string; enrichment?: import("./manual-capture.js").LocalEnrichmentDraft };
      if (!url) return res.status(400).json({ error: "url is required" });
      return res.status(201).json(await stageManualUrl(db, { url, title, note, tags, topics, platform, contentType, sourceLabel, enrichment }));
    } catch (error) { return next(error); }
  });
  app.get("/api/archive/entries", async (req, res, next) => {
    try {
      const query = req.query as Record<string, string | undefined>;
      const { filter, search } = buildArchiveFilter(query);
      if (query.attachmentType) {
        const attachments = await db.collection("attachments").find({ mimeType: new RegExp(`^${query.attachmentType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`, "i"), state: "active" }, { projection: { _id: 1 } }).toArray();
        filter.attachmentIds = { $in: attachments.map(item => item._id) };
      }
      const rows = await db.collection("entries").find(filter, { projection: search ? { score: { $meta: "textScore" } } : undefined }).sort(search ? { score: { $meta: "textScore" } } : { originalTimestamp: -1, createdAt: -1 }).limit(Math.min(Number(query.limit ?? 250), 500)).toArray();
      const attachmentIds = rows.flatMap(entry => entry.attachmentIds ?? []);
      const attachments = attachmentIds.length ? await db.collection("attachments").find({ _id: { $in: attachmentIds }, state: "active" }).toArray() : [];
      const attachmentById = new Map(attachments.map(attachment => [attachment._id.toHexString(), attachment]));
      res.json(rows.map(entry => ({ ...entry, attachments: (entry.attachmentIds ?? []).map((id: ObjectId) => attachmentById.get(id.toHexString())).filter(Boolean) })));
    } catch (error) { next(error); }
  });
  app.patch("/api/archive/entries/:id/state", async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid entry id" });
      const state = String(req.body?.state ?? "");
      if (!["inbox", "review", "saved", "archived"].includes(state)) return res.status(400).json({ error: "Invalid workflow state" });
      await db.collection("entries").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { workflowState: state, updatedAt: new Date() } });
      await recordLedger(db, { taskId: "entry.workflow", state: "completed", decision: `Move archive entry to ${state}.`, action: `Updated workflow state for ${req.params.id}.`, rationale: "Kanban workflow changes must be durable and auditable.", evidence: `workflowState=${state}` });
      return res.json({ success: true });
    } catch (error) { return next(error); }
  });
  app.delete("/api/archive/entries/:entryId/attachments/:attachmentId", async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.entryId) || !ObjectId.isValid(req.params.attachmentId)) return res.status(400).json({ error: "Invalid entry or attachment id" });
      await removeAttachmentReference(db, new ObjectId(req.params.entryId), new ObjectId(req.params.attachmentId));
      await recordLedger(db, { taskId: "attachment.unlink", state: "completed", decision: "Remove an attachment reference from an archive entry.", action: `Unlinked attachment ${req.params.attachmentId} from entry ${req.params.entryId}.`, rationale: "References must be removed before orphan-safe storage cleanup can occur.", evidence: `entry=${req.params.entryId}; attachment=${req.params.attachmentId}` });
      return res.json({ success: true });
    } catch (error) { return next(error); }
  });
  app.get("/api/imports", async (_req, res) => {
    const imports = await db.collection("imports").find().sort({ createdAt: -1 }).limit(100).toArray();
    const rows = imports.length ? await db.collection<{ importId: ObjectId; candidate?: { topics?: string[]; source?: { captureMethod?: string } } }>("importRows").find({ importId: { $in: imports.map(item => item._id) } }, { projection: { importId: 1, "candidate.topics": 1, "candidate.source.captureMethod": 1 } }).toArray() : [];
    res.json(attachImportMetadata(imports, rows));
  });
  app.get("/api/imports/:id/rows", async (req, res, next) => { try { if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid import id" }); return res.json(await db.collection("importRows").find({ importId: new ObjectId(req.params.id) }).sort({ ordinal: 1 }).toArray()); } catch (error) { return next(error); } });
  app.get("/api/jobs", async (_req, res) => res.json(await db.collection("jobs").find().sort({ createdAt: -1 }).limit(100).toArray()));
  app.get("/api/attachments", async (_req, res) => res.json(await db.collection("attachments").find({ state: "active" }).sort({ createdAt: -1 }).limit(300).toArray()));
  app.get("/api/ledger", async (_req, res) => res.json(await db.collection("taskLedger").find().sort({ timestamp: -1 }).limit(300).toArray()));

  app.post("/api/attachments/upload", (req, res, next) => {
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 4 * 1024 * 1024 * 1024 } });
    let upload: Promise<unknown> | null = null;
    busboy.on("file", (_field, file, info) => { upload = saveAttachment(db, { stream: file, filename: info.filename, mimeType: info.mimeType }); });
    busboy.on("close", async () => {
      try {
        if (!upload) throw new Error("No attachment was received");
        const result = await upload;
        await recordLedger(db, { taskId: "attachment.upload", state: "completed", decision: "Store supplied attachment in local MinIO.", action: "Streamed an attachment to object storage and created or reused checksum metadata.", rationale: "File bytes remain outside MongoDB and duplicate files share a single stored object.", evidence: JSON.stringify(result) });
        res.status(201).json(result);
      } catch (error) { next(error); }
    });
    req.pipe(busboy);
  });

  app.get("/api/attachments/:id/download", async (req, res, next) => {
    try {
      const download = await getAttachmentDownloadUrl(db, new ObjectId(req.params.id));
      if (!download) return res.status(404).json({ error: "Attachment not found" });
      return res.redirect(download.url);
    } catch (error) { return next(error); }
  });

  app.delete("/api/attachments/:id", async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid attachment id" });
      const result = await deleteOrphanAttachment(db, new ObjectId(req.params.id));
      if (!result.deleted) return res.status(409).json({ error: result.reason });
      return res.json(result);
    } catch (error) { return next(error); }
  });

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[api] Request failed", error);
    res.status(500).json({ error: error.message || "Unexpected server error" });
  });

  app.listen(port, "0.0.0.0", async () => {
    await recordLedger(db, { taskId: "runtime.api", state: "ready", decision: "Start the local API process.", action: "Connected MongoDB, ensured indexes, and exposed tRPC, health, upload, and attachment download endpoints.", rationale: "The frontend and worker need a stable local typed service boundary.", evidence: `http://localhost:${port}` });
    console.log(`[api] Knowledge Vault API listening on ${port}`);
  });
}

start().catch(error => { console.error("[api] Failed to start", error); process.exit(1); });
