import type { RetrievalCandidate, RetrievalFilters } from "./retrieval.js";

type Cursor = { sort(value: unknown): Cursor; limit(value: number): Cursor; toArray(): Promise<Array<Record<string, unknown>>> };
type ChunkCollection = { find(filter: Record<string, unknown>, options: { projection: Record<string, unknown> }): Cursor };

function filterFor(filters?: RetrievalFilters) {
  const supported = new Set(["mimeType", "sourceAttachmentId", "notebookId"]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (!supported.has(key) || typeof value !== "string" || !value.trim()) throw new Error(`Unsupported lexical filter: ${key}`);
    result[key] = value;
  }
  return result;
}

export function createMongoLexicalSearch(collection: ChunkCollection) {
  return async (request: { query: string; filters?: RetrievalFilters }): Promise<RetrievalCandidate[]> => {
    const rows = await collection.find(
      { $text: { $search: request.query }, ...filterFor(request.filters) },
      { projection: { score: { $meta: "textScore" }, fingerprint: 1, sourceAttachmentId: 1, text: 1, headingPath: 1, pageStart: 1, pageEnd: 1 } },
    ).sort({ score: { $meta: "textScore" } }).limit(40).toArray();
    return rows.map(row => ({
      chunkId: String(row.fingerprint),
      sourceAttachmentId: String(row.sourceAttachmentId),
      text: String(row.text),
      headingPath: Array.isArray(row.headingPath) ? row.headingPath.filter((item): item is string => typeof item === "string") : [],
      pageStart: typeof row.pageStart === "number" ? row.pageStart : null,
      pageEnd: typeof row.pageEnd === "number" ? row.pageEnd : null,
      score: typeof row.score === "number" ? row.score : 0,
    }));
  };
}
