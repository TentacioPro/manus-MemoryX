import { describe, expect, it } from "vitest";
import { createQdrantChunkWriter } from "./qdrant-vectors.js";

function response(status: number, payload: unknown = { result: { status: "completed" } }) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

describe("Qdrant local chunk writer", () => {
  it("creates the versioned dense collection and sets the active alias when it does not exist", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const writer = createQdrantChunkWriter({
      url: "http://qdrant:6333",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (!init?.method) return response(404, { status: { error: "missing" } });
        return response(200);
      },
    });

    await expect(writer.ensureActiveCollection()).resolves.toEqual({ collectionName: "knowledge_vault_bge_m3_v1", alias: "knowledge_vault_active", created: true });
    expect(calls.map(call => call.url)).toEqual([
      "http://qdrant:6333/collections/knowledge_vault_bge_m3_v1",
      "http://qdrant:6333/collections/knowledge_vault_bge_m3_v1",
      "http://qdrant:6333/aliases",
    ]);
  });

  it("upserts dense vectors through the stable active alias with citation-ready payload metadata", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const writer = createQdrantChunkWriter({
      url: "http://qdrant:6333",
      fetch: async (url, init) => { calls.push({ url: String(url), init }); return response(200); },
    });

    await writer.upsert({
      chunks: [{ id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", sourceAttachmentId: "64b64c711111111111111111", mimeType: "application/pdf", text: "A reliable chunk.", headingPath: ["Finding"], pageStart: 2, pageEnd: 3 }],
      vectors: [[0.1, 0.2]],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://qdrant:6333/collections/knowledge_vault_active/points?wait=true");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      points: [{
        id: "01234567-89ab-cdef-0123-456789abcdef",
        vector: { dense: [0.1, 0.2] },
        payload: { chunkId: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", sourceAttachmentId: "64b64c711111111111111111", mimeType: "application/pdf", text: "A reliable chunk.", headingPath: ["Finding"], pageStart: 2, pageEnd: 3 },
      }],
    });
  });

  it("rejects mismatched, invalid, or non-internal vector inputs", async () => {
    expect(() => createQdrantChunkWriter({ url: "https://qdrant.example.com", fetch })).toThrow("must resolve to the internal local HTTP service");
    const writer = createQdrantChunkWriter({ url: "http://qdrant:6333", fetch: async () => response(200) });
    await expect(writer.upsert({ chunks: [], vectors: [[0.1]] })).rejects.toThrow("does not match chunk count");
    await expect(writer.upsert({ chunks: [{ id: "not-a-fingerprint", sourceAttachmentId: "a", text: "x", headingPath: [], pageStart: null, pageEnd: null }], vectors: [[Number.NaN]] })).rejects.toThrow("must be a SHA-256 fingerprint");
  });
});
