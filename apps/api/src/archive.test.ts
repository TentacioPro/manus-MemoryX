import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { removeAttachmentReference, upsertEntry } from "./archive.js";

type Doc = Record<string, any>;
function makeDb() {
  const entries: Doc[] = []; const links: Doc[] = [];
  const same = (one: unknown, two: unknown) => one instanceof ObjectId && two instanceof ObjectId ? one.equals(two) : one === two;
  return {
    collection(name: string) {
      if (name === "entries") return {
        findOne: async (filter: Doc) => entries.find(entry => entry.fingerprint === filter.fingerprint) ?? null,
        insertOne: async (document: Doc) => { const stored = { ...document, _id: new ObjectId() }; entries.push(stored); return { insertedId: stored._id }; },
        updateOne: async (filter: Doc, update: Doc) => { const entry = entries.find(item => same(item._id, filter._id)); if (!entry) throw new Error("Entry not found"); Object.assign(entry, update.$set); for (const [key, value] of Object.entries(update.$addToSet ?? {})) { entry[key] ??= []; const values = (value as any).$each ?? [value]; values.forEach((item: unknown) => { if (!entry[key].some((current: unknown) => same(current, item) || JSON.stringify(current) === JSON.stringify(item))) entry[key].push(item); }); } return { modifiedCount: 1 }; },
      };
      if (name === "links") return {
        findOneAndUpdate: async (filter: Doc, update: Doc) => { const existing = links.find(item => item.canonicalUrl === filter.canonicalUrl); const link: Doc = existing ?? { _id: new ObjectId(), canonicalUrl: filter.canonicalUrl, ...(update.$setOnInsert ?? {}) }; if (!existing) links.push(link); Object.assign(link, update.$set); const values = (update.$addToSet?.originalUrls as string[] | string | undefined); for (const value of Array.isArray(values) ? values : values ? [values] : []) { link.originalUrls ??= []; if (!link.originalUrls.includes(value)) link.originalUrls.push(value); } return link; },
      };
      throw new Error(`Unexpected collection: ${name}`);
    }, entries, links,
  } as any;
}
const source = { sourceKind: "manual_url" as const, sourceId: "manual:1", sourceLabel: "Manual", importedAt: new Date("2026-08-25T00:00:00Z") };

describe("archive entry signals", () => {
  it("persists an invalid-link state for a malformed locally supplied URL", async () => {
    const db = makeDb();
    await upsertEntry(db, { text: "Broken reference", urls: ["not a valid url"], source });
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0].linkState).toBe("invalid");
    expect(db.entries[0].invalidLinkCount).toBe(1);
  });

  it("marks equivalent message content as merged rather than creating another archive card", async () => {
    const db = makeDb();
    const candidate = { text: "Useful repository https://github.com/example/project", urls: ["https://github.com/example/project?utm_source=share"], source };
    await upsertEntry(db, candidate);
    await upsertEntry(db, candidate);
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0].duplicateState).toBe("merged");
    expect(db.entries[0].linkState).toBe("valid");
  });

  it("retains invalid-link count when the same malformed message is merged", async () => {
    const db = makeDb();
    const candidate = { text: "Repeated malformed reference", urls: ["not a valid url"], source };
    await upsertEntry(db, candidate);
    await upsertEntry(db, candidate);
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0].duplicateState).toBe("merged");
    expect(db.entries[0].linkState).toBe("invalid");
    expect(db.entries[0].invalidLinkCount).toBe(1);
  });

  it("keeps reviewed platform and content-type choices on initial and merged archive entries", async () => {
    const db = makeDb();
    const candidate = { text: "Curated learning reel", urls: ["https://www.instagram.com/reel/learn-ai/"], platform: "instagram", contentType: "educational reel", source };
    await upsertEntry(db, candidate);
    expect(db.entries[0].platform).toBe("instagram");
    expect(db.entries[0].contentType).toBe("educational reel");

    await upsertEntry(db, { ...candidate, platform: "curated-video", contentType: "reference clip" });
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0].platform).toBe("curated-video");
    expect(db.entries[0].contentType).toBe("reference clip");
  });

  it("removes both entry and attachment metadata references before orphan cleanup is requested", async () => {
    const entryId = new ObjectId("0000000000000000000000b1"); const attachmentId = new ObjectId("0000000000000000000000b2"); const calls: string[] = [];
    const db = { collection(name: string) { if (name === "entries") return { updateOne: async () => { calls.push("entry"); return { modifiedCount: 1 }; } }; if (name === "attachments") return { updateOne: async () => { calls.push("attachment"); return { modifiedCount: 1 }; } }; throw new Error(`Unexpected collection ${name}`); } } as any;
    await removeAttachmentReference(db, entryId, attachmentId);
    expect(calls).toEqual(["entry", "attachment"]);
  });
});
