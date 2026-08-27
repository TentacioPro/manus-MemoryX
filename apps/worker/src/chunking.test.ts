import { describe, expect, it } from "vitest";
import { chunkStructuredText } from "./chunking.js";

describe("deterministic structure-aware chunking", () => {
  it("keeps sections together where possible and creates stable provenance-rich fingerprints", () => {
    const chunks = chunkStructuredText({
      sourceChecksum: "a".repeat(64),
      chunkingVersion: "rag-chunk-v1",
      blocks: [
        { text: "A short introduction for the archive.", headingPath: ["Introduction"], pageStart: 1, pageEnd: 1 },
        { text: "A second concise section about reliable retrieval.", headingPath: ["Retrieval"], pageStart: 2, pageEnd: 2 },
      ],
      targetTokens: 12,
      maxTokens: 18,
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ ordinal: 0, headingPath: ["Introduction"], pageStart: 1, pageEnd: 1, overlapTokens: 0 });
    expect(chunks[1]).toMatchObject({ ordinal: 1, headingPath: ["Retrieval"], pageStart: 2, pageEnd: 2, overlapTokens: 0 });
    expect(chunks.map(chunk => chunk.fingerprint)).toEqual([
      "6538c5373b8e1aa6b8d94b43042597b762da269443bd0d8b7f8e96d64d0fc342",
      "872f60ac051c99b0cdb83fa98d035d470205a73f528e49c03f71365056b484d1",
    ]);
  });

  it("splits oversized text only at the token budget and carries a bounded overlap", () => {
    const chunks = chunkStructuredText({
      sourceChecksum: "b".repeat(64),
      chunkingVersion: "rag-chunk-v1",
      blocks: [{ text: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen", headingPath: ["Long section"], pageStart: 3, pageEnd: 3 }],
      targetTokens: 5,
      maxTokens: 6,
      overlapTokens: 2,
    });

    expect(chunks.map(chunk => chunk.text)).toEqual([
      "one two three four five",
      "four five six seven eight",
      "seven eight nine ten eleven",
      "ten eleven twelve thirteen fourteen",
    ]);
    expect(chunks.map(chunk => chunk.overlapTokens)).toEqual([0, 2, 2, 2]);
    expect(chunks.every(chunk => chunk.tokenCount <= 5)).toBe(true);
  });

  it("returns no chunks for whitespace-only blocks", () => {
    expect(chunkStructuredText({ sourceChecksum: "c".repeat(64), blocks: [{ text: "   ", headingPath: [], pageStart: null, pageEnd: null }] })).toEqual([]);
  });
});
