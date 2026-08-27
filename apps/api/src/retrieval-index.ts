export const RETRIEVAL_INDEX = {
  alias: "knowledge_vault_active",
  collectionName: "knowledge_vault_bge_m3_v1",
  denseDimensions: 1024,
  sparseVectorName: "lexical",
  denseVectorName: "dense",
} as const;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type RetrievalIndexManager = {
  ensureActiveCollection(): Promise<{ collectionName: string; alias: string; created: boolean }>;
};

function normaliseQdrantUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("QDRANT_URL must use http or https");
  return url.toString().replace(/\/$/, "");
}

async function assertSuccess(response: Response, action: string) {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  throw new Error(`${action} failed with ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`);
}

export function createRetrievalIndexManager(input: { qdrantUrl: string; fetch: FetchLike }): RetrievalIndexManager {
  const baseUrl = normaliseQdrantUrl(input.qdrantUrl);
  const collectionUrl = `${baseUrl}/collections/${RETRIEVAL_INDEX.collectionName}`;

  return {
    async ensureActiveCollection() {
      const existing = await input.fetch(collectionUrl);
      let created = false;
      if (existing.status === 404) {
        const createdResponse = await input.fetch(collectionUrl, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            vectors: { [RETRIEVAL_INDEX.denseVectorName]: { size: RETRIEVAL_INDEX.denseDimensions, distance: "Cosine" } },
            sparse_vectors: { [RETRIEVAL_INDEX.sparseVectorName]: {} },
          }),
        });
        await assertSuccess(createdResponse, `Create retrieval collection ${RETRIEVAL_INDEX.collectionName}`);
        created = true;
      } else {
        await assertSuccess(existing, `Read retrieval collection ${RETRIEVAL_INDEX.collectionName}`);
      }

      const aliasResponse = await input.fetch(`${baseUrl}/aliases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actions: [{ create_alias: { collection_name: RETRIEVAL_INDEX.collectionName, alias_name: RETRIEVAL_INDEX.alias } }],
        }),
      });
      await assertSuccess(aliasResponse, `Set retrieval alias ${RETRIEVAL_INDEX.alias}`);
      return { collectionName: RETRIEVAL_INDEX.collectionName, alias: RETRIEVAL_INDEX.alias, created };
    },
  };
}
