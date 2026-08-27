import { describe, expect, it } from "vitest";
import { createHybridRetriever, reciprocalRankFuse } from "./retrieval.js";

const semantic = [
  { chunkId: "semantic-first", sourceAttachmentId: "a", text: "Semantic information about local document conversion.", headingPath: ["Docling"], pageStart: 3, pageEnd: 3, score: 0.92 },
  { chunkId: "shared", sourceAttachmentId: "b", text: "Hybrid retrieval combines lexical and dense ranking.", headingPath: ["RAG"], pageStart: 7, pageEnd: 8, score: 0.83 },
];
const lexical = [
  { chunkId: "shared", sourceAttachmentId: "b", text: "Hybrid retrieval combines lexical and dense ranking.", headingPath: ["RAG"], pageStart: 7, pageEnd: 8, score: 9.4 },
  { chunkId: "lexical-first", sourceAttachmentId: "c", text: "Lexical score matching for known terms.", headingPath: ["Search"], pageStart: null, pageEnd: null, score: 7.2 },
];

describe("local hybrid retrieval", () => {
  it("fuses lexical and semantic rankings using reciprocal rank fusion without discarding source spans", () => {
    const fused = reciprocalRankFuse([semantic, lexical], 60);
    expect(fused.map(item => item.chunkId)).toEqual(["shared", "semantic-first", "lexical-first"]);
    expect(fused[0]).toMatchObject({ sourceAttachmentId: "b", headingPath: ["RAG"], pageStart: 7, pageEnd: 8, retrievalScore: expect.any(Number) });
  });

  it("queries both local indexes, reranks the fused shortlist, and returns citation-ready results", async () => {
    const calls: Array<{ kind: string; query: string; filters?: Record<string, unknown> }> = [];
    const retriever = createHybridRetriever({
      semanticSearch: async ({ query, filters }) => { calls.push({ kind: "semantic", query, filters }); return semantic; },
      lexicalSearch: async ({ query, filters }) => { calls.push({ kind: "lexical", query, filters }); return lexical; },
      rerank: async ({ query, texts }) => {
        calls.push({ kind: "rerank", query });
        expect(texts).toHaveLength(3);
        return [{ index: 1, score: 0.98 }, { index: 0, score: 0.67 }, { index: 2, score: 0.12 }];
      },
    });

    const result = await retriever.retrieve({ query: "hybrid document retrieval", filters: { mimeType: "application/pdf", notebookId: "notebook-1" }, limit: 2 });

    expect(calls).toEqual([
      { kind: "semantic", query: "hybrid document retrieval", filters: { mimeType: "application/pdf", notebookId: "notebook-1" } },
      { kind: "lexical", query: "hybrid document retrieval", filters: { mimeType: "application/pdf", notebookId: "notebook-1" } },
      { kind: "rerank", query: "hybrid document retrieval" },
    ]);
    expect(result).toEqual([
      expect.objectContaining({ chunkId: "semantic-first", rerankScore: 0.98, citation: { sourceAttachmentId: "a", headingPath: ["Docling"], pageStart: 3, pageEnd: 3 } }),
      expect.objectContaining({ chunkId: "shared", rerankScore: 0.67, citation: { sourceAttachmentId: "b", headingPath: ["RAG"], pageStart: 7, pageEnd: 8 } }),
    ]);
  });

  it("rejects blank queries and unbounded result sizes", async () => {
    const retriever = createHybridRetriever({ semanticSearch: async () => [], lexicalSearch: async () => [], rerank: async () => [] });
    await expect(retriever.retrieve({ query: "  ", limit: 2 })).rejects.toThrow("Retrieval query must not be blank");
    await expect(retriever.retrieve({ query: "valid", limit: 51 })).rejects.toThrow("Retrieval limit must be between 1 and 50");
  });
});
