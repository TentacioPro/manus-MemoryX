import { describe, expect, it } from "vitest";
import { createLocalRetrievalAdapters } from "./retrieval-adapters.js";

function response(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

describe("local retrieval adapters", () => {
  it("embeds a query, searches the active local Qdrant alias with filters, and reranks the candidate text locally", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const adapters = createLocalRetrievalAdapters({
      embeddingsUrl: "http://embeddings:80",
      qdrantUrl: "http://qdrant:6333",
      rerankerUrl: "http://reranker:80",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/embed")) return response(200, [[0.1, 0.2]]);
        if (String(url).endsWith("/points/query")) return response(200, { result: { points: [{ score: 0.91, payload: { chunkId: "chunk-a", sourceAttachmentId: "attachment-a", text: "Local semantic search result.", headingPath: ["Research"], pageStart: 4, pageEnd: 5 } }] } });
        return response(200, [{ index: 0, score: 0.97 }]);
      },
      dimensions: 2,
    });

    await expect(adapters.semanticSearch({ query: "local semantic retrieval", filters: { mimeType: "application/pdf", sourceAttachmentId: "attachment-a" } })).resolves.toEqual([
      { chunkId: "chunk-a", sourceAttachmentId: "attachment-a", text: "Local semantic search result.", headingPath: ["Research"], pageStart: 4, pageEnd: 5, score: 0.91 },
    ]);
    await expect(adapters.rerank({ query: "local semantic retrieval", texts: ["Local semantic search result."] })).resolves.toEqual([{ index: 0, score: 0.97 }]);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      query: [0.1, 0.2], using: "dense", limit: 40, with_payload: true,
      filter: { must: [{ key: "mimeType", match: { value: "application/pdf" } }, { key: "sourceAttachmentId", match: { value: "attachment-a" } }] },
    });
  });

  it("fails closed for external services, malformed vectors, and unsupported filters", async () => {
    expect(() => createLocalRetrievalAdapters({ embeddingsUrl: "https://example.com", qdrantUrl: "http://qdrant:6333", rerankerUrl: "http://reranker:80", fetch, dimensions: 2 })).toThrow("must resolve to an internal local HTTP service");
    const adapters = createLocalRetrievalAdapters({ embeddingsUrl: "http://embeddings:80", qdrantUrl: "http://qdrant:6333", rerankerUrl: "http://reranker:80", fetch: async () => response(200, [[0.1]]), dimensions: 2 });
    await expect(adapters.semanticSearch({ query: "question" })).rejects.toThrow("unexpected vector dimension");
    await expect(adapters.semanticSearch({ query: "question", filters: { platform: "youtube" } })).rejects.toThrow("Unsupported semantic filter");
  });
});
