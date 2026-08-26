import type { Db, ObjectId } from "mongodb";
import { ObjectId as MongoObjectId } from "mongodb";
import { canonicalizeUrl, messageFingerprint, sourceReferenceFingerprint, type SourceReference } from "./domain.js";

export type EntryCandidate = {
  text: string;
  note?: string;
  title?: string;
  platform?: string | null;
  contentType?: string | null;
  tags?: string[];
  topics?: string[];
  workflowState?: "inbox" | "review" | "saved" | "archived";
  originalTimestamp?: Date | null;
  sender?: string | null;
  source: SourceReference;
  urls?: string[];
  attachmentIds?: ObjectId[];
};

const cleanStrings = (values: string[] = []) => [...new Set(values.map(value => value.trim()).filter(Boolean))];

export async function upsertLinks(db: Db, urls: string[] = []) {
  const unique = [...new Set(urls.map(value => value.trim()).filter(Boolean))];
  const ids: ObjectId[] = [];
  const results = [];
  for (const originalUrl of unique) {
    try {
      const normalized = canonicalizeUrl(originalUrl);
      const current = await db.collection("links").findOneAndUpdate(
        { canonicalUrl: normalized.canonicalUrl },
        { $setOnInsert: { canonicalUrl: normalized.canonicalUrl, platform: normalized.platform, createdAt: new Date() }, $addToSet: { originalUrls: originalUrl }, $set: { updatedAt: new Date(), isValid: true } },
        { upsert: true, returnDocument: "after" },
      );
      if (current?._id) ids.push(current._id);
      results.push({ originalUrl, ...normalized, linkId: current?._id ?? null });
    } catch {
      results.push({ originalUrl, canonicalUrl: null, platform: "web", isValid: false, linkId: null });
    }
  }
  return { ids, results };
}

export async function upsertEntry(db: Db, candidate: EntryCandidate) {
  const attachmentKeys = (candidate.attachmentIds ?? []).map(id => id.toHexString());
  const fingerprint = messageFingerprint({ sourceKind: candidate.source.sourceKind, originalTimestamp: candidate.originalTimestamp, sender: candidate.sender, text: candidate.text, attachmentKeys });
  const sourceFingerprint = sourceReferenceFingerprint(candidate.source);
  const links = await upsertLinks(db, candidate.urls);
  const invalidLinkCount = links.results.filter(link => !link.isValid).length;
  const linkState = invalidLinkCount > 0 ? "invalid" : "valid";
  const sourceRef = { ...candidate.source, sourceFingerprint };
  const existing = await db.collection("entries").findOne({ fingerprint });
  if (existing) {
    const approvedPlatform = candidate.platform?.trim();
    const approvedContentType = candidate.contentType?.trim();
    await db.collection("entries").updateOne({ _id: existing._id }, {
      $addToSet: {
        sourceRefs: sourceRef,
        sourceRefFingerprints: sourceFingerprint,
        linkIds: { $each: links.ids },
        attachmentIds: { $each: candidate.attachmentIds ?? [] },
        tags: { $each: cleanStrings(candidate.tags) },
        topics: { $each: cleanStrings(candidate.topics) },
      },
      $set: {
        updatedAt: new Date(),
        duplicateState: "merged",
        linkState,
        invalidLinkCount,
        ...(approvedPlatform ? { platform: approvedPlatform } : {}),
        ...(approvedContentType ? { contentType: approvedContentType } : {}),
      },
    });
    return { entryId: existing._id, created: false, fingerprint, links: links.results };
  }
  const platform = candidate.platform?.trim() || (links.results.find(link => link.isValid)?.platform ?? (candidate.source.sourceKind === "whatsapp_export" ? "whatsapp" : "manual"));
  const contentType = candidate.contentType?.trim() || null;
  const result = await db.collection("entries").insertOne({
    fingerprint,
    text: candidate.text,
    note: candidate.note ?? "",
    title: candidate.title ?? "",
    tags: cleanStrings(candidate.tags),
    topics: cleanStrings(candidate.topics),
    workflowState: candidate.workflowState ?? "inbox",
    duplicateState: "unique",
    linkState,
    invalidLinkCount,
    platform,
    contentType,
    sourceKinds: [candidate.source.sourceKind],
    sourceRefs: [sourceRef],
    sourceRefFingerprints: [sourceFingerprint],
    linkIds: links.ids,
    attachmentIds: candidate.attachmentIds ?? [],
    originalTimestamp: candidate.originalTimestamp ?? null,
    sender: candidate.sender ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { entryId: result.insertedId, created: true, fingerprint, links: links.results };
}

export async function removeAttachmentReference(db: Db, entryId: ObjectId, attachmentId: ObjectId) {
  const entries = db.collection<{ _id: ObjectId; attachmentIds: ObjectId[]; updatedAt: Date }>("entries");
  const attachments = db.collection<{ _id: ObjectId; entryIds: ObjectId[]; updatedAt: Date }>("attachments");
  await entries.updateOne({ _id: entryId }, { $pull: { attachmentIds: attachmentId }, $set: { updatedAt: new Date() } });
  await attachments.updateOne({ _id: attachmentId }, { $pull: { entryIds: entryId }, $set: { updatedAt: new Date() } });
}

export function toObjectIds(ids: string[] = []) { return ids.map(id => new MongoObjectId(id)); }
