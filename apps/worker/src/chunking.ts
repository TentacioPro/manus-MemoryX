import { createHash } from "node:crypto";

export type StructuredTextBlock = {
  text: string;
  headingPath: string[];
  pageStart: number | null;
  pageEnd: number | null;
};

export type RetrievalChunk = {
  ordinal: number;
  text: string;
  headingPath: string[];
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number;
  overlapTokens: number;
  fingerprint: string;
};

export type ChunkStructuredTextInput = {
  sourceChecksum: string;
  blocks: StructuredTextBlock[];
  chunkingVersion?: string;
  targetTokens?: number;
  maxTokens?: number;
  overlapTokens?: number;
};

const normalized = (value: string) => value.replace(/\s+/g, " ").trim();
const tokenize = (value: string) => normalized(value).split(" ").filter(Boolean);

function fingerprint(input: { sourceChecksum: string; chunkingVersion: string; headingPath: string[]; pageStart: number | null; pageEnd: number | null; ordinal: number; text: string }) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function chunkStructuredText(input: ChunkStructuredTextInput): RetrievalChunk[] {
  const targetTokens = input.targetTokens ?? 650;
  const maxTokens = input.maxTokens ?? 850;
  const overlapTokens = input.overlapTokens ?? Math.min(48, Math.floor(targetTokens / 6));
  const chunkingVersion = input.chunkingVersion ?? "rag-chunk-v1";
  if (!Number.isInteger(targetTokens) || targetTokens < 1) throw new Error("targetTokens must be a positive integer");
  if (!Number.isInteger(maxTokens) || maxTokens < targetTokens) throw new Error("maxTokens must be at least targetTokens");
  if (!Number.isInteger(overlapTokens) || overlapTokens < 0 || overlapTokens >= targetTokens) throw new Error("overlapTokens must be smaller than targetTokens");

  const chunks: RetrievalChunk[] = [];
  for (const block of input.blocks) {
    const tokens = tokenize(block.text);
    if (!tokens.length) continue;
    let start = 0;
    while (start < tokens.length) {
      const end = Math.min(start + targetTokens, tokens.length);
      const text = tokens.slice(start, end).join(" ");
      const ordinal = chunks.length;
      const carriedOverlap = start === 0 ? 0 : Math.min(overlapTokens, start);
      chunks.push({
        ordinal,
        text,
        headingPath: block.headingPath.map(normalized).filter(Boolean),
        pageStart: block.pageStart,
        pageEnd: block.pageEnd,
        tokenCount: end - start,
        overlapTokens: carriedOverlap,
        fingerprint: fingerprint({
          sourceChecksum: input.sourceChecksum,
          chunkingVersion,
          headingPath: block.headingPath.map(normalized).filter(Boolean),
          pageStart: block.pageStart,
          pageEnd: block.pageEnd,
          ordinal,
          text,
        }),
      });
      if (end === tokens.length) break;
      start = end - overlapTokens;
    }
  }
  return chunks;
}
