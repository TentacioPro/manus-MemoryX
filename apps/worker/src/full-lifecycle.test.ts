import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createImport, transitionImport } from "../../api/src/imports.js";
import { parseSocialExport } from "./parsers.js";
import { processLocalImport } from "./process-import.js";

type Doc = Record<string, any>;
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function makeLifecycleDb() {
  const imports: Doc[] = []; const rows: Doc[] = []; const ledger: Doc[] = []; const transitions: string[] = [];
  const same = (left: unknown, right: unknown) => left instanceof ObjectId && right instanceof ObjectId ? left.equals(right) : left === right;
  return {
    imports, rows, ledger, transitions,
    db: { collection(name: string) {
      if (name === "imports") return {
        insertOne: async (document: Doc) => { const stored: Doc = { ...document, _id: new ObjectId() }; imports.push(stored); transitions.push(stored.state); return { insertedId: stored._id }; },
        findOne: async (filter: Doc) => imports.find(item => same(item._id, filter._id)) ?? null,
        updateOne: async (filter: Doc, update: Doc) => { const record = imports.find(item => same(item._id, filter._id)); if (!record) return { modifiedCount: 0 }; Object.assign(record, update.$set ?? {}); if (update.$set?.state) transitions.push(update.$set.state); return { modifiedCount: 1 }; },
      };
      if (name === "importRows") return {
        deleteMany: async (filter: Doc) => { const removed = rows.filter(row => same(row.importId, filter.importId) && filter.state.$in.includes(row.state)); rows.splice(0, rows.length, ...rows.filter(row => !removed.includes(row))); return { deletedCount: removed.length }; },
        insertMany: async (documents: Doc[]) => { rows.push(...documents.map(document => ({ ...document, _id: new ObjectId() }))); return { insertedCount: documents.length }; },
      };
      if (name === "taskLedger") return { insertOne: async (event: Doc) => { ledger.push(event); return { insertedId: new ObjectId() }; } };
      throw new Error(`Unexpected collection: ${name}`);
    } } as any,
  };
}

describe("full local export lifecycle fixtures", () => {
  it.each([
    { kind: "instagram" as const, sourceLabel: "Instagram export", fileName: "instagram.zip", archivePath: "your_instagram_activity/saved/saved_posts.json", fixtureName: "instagram-saved-export.json", captureMethod: "saved" },
    { kind: "youtube" as const, sourceLabel: "Google Takeout", fileName: "takeout.zip", archivePath: "YouTube and YouTube Music/playlists/Watch Later.json", fixtureName: "youtube-watch-later-export.json", captureMethod: "watch_later" },
  ])("creates, queues, processes, and stages a $kind export for review", async (scenario) => {
    const context = makeLifecycleDb();
    const importId = await createImport(context.db, { kind: scenario.kind, sourceLabel: scenario.sourceLabel, fileName: scenario.fileName, provenance: { source: "official_local_export" } });
    await transitionImport(context.db, importId, "queued", { reason: "Simulated local queue handoff." });
    await transitionImport(context.db, importId, "processing", { reason: "Simulated local worker start." });
    const record = context.imports[0] as any;
    const content = await readFile(fixture(scenario.fixtureName));
    const parsed = await parseSocialExport([{ path: scenario.archivePath, type: "File", buffer: async () => content } as never], record, new Map());
    await processLocalImport(context.db, record, "/imports", { parse: async () => parsed, saveArchive: async () => ({ objectKey: `imports/${scenario.fileName}`, checksumSha256: "fixture-checksum", sizeBytes: 1, duplicate: false }) });

    expect(context.transitions).toEqual(["received", "queued", "processing", "review_required"]);
    expect(context.imports[0].state).toBe("review_required");
    expect(context.rows.length).toBeGreaterThan(0);
    expect(context.rows[0]).toMatchObject({ state: "staged", candidate: { source: { sourceLabel: scenario.sourceLabel, captureMethod: scenario.captureMethod } } });
  });
});
