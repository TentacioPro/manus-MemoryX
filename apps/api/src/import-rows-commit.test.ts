import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { commitReviewedRows } from "./import-rows.js";

type Doc = Record<string, any>;

function makeCommitDb() {
  const importId = new ObjectId("0000000000000000000000d1");
  const rowId = new ObjectId("0000000000000000000000d2");
  const imports: Doc[] = [{ _id: importId, state: "review_required", summary: { staged: 1, created: 0, merged: 0 }, warnings: [] }];
  const rows: Doc[] = [{ _id: rowId, importId, ordinal: 1, state: "reviewed", candidate: { text: "Curated AI reel", title: "My edited AI reel", platform: "instagram", contentType: "educational reel", tags: ["edited-tag"], topics: ["My topic"], urls: ["https://www.instagram.com/reel/learn-ai/?utm_source=share"], enrichment: { method: "heuristic", userAction: "edited", suggestions: { title: "Learn Ai", platform: "instagram", contentType: "reel", tags: ["reel"], topics: ["instagram"] } }, source: { sourceKind: "manual_url", sourceId: "manual:1", sourceLabel: "Manual capture", originalUrl: "https://www.instagram.com/reel/learn-ai/?utm_source=share", captureMethod: "manual", importedAt: new Date("2026-08-26T00:00:00Z") } } }];
  const entries: Doc[] = []; const links: Doc[] = []; const ledger: Doc[] = [];
  const setPath = (target: Doc, path: string, value: unknown) => { const parts = path.split("."); let current = target; for (const part of parts.slice(0, -1)) current = current[part] ?? (current[part] = {}); current[parts.at(-1)!] = value; };
  const incrementPath = (target: Doc, path: string, value: number) => { const parts = path.split("."); let current: any = target; for (const part of parts.slice(0, -1)) current = current[part] ?? (current[part] = {}); const last = parts.at(-1)!; current[last] = Number(current[last] ?? 0) + value; };
  const sameId = (left: ObjectId, right: ObjectId) => left.equals(right);
  const db = { collection(name: string) {
    if (name === "imports") return {
      findOne: async (filter: Doc) => imports.find(item => sameId(item._id, filter._id)) ?? null,
      updateOne: async (filter: Doc, update: Doc) => { const item = imports.find(record => sameId(record._id, filter._id)); if (!item) return { modifiedCount: 0 }; Object.entries(update.$set ?? {}).forEach(([key, value]) => setPath(item, key, value)); Object.entries(update.$inc ?? {}).forEach(([key, value]) => incrementPath(item, key, Number(value))); return { modifiedCount: 1 }; },
    };
    if (name === "importRows") return {
      findOne: async (filter: Doc) => rows.find(item => sameId(item._id, filter._id)) ?? null,
      find: (filter: Doc) => ({ sort: () => ({ toArray: async () => rows.filter(item => sameId(item.importId, filter.importId) && item.state === filter.state) }) }),
      updateOne: async (filter: Doc, update: Doc) => { const item = rows.find(record => sameId(record._id, filter._id)); if (!item) return { modifiedCount: 0 }; Object.entries(update.$set ?? {}).forEach(([key, value]) => setPath(item, key, value)); return { modifiedCount: 1 }; },
      countDocuments: async (filter: Doc) => rows.filter(item => sameId(item.importId, filter.importId) && filter.state.$in.includes(item.state)).length,
    };
    if (name === "entries") return {
      findOne: async (filter: Doc) => entries.find(item => item.fingerprint === filter.fingerprint) ?? null,
      insertOne: async (document: Doc) => { const stored = { ...document, _id: new ObjectId() }; entries.push(stored); return { insertedId: stored._id }; },
      updateOne: async () => ({ modifiedCount: 1 }),
    };
    if (name === "links") return {
      findOneAndUpdate: async (filter: Doc, update: Doc) => { const current = links.find(item => item.canonicalUrl === filter.canonicalUrl) ?? { _id: new ObjectId(), canonicalUrl: filter.canonicalUrl, ...(update.$setOnInsert ?? {}) }; if (!links.includes(current)) links.push(current); Object.assign(current, update.$set ?? {}); const originalUrl = update.$addToSet?.originalUrls; if (originalUrl) { current.originalUrls ??= []; if (!current.originalUrls.includes(originalUrl)) current.originalUrls.push(originalUrl); } return current; },
    };
    if (name === "taskLedger") return { insertOne: async (event: Doc) => { ledger.push(event); return { insertedId: new ObjectId() }; } };
    throw new Error(`Unexpected collection: ${name}`);
  } } as any;
  return { db, importId, rows, imports, entries, links, ledger };
}

describe("reviewed-row commitment", () => {
  it("creates an archive entry with reviewed values, normalized link provenance, and a committed row", async () => {
    const context = makeCommitDb();
    const result = await commitReviewedRows(context.db, context.importId);

    expect(result).toMatchObject({ rowsAttempted: 1, created: 1, merged: 0, failed: 0, stillReviewable: 0 });
    expect(context.rows[0].state).toBe("committed");
    expect(context.rows[0].entryId).toEqual(context.entries[0]._id);
    expect(context.imports[0].state).toBe("committed");
    expect(context.entries[0]).toMatchObject({ title: "My edited AI reel", platform: "instagram", contentType: "educational reel", tags: ["edited-tag"], topics: ["My topic"] });
    expect(context.entries[0].sourceRefs[0]).toMatchObject({ sourceKind: "manual_url", sourceLabel: "Manual capture", originalUrl: "https://www.instagram.com/reel/learn-ai/?utm_source=share" });
    expect(context.links[0].canonicalUrl).toBe("https://instagram.com/reel/learn-ai/");
    expect(context.links[0].originalUrls).toContain("https://www.instagram.com/reel/learn-ai/?utm_source=share");
  });
});
