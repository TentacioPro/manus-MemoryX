import { describe, expect, it } from "vitest";
import { createRetrievalIndexManager } from "./retrieval-index.js";

type Call = { url: string; init?: RequestInit };

function response(status: number, body: unknown = { result: true }) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("versioned Qdrant retrieval collection", () => {
  it("creates the named dense and sparse collection and assigns the stable active alias", async () => {
    const calls: Call[] = [];
    const manager = createRetrievalIndexManager({
      qdrantUrl: "http://qdrant:6333",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (!init?.method && String(url).endsWith("/collections/knowledge_vault_bge_m3_v1")) return response(404, { status: { error: "missing" } });
        return response(200);
      },
    });

    const result = await manager.ensureActiveCollection();

    expect(result).toEqual({ collectionName: "knowledge_vault_bge_m3_v1", alias: "knowledge_vault_active", created: true });
    expect(calls.map(call => call.url)).toEqual([
      "http://qdrant:6333/collections/knowledge_vault_bge_m3_v1",
      "http://qdrant:6333/collections/knowledge_vault_bge_m3_v1",
      "http://qdrant:6333/aliases",
    ]);
    expect(calls[1].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      vectors: { dense: { size: 1024, distance: "Cosine" } },
      sparse_vectors: { lexical: {} },
    });
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({
      actions: [{ create_alias: { collection_name: "knowledge_vault_bge_m3_v1", alias_name: "knowledge_vault_active" } }],
    });
  });

  it("keeps an existing versioned collection and still refreshes the active alias", async () => {
    const calls: Call[] = [];
    const manager = createRetrievalIndexManager({
      qdrantUrl: "http://qdrant:6333/",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return response(200);
      },
    });

    const result = await manager.ensureActiveCollection();

    expect(result.created).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("http://qdrant:6333/collections/knowledge_vault_bge_m3_v1");
    expect(calls[1].url).toBe("http://qdrant:6333/aliases");
  });

  it("fails closed when the configured local vector endpoint is not HTTP", () => {
    expect(() => createRetrievalIndexManager({ qdrantUrl: "file:///tmp/qdrant", fetch })).toThrow("QDRANT_URL must use http or https");
  });
});
