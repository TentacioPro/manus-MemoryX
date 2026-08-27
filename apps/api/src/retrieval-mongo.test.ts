import { describe, expect, it } from "vitest";
import { createMongoLexicalSearch } from "./retrieval-mongo.js";

describe("MongoDB lexical document retrieval", () => {
  it("uses the document chunk text index with metadata filters and projects citation-ready chunk data", async () => {
    let filter: unknown;
    let projection: unknown;
    let sort: unknown;
    let limit: unknown;
    const search = createMongoLexicalSearch({
      find(value, options) {
        filter = value;
        projection = options;
        return {
          sort(value: unknown) { sort = value; return this; },
          limit(value: unknown) { limit = value; return this; },
          async toArray() { return [{ fingerprint: "chunk-a", sourceAttachmentId: "attachment-a", text: "Exact lexical hit.", headingPath: ["Findings"], pageStart: 9, pageEnd: 9, score: 4.2 }]; },
        };
      },
    });

    await expect(search({ query: "lexical hit", filters: { mimeType: "application/pdf", sourceAttachmentId: "attachment-a" } })).resolves.toEqual([
      { chunkId: "chunk-a", sourceAttachmentId: "attachment-a", text: "Exact lexical hit.", headingPath: ["Findings"], pageStart: 9, pageEnd: 9, score: 4.2 },
    ]);
    expect(filter).toEqual({ $text: { $search: "lexical hit" }, mimeType: "application/pdf", sourceAttachmentId: "attachment-a" });
    expect(projection).toEqual({ projection: { score: { $meta: "textScore" }, fingerprint: 1, sourceAttachmentId: 1, text: 1, headingPath: 1, pageStart: 1, pageEnd: 1 } });
    expect(sort).toEqual({ score: { $meta: "textScore" } });
    expect(limit).toBe(40);
  });

  it("fails closed on unsupported or blank metadata constraints", async () => {
    const search = createMongoLexicalSearch({ find: () => { throw new Error("not called"); } });
    await expect(search({ query: "test", filters: { platform: "x" } })).rejects.toThrow("Unsupported lexical filter: platform");
    await expect(search({ query: "test", filters: { mimeType: " " } })).rejects.toThrow("Unsupported lexical filter: mimeType");
  });
});
