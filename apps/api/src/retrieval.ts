export type RetrievalFilters = Record<string, unknown>;
export type RetrievalCandidate = {
  chunkId: string;
  sourceAttachmentId: string;
  text: string;
  headingPath: string[];
  pageStart: number | null;
  pageEnd: number | null;
  score: number;
};

export type FusedCandidate = Omit<RetrievalCandidate, "score"> & { retrievalScore: number };

export function reciprocalRankFuse(rankings: RetrievalCandidate[][], constant = 60): FusedCandidate[] {
  const byChunkId = new Map<string, FusedCandidate>();
  rankings.forEach(ranking => ranking.forEach((candidate, index) => {
    const contribution = 1 / (constant + index + 1);
    const current = byChunkId.get(candidate.chunkId);
    if (current) current.retrievalScore += contribution;
    else byChunkId.set(candidate.chunkId, { ...candidate, retrievalScore: contribution });
  }));
  return [...byChunkId.values()].sort((a, b) => b.retrievalScore - a.retrievalScore || a.chunkId.localeCompare(b.chunkId));
}

export function createHybridRetriever(input: {
  semanticSearch: (input: { query: string; filters?: RetrievalFilters }) => Promise<RetrievalCandidate[]>;
  lexicalSearch: (input: { query: string; filters?: RetrievalFilters }) => Promise<RetrievalCandidate[]>;
  rerank: (input: { query: string; texts: string[] }) => Promise<Array<{ index: number; score: number }>>;
}) {
  return {
    async retrieve(request: { query: string; filters?: RetrievalFilters; limit?: number }) {
      const query = request.query.trim();
      const limit = request.limit ?? 10;
      if (!query) throw new Error("Retrieval query must not be blank");
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Retrieval limit must be between 1 and 50");
      const [semantic, lexical] = await Promise.all([
        input.semanticSearch({ query, filters: request.filters }),
        input.lexicalSearch({ query, filters: request.filters }),
      ]);
      const fused = reciprocalRankFuse([semantic, lexical]);
      if (!fused.length) return [];
      const shortlist = fused.slice(0, Math.min(40, fused.length));
      const reranked = await input.rerank({ query, texts: shortlist.map(item => item.text) });
      const rerankByIndex = new Map(reranked.map(item => [item.index, item.score]));
      return shortlist
        .map((item, index) => ({
          ...item,
          rerankScore: rerankByIndex.get(index) ?? Number.NEGATIVE_INFINITY,
          citation: { sourceAttachmentId: item.sourceAttachmentId, headingPath: item.headingPath, pageStart: item.pageStart, pageEnd: item.pageEnd },
        }))
        .sort((a, b) => b.rerankScore - a.rerankScore || b.retrievalScore - a.retrievalScore)
        .slice(0, limit);
    },
  };
}
