import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { stageManualUrl } from "./manual-capture.js";

type Doc = Record<string, any>;

function makeDb() {
  const collections = new Map<string, Doc[]>();
  const get = (name: string) => collections.get(name) ?? (collections.set(name, []), collections.get(name)!);
  const same = (left: unknown, right: unknown) => left instanceof ObjectId && right instanceof ObjectId ? left.equals(right) : left === right;
  const matches = (doc: Doc, filter: Doc) => Object.entries(filter).every(([key, value]) => same(doc[key], value));
  const setPath = (doc: Doc, key: string, value: unknown) => { const path = key.split("."); let target = doc; for (const part of path.slice(0, -1)) target = target[part] ?? (target[part] = {}); target[path.at(-1)!] = value; };
  const incrementPath = (doc: Doc, key: string, value: number) => setPath(doc, key, Number(key.split(".").reduce((result: any, part) => result?.[part], doc) ?? 0) + value);
  const collection = (name: string) => ({
    insertOne: async (doc: Doc) => { const stored = { ...doc, _id: doc._id ?? new ObjectId() }; get(name).push(stored); return { insertedId: stored._id }; },
    insertMany: async (docs: Doc[]) => { const insertedIds: Record<number, ObjectId> = {}; docs.forEach((doc, index) => { const stored = { ...doc, _id: new ObjectId() }; get(name).push(stored); insertedIds[index] = stored._id; }); return { insertedIds }; },
    findOne: async (filter: Doc) => get(name).find(doc => matches(doc, filter)) ?? null,
    updateOne: async (filter: Doc, operation: Doc) => { const doc = get(name).find(item => matches(item, filter)); if (!doc) return { modifiedCount: 0 }; Object.entries(operation.$set ?? {}).forEach(([key, value]) => setPath(doc, key, value)); Object.entries(operation.$inc ?? {}).forEach(([key, value]) => incrementPath(doc, key, Number(value))); Object.entries(operation.$addToSet ?? {}).forEach(([key, value]) => { const values = Array.isArray(value) ? value : [value]; doc[key] ??= []; values.forEach(item => { if (!doc[key].some((current: unknown) => same(current, item))) doc[key].push(item); }); }); return { modifiedCount: 1 }; },
  });
  return { collection: (name: string) => collection(name), docs: (name: string) => get(name) } as any;
}

describe("manual URL capture", () => {
  it("creates a canonicalized import, stages one provenance row, and waits for review", async () => {
    const db = makeDb();
    const result = await stageManualUrl(db, { url: "https://youtu.be/exampleVideo?si=tracking", title: "Educational video", note: "Watch later", tags: ["video"], topics: ["AI"], sourceLabel: "Manual learning" });
    expect(result.canonicalUrl).toBe("https://youtube.com/watch?v=exampleVideo");
    const imports = db.docs("imports");
    const rows = db.docs("importRows");
    expect(imports).toHaveLength(1);
    expect(imports[0].state).toBe("review_required");
    expect(imports[0].provenance.canonicalUrl).toBe("https://youtube.com/watch?v=exampleVideo");
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("staged");
    expect(rows[0].candidate.source.sourceKind).toBe("manual_url");
    expect(rows[0].candidate.urls).toEqual(["https://youtu.be/exampleVideo?si=tracking"]);
  });
});
