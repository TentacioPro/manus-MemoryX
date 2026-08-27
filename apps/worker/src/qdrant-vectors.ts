export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type VectorChunk = { id: string; sourceAttachmentId: string; mimeType?: string; text: string; headingPath: string[]; pageStart: number | null; pageEnd: number | null };

const collectionName = "knowledge_vault_bge_m3_v1";
const alias = "knowledge_vault_active";

function internalQdrantUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "qdrant") throw new Error("Qdrant URL must resolve to the internal local HTTP service");
  return url.toString().replace(/\/$/, "");
}

function toUuid(fingerprint: string) {
  if (!/^[a-f0-9]{64}$/i.test(fingerprint)) throw new Error("Vector chunk id must be a SHA-256 fingerprint");
  const prefix = fingerprint.slice(0, 32).toLowerCase();
  return `${prefix.slice(0, 8)}-${prefix.slice(8, 12)}-${prefix.slice(12, 16)}-${prefix.slice(16, 20)}-${prefix.slice(20, 32)}`;
}

export function createQdrantChunkWriter(input: { url: string; fetch: FetchLike }) {
  const baseUrl = internalQdrantUrl(input.url);
  return {
    async ensureActiveCollection() {
      const collectionUrl = `${baseUrl}/collections/${collectionName}`;
      const existing = await input.fetch(collectionUrl);
      let created = false;
      if (existing.status === 404) {
        const createdResponse = await input.fetch(collectionUrl, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vectors: { dense: { size: 1024, distance: "Cosine" } }, sparse_vectors: { lexical: {} } }),
        });
        if (!createdResponse.ok) throw new Error(`Local Qdrant collection creation failed with ${createdResponse.status}`);
        created = true;
      } else if (!existing.ok) {
        throw new Error(`Local Qdrant collection lookup failed with ${existing.status}`);
      }
      const aliasResponse = await input.fetch(`${baseUrl}/aliases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actions: [{ create_alias: { collection_name: collectionName, alias_name: alias } }] }),
      });
      if (!aliasResponse.ok) throw new Error(`Local Qdrant alias update failed with ${aliasResponse.status}`);
      return { collectionName, alias, created };
    },
    async upsert(value: { chunks: VectorChunk[]; vectors: number[][] }) {
      if (value.chunks.length !== value.vectors.length) throw new Error("Vector count does not match chunk count");
      const points = value.chunks.map((chunk, index) => {
        const id = toUuid(chunk.id);
        const vector = value.vectors[index];
        if (!vector.length || vector.some(item => !Number.isFinite(item))) throw new Error(`Vector values are invalid for chunk ${index}`);
        return {
          id,
          vector: { dense: vector },
          payload: {
            chunkId: chunk.id,
            sourceAttachmentId: chunk.sourceAttachmentId,
            ...(chunk.mimeType ? { mimeType: chunk.mimeType } : {}),
            text: chunk.text,
            headingPath: chunk.headingPath,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
          },
        };
      });
      if (!points.length) return;
      const response = await input.fetch(`${baseUrl}/collections/${alias}/points?wait=true`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ points }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Local Qdrant vector upsert failed with ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`);
      }
    },
  };
}
