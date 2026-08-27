import type { RetrievalCandidate, RetrievalFilters } from "./retrieval.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function internalUrl(value: string, host: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== host) throw new Error(`${host} URL must resolve to an internal local HTTP service`);
  return url.toString().replace(/\/$/, "");
}

async function body(response: Response, action: string): Promise<unknown> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${action} failed with ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`);
  }
  return response.json();
}

function qdrantFilter(filters?: RetrievalFilters) {
  if (!filters) return undefined;
  const supported = new Set(["mimeType", "sourceAttachmentId", "notebookId"]);
  const clauses = Object.entries(filters).map(([key, value]) => {
    if (!supported.has(key) || typeof value !== "string" || !value.trim()) throw new Error(`Unsupported semantic filter: ${key}`);
    return { key, match: { value } };
  });
  return clauses.length ? { must: clauses } : undefined;
}

function candidate(value: unknown): RetrievalCandidate {
  const result = value as { score?: unknown; payload?: Record<string, unknown> };
  const payload = result.payload ?? {};
  if (typeof result.score !== "number" || !Number.isFinite(result.score) || typeof payload.chunkId !== "string" || typeof payload.sourceAttachmentId !== "string" || typeof payload.text !== "string" || !Array.isArray(payload.headingPath)) {
    throw new Error("Local Qdrant response contained malformed retrieval payload");
  }
  return {
    chunkId: payload.chunkId,
    sourceAttachmentId: payload.sourceAttachmentId,
    text: payload.text,
    headingPath: payload.headingPath.filter((item): item is string => typeof item === "string"),
    pageStart: typeof payload.pageStart === "number" ? payload.pageStart : null,
    pageEnd: typeof payload.pageEnd === "number" ? payload.pageEnd : null,
    score: result.score,
  };
}

export function createLocalRetrievalAdapters(input: { embeddingsUrl: string; qdrantUrl: string; rerankerUrl: string; fetch: FetchLike; dimensions: number }) {
  const embeddingsUrl = internalUrl(input.embeddingsUrl, "embeddings");
  const qdrantUrl = internalUrl(input.qdrantUrl, "qdrant");
  const rerankerUrl = internalUrl(input.rerankerUrl, "reranker");
  if (!Number.isInteger(input.dimensions) || input.dimensions < 1) throw new Error("Embedding dimensions must be a positive integer");

  async function embed(query: string) {
    const payload = await body(await input.fetch(`${embeddingsUrl}/embed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: query }) }), "Local embedding request");
    const vector = Array.isArray(payload) ? payload[0] : null;
    if (!Array.isArray(vector) || vector.length !== input.dimensions || vector.some(item => typeof item !== "number" || !Number.isFinite(item))) throw new Error("Local embedding response contains unexpected vector dimension or values");
    return vector as number[];
  }

  return {
    async semanticSearch(request: { query: string; filters?: RetrievalFilters }) {
      const filter = qdrantFilter(request.filters);
      const query = await embed(request.query);
      const payload = await body(await input.fetch(`${qdrantUrl}/collections/knowledge_vault_active/points/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, using: "dense", limit: 40, with_payload: true, ...(filter ? { filter } : {}) }),
      }), "Local Qdrant semantic search") as { result?: { points?: unknown[] } };
      return (payload.result?.points ?? []).map(candidate);
    },
    async rerank(request: { query: string; texts: string[] }) {
      const payload = await body(await input.fetch(`${rerankerUrl}/rerank`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: request.query, texts: request.texts, raw_scores: false }) }), "Local reranking request");
      if (!Array.isArray(payload)) throw new Error("Local reranking response must be an array");
      return payload.map((item, index) => {
        const result = item as { index?: unknown; score?: unknown };
        if (!Number.isInteger(result.index) || typeof result.score !== "number" || !Number.isFinite(result.score)) throw new Error(`Local reranking response is invalid at index ${index}`);
        return { index: result.index as number, score: result.score };
      });
    },
  };
}
