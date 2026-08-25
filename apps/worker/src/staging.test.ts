import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { parseSocialExport } from "./parsers.js";
import { stageParsedRows } from "./staging.js";
import { processLocalImport } from "./process-import.js";

type Doc = Record<string, any>;
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
function fakeDb(importDoc: Doc) {
  const imports = [importDoc]; const rows: Doc[] = [];
  const same = (one: unknown, two: unknown) => one instanceof ObjectId && two instanceof ObjectId ? one.equals(two) : one === two;
  return {
    collection(name: string) {
      if (name === "imports") return { updateOne: async (filter: Doc, update: Doc) => { const doc = imports.find(item => same(item._id, filter._id)); if (!doc) throw new Error("Expected import document"); Object.assign(doc, update.$set); return { modifiedCount: 1 }; } };
      if (name === "importRows") return {
        deleteMany: async () => ({ deletedCount: 0 }),
        insertMany: async (documents: Doc[]) => { rows.push(...documents.map(document => ({ ...document, _id: new ObjectId() }))); return { insertedCount: documents.length }; },
      };
      throw new Error(`Unexpected collection ${name}`);
    },
    imports, rows,
  } as any;
}

describe("social export review staging", () => {
  it("persists Instagram saved candidates and media with a review_required import state", async () => {
    const importId = new ObjectId("000000000000000000000010");
    const db = fakeDb({ _id: importId, state: "processing", summary: {} });
    const content = await readFile(fixture("instagram-saved-export.json"));
    const parsed = await parseSocialExport([{ path: "your_instagram_activity/saved/saved_posts.json", type: "File", buffer: async () => content } as never], { _id: importId, kind: "instagram", sourceLabel: "Instagram export", fileName: "instagram.zip" }, new Map([["saved-image.jpg", new ObjectId("000000000000000000000011")]]));
    await stageParsedRows(db, importId, parsed);
    expect(db.imports[0].state).toBe("review_required");
    expect(db.rows).toHaveLength(2);
    expect(db.rows[0].state).toBe("staged");
    expect(db.rows[0].candidate.source.sourceLabel).toBe("Instagram export");
    expect(db.rows[0].candidate.source.captureMethod).toBe("saved");
  });

  it("persists YouTube Watch Later candidates with their source label and capture method", async () => {
    const importId = new ObjectId("000000000000000000000020");
    const db = fakeDb({ _id: importId, state: "processing", summary: {} });
    const content = await readFile(fixture("youtube-watch-later-export.json"));
    const parsed = await parseSocialExport([{ path: "YouTube and YouTube Music/playlists/Watch Later.json", type: "File", buffer: async () => content } as never], { _id: importId, kind: "youtube", sourceLabel: "Google Takeout", fileName: "takeout.zip" }, new Map());
    await stageParsedRows(db, importId, parsed);
    expect(db.imports[0].state).toBe("review_required");
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].candidate.source.sourceLabel).toBe("Google Takeout");
    expect(db.rows[0].candidate.source.captureMethod).toBe("watch_later");
  });

  it("runs an Instagram import through the worker processing path into persisted review rows", async () => {
    const importId = new ObjectId("000000000000000000000030");
    const record = { _id: importId, kind: "instagram" as const, sourceLabel: "Instagram export", fileName: "instagram.zip", summary: {} };
    const db = fakeDb({ ...record, state: "queued" });
    const content = await readFile(fixture("instagram-saved-export.json"));
    const parsed = await parseSocialExport([{ path: "your_instagram_activity/saved/saved_posts.json", type: "File", buffer: async () => content } as never], record, new Map());
    await processLocalImport(db, record, "/imports", { parse: async () => parsed, saveArchive: async () => ({ objectKey: "imports/test.zip", checksumSha256: "test", sizeBytes: 1, duplicate: false }) });
    expect(db.imports[0].state).toBe("review_required");
    expect(db.rows[0].candidate.source.sourceLabel).toBe("Instagram export");
    expect(db.rows[0].candidate.source.captureMethod).toBe("saved");
  });

  it("runs a YouTube Watch Later import through the worker processing path into persisted review rows", async () => {
    const importId = new ObjectId("000000000000000000000040");
    const record = { _id: importId, kind: "youtube" as const, sourceLabel: "Google Takeout", fileName: "takeout.zip", summary: {} };
    const db = fakeDb({ ...record, state: "queued" });
    const content = await readFile(fixture("youtube-watch-later-export.json"));
    const parsed = await parseSocialExport([{ path: "YouTube and YouTube Music/playlists/Watch Later.json", type: "File", buffer: async () => content } as never], record, new Map());
    await processLocalImport(db, record, "/imports", { parse: async () => parsed, saveArchive: async () => ({ objectKey: "imports/test.zip", checksumSha256: "test", sizeBytes: 1, duplicate: false }) });
    expect(db.imports[0].state).toBe("review_required");
    expect(db.rows[0].candidate.source.sourceLabel).toBe("Google Takeout");
    expect(db.rows[0].candidate.source.captureMethod).toBe("watch_later");
  });
});
