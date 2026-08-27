export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function internalServiceUrl(value: string, expectedHost: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== expectedHost) {
    throw new Error(`${expectedHost} URL must resolve to an internal local HTTP service`);
  }
  return url.toString().replace(/\/$/, "");
}

async function readJson(response: Response, action: string): Promise<unknown> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${action} failed with ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`);
  }
  return response.json();
}

export function createLocalEmbeddingClient(input: { url: string; fetch: FetchLike; dimensions: number; maxBatchSize?: number }) {
  const baseUrl = internalServiceUrl(input.url, "embeddings");
  const maxBatchSize = input.maxBatchSize ?? 8;
  if (!Number.isInteger(input.dimensions) || input.dimensions < 1) throw new Error("Embedding dimensions must be a positive integer");

  return {
    async embed(inputs: string[]) {
      if (inputs.length > maxBatchSize) throw new Error(`Input exceeds local embedding batch limit of ${maxBatchSize}`);
      if (!inputs.length) return [];
      if (inputs.some(input => !input.trim())) throw new Error("Embedding input must not be blank");
      const payload = await readJson(await input.fetch(`${baseUrl}/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputs }),
      }), "Local embedding request");
      if (!Array.isArray(payload) || payload.length !== inputs.length) throw new Error("Local embedding response did not match input count");
      return payload.map((vector, index) => {
        if (!Array.isArray(vector) || vector.length !== input.dimensions || vector.some(value => typeof value !== "number" || !Number.isFinite(value))) {
          throw new Error(`Local embedding response contains unexpected vector dimension or values at index ${index}`);
        }
        return vector as number[];
      });
    },
  };
}

export function createLocalRerankerClient(input: { url: string; fetch: FetchLike }) {
  const baseUrl = internalServiceUrl(input.url, "reranker");
  return {
    async rerank(query: string, texts: string[]) {
      if (!query.trim()) throw new Error("Reranking query must not be blank");
      if (!texts.length) return [];
      const payload = await readJson(await input.fetch(`${baseUrl}/rerank`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, texts, raw_scores: false }),
      }), "Local reranking request");
      if (!Array.isArray(payload)) throw new Error("Local reranking response must be an array");
      return payload.map((item, index) => {
        if (!item || typeof item !== "object" || !Number.isInteger((item as { index?: unknown }).index) || typeof (item as { score?: unknown }).score !== "number") {
          throw new Error(`Local reranking response is invalid at index ${index}`);
        }
        const result = item as { index: number; score: number };
        if (result.index < 0 || result.index >= texts.length || !Number.isFinite(result.score)) throw new Error(`Local reranking response has an invalid candidate at index ${index}`);
        return result;
      });
    },
  };
}
