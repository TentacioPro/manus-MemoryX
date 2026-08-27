import { describe, expect, it } from "vitest";
import { createLocalEmbeddingClient, createLocalRerankerClient } from "./local-models.js";

function response(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

describe("local embedding and reranking clients", () => {
  it("sends bounded batches to the internal embedding endpoint and verifies BGE-M3 vectors", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createLocalEmbeddingClient({
      url: "http://embeddings:80/",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return response(200, [[0.2, 0.3], [0.4, 0.5]]);
      },
      dimensions: 2,
      maxBatchSize: 2,
    });

    await expect(client.embed(["first chunk", "second chunk"])).resolves.toEqual([[0.2, 0.3], [0.4, 0.5]]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://embeddings/embed");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ inputs: ["first chunk", "second chunk"] });
  });

  it("fails closed on model response dimension mismatches or oversized batches", async () => {
    const client = createLocalEmbeddingClient({ url: "http://embeddings:80", fetch: async () => response(200, [[0.2]]), dimensions: 2, maxBatchSize: 1 });
    await expect(client.embed(["chunk"])).rejects.toThrow("unexpected vector dimension");
    await expect(client.embed(["one", "two"])).rejects.toThrow("exceeds local embedding batch limit");
  });

  it("returns locally reranked candidate indices and normalized scores", async () => {
    const reranker = createLocalRerankerClient({
      url: "http://reranker:80",
      fetch: async (_url, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ query: "reliable RAG", texts: ["first", "second"], raw_scores: false });
        return response(200, [{ index: 1, score: 0.98 }, { index: 0, score: 0.24 }]);
      },
    });

    await expect(reranker.rerank("reliable RAG", ["first", "second"])).resolves.toEqual([{ index: 1, score: 0.98 }, { index: 0, score: 0.24 }]);
  });

  it("rejects non-local model endpoints", () => {
    expect(() => createLocalEmbeddingClient({ url: "https://example.com", fetch, dimensions: 2 })).toThrow("must resolve to an internal local HTTP service");
    expect(() => createLocalRerankerClient({ url: "http://localhost:8080", fetch })).toThrow("must resolve to an internal local HTTP service");
  });
});
