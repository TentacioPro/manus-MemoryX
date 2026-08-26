import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { deleteOrphanAttachment } from "./storage.js";
import { upsertEntry, removeAttachmentReference, toObjectIds } from "./archive.js";
import { canonicalizeUrl } from "./domain.js";
import { createImport, getImport, transitionImport } from "./imports.js";
import { enqueueImport } from "./queue.js";
import { cancelImportRow, commitReviewedRows, parseImportRowId, retryFailedRows, reviewImportRow } from "./import-rows.js";
import { stageManualUrl } from "./manual-capture.js";

export type Context = { db: Db };
const t = initTRPC.context<Context>().create();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id");
const localEnrichment = z.object({ method: z.enum(["heuristic", "local-model"]), userAction: z.enum(["accepted", "edited", "ignored"]), suggestions: z.object({ title: z.string().optional(), platform: z.string().optional(), contentType: z.string().optional(), tags: z.array(z.string()).optional(), topics: z.array(z.string()).optional(), summary: z.string().optional() }), finalFields: z.object({ platform: z.string().optional(), contentType: z.string().optional() }).optional() });

export const appRouter = t.router({
  system: t.router({
    status: t.procedure.query(async ({ ctx }) => ({
      api: "ready",
      privacyMode: "local-only",
      importsAwaitingReview: await ctx.db.collection("imports").countDocuments({ state: "review_required" }),
    })),
  }),
  attachments: t.router({
    list: t.procedure.query(async ({ ctx }) => ctx.db.collection("attachments").find({ state: "active" }).sort({ createdAt: -1 }).limit(200).toArray()),
    removeOrphan: t.procedure.input(z.object({ id: objectId })).mutation(async ({ ctx, input }) => deleteOrphanAttachment(ctx.db, new ObjectId(input.id))),
    unlink: t.procedure.input(z.object({ entryId: objectId, attachmentId: objectId })).mutation(async ({ ctx, input }) => {
      await removeAttachmentReference(ctx.db, new ObjectId(input.entryId), new ObjectId(input.attachmentId));
      return { success: true };
    }),
  }),
  links: t.router({
    normalize: t.procedure.input(z.object({ url: z.string().min(1) })).query(({ input }) => {
      try { return canonicalizeUrl(input.url); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "URL cannot be normalized" }); }
    }),
  }),
  entries: t.router({
    createOrMerge: t.procedure.input(z.object({
      text: z.string().default(""), note: z.string().optional(), title: z.string().optional(), platform: z.string().optional(), contentType: z.string().optional(), tags: z.array(z.string()).optional(), topics: z.array(z.string()).optional(),
      workflowState: z.enum(["inbox", "review", "saved", "archived"]).optional(), originalTimestamp: z.date().nullable().optional(), sender: z.string().nullable().optional(), urls: z.array(z.string()).optional(), attachmentIds: z.array(objectId).optional(),
      source: z.object({ sourceKind: z.enum(["whatsapp_export", "instagram_export", "youtube_takeout", "manual_url", "csv"]), sourceId: z.string(), sourceLabel: z.string(), originalUrl: z.string().optional(), originalTimestamp: z.date().nullable().optional(), sender: z.string().nullable().optional(), captureMethod: z.enum(["saved", "liked", "watch_later", "playlist", "manual", "shared"]).optional() }),
    })).mutation(async ({ ctx, input }) => upsertEntry(ctx.db, { ...input, attachmentIds: toObjectIds(input.attachmentIds), source: { ...input.source, importedAt: new Date() } })),
  }),
  imports: t.router({
    create: t.procedure.input(z.object({ kind: z.enum(["whatsapp", "instagram", "youtube", "manual", "csv"]), sourceLabel: z.string().min(1), fileName: z.string().optional(), archiveObjectKey: z.string().optional(), provenance: z.record(z.string(), z.unknown()).default({}) })).mutation(async ({ ctx, input }) => ({ id: await createImport(ctx.db, input) })),
    get: t.procedure.input(z.object({ id: objectId })).query(({ ctx, input }) => getImport(ctx.db, input.id)),
    list: t.procedure.query(({ ctx }) => ctx.db.collection("imports").find().sort({ createdAt: -1 }).limit(100).toArray()),
    queue: t.procedure.input(z.object({ id: objectId })).mutation(async ({ ctx, input }) => ({ jobId: await enqueueImport(ctx.db, new ObjectId(input.id)) })),
    cancel: t.procedure.input(z.object({ id: objectId })).mutation(async ({ ctx, input }) => { await transitionImport(ctx.db, new ObjectId(input.id), "cancelled", { reason: "Cancelled by local archive user before commitment." }); return { success: true }; }),
    rows: t.procedure.input(z.object({ id: objectId })).query(({ ctx, input }) => ctx.db.collection("importRows").find({ importId: new ObjectId(input.id) }).sort({ ordinal: 1 }).toArray()),
    reviewRow: t.procedure.input(z.object({ rowId: objectId, accepted: z.boolean(), reason: z.string().optional() })).mutation(({ ctx, input }) => reviewImportRow(ctx.db, parseImportRowId(input.rowId), input.accepted, input.reason)),
    cancelRow: t.procedure.input(z.object({ rowId: objectId, reason: z.string().optional() })).mutation(({ ctx, input }) => cancelImportRow(ctx.db, parseImportRowId(input.rowId), input.reason)),
    retryRows: t.procedure.input(z.object({ id: objectId })).mutation(({ ctx, input }) => retryFailedRows(ctx.db, new ObjectId(input.id))),
    commitReviewed: t.procedure.input(z.object({ id: objectId })).mutation(({ ctx, input }) => commitReviewedRows(ctx.db, new ObjectId(input.id))),
    captureUrl: t.procedure.input(z.object({ url: z.string().min(1), title: z.string().optional(), note: z.string().optional(), platform: z.string().optional(), contentType: z.string().optional(), tags: z.array(z.string()).optional(), topics: z.array(z.string()).optional(), sourceLabel: z.string().optional(), enrichment: localEnrichment.optional() })).mutation(({ ctx, input }) => stageManualUrl(ctx.db, input)),
  }),
  jobs: t.router({
    list: t.procedure.query(async ({ ctx }) => ctx.db.collection("jobs").find().sort({ createdAt: -1 }).limit(100).toArray()),
  }),
  ledger: t.router({
    list: t.procedure.input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional()).query(async ({ ctx, input }) => ctx.db.collection("taskLedger").find().sort({ timestamp: -1 }).limit(input?.limit ?? 100).toArray()),
  }),
});

export type AppRouter = typeof appRouter;
