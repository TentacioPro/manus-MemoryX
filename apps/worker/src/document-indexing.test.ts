import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { indexLocalAttachment } from "./document-indexing.js";

describe("local document indexing", () => {
  it("converts a local attachment, persists source-bound chunks, and upserts the corresponding local vectors", async () => {
    const attachmentId = new ObjectId("64b64c711111111111111111");
    const documentUpdates: unknown[] = [];
    const chunkWrites: unknown[] = [];
    const vectorWrites: unknown[] = [];
    const database = {
      collection(name: string) {
        if (name === "documents") return { updateOne: async (...args: unknown[]) => { documentUpdates.push(args); } };
        if (name === "documentChunks") return { bulkWrite: async (writes: unknown[]) => { chunkWrites.push(...writes); } };
        throw new Error(`Unexpected collection ${name}`);
      },
    };

    const result = await indexLocalAttachment(database as never, {
      attachment: { _id: attachmentId, objectKey: "attachments/a/report.pdf", filename: "report.pdf", mimeType: "application/pdf", checksumSha256: "a".repeat(64), sizeBytes: 1024 },
      sourceUrl: "http://minio:9000/knowledge-vault/attachments/a/report.pdf?signature=local",
      converter: { convertInternalObject: async () => ({ markdown: "# Introduction\n\nLocal retrieval keeps evidence nearby.\n\n# Findings\n\nHybrid search combines lexical and semantic ranking.", structure: { body: {} }, processingSeconds: 0.4, warnings: [] }) },
      embedder: { embed: async (texts: string[]) => texts.map((_text, index) => [index + 0.1, index + 0.2]) },
      upsertVectors: async input => { vectorWrites.push(input); },
      embeddingModel: "BAAI/bge-m3",
      embeddingDimensions: 2,
      chunkingVersion: "rag-chunk-v1",
      now: () => new Date("2026-08-27T16:00:00.000Z"),
    });

    expect(result).toMatchObject({ attachmentId: attachmentId.toHexString(), status: "indexed", chunkCount: 2, embeddingModel: "BAAI/bge-m3" });
    expect(documentUpdates).toHaveLength(1);
    expect((documentUpdates[0] as Array<{ $set?: { extraction?: { markdown?: string; structure?: unknown } } }>)[1].$set?.extraction).toEqual({
      markdown: "# Introduction\n\nLocal retrieval keeps evidence nearby.\n\n# Findings\n\nHybrid search combines lexical and semantic ranking.",
      structure: { body: {} },
    });
    expect(chunkWrites).toHaveLength(2);
    expect(vectorWrites).toHaveLength(1);
    expect((vectorWrites[0] as { chunks: Array<{ sourceAttachmentId: string; text: string }>; vectors: number[][] }).chunks).toEqual([
      expect.objectContaining({ sourceAttachmentId: attachmentId.toHexString(), text: "Local retrieval keeps evidence nearby." }),
      expect.objectContaining({ sourceAttachmentId: attachmentId.toHexString(), text: "Hybrid search combines lexical and semantic ranking." }),
    ]);
  });

  it("does not write partial chunk metadata if local embedding output is invalid", async () => {
    const attachmentId = new ObjectId("64b64c722222222222222222");
    let wroteChunks = false;
    const database = { collection: () => ({ updateOne: async () => undefined, bulkWrite: async () => { wroteChunks = true; } }) };

    await expect(indexLocalAttachment(database as never, {
      attachment: { _id: attachmentId, objectKey: "attachments/a/broken.pdf", filename: "broken.pdf", mimeType: "application/pdf", checksumSha256: "b".repeat(64), sizeBytes: 512 },
      sourceUrl: "http://minio:9000/knowledge-vault/attachments/a/broken.pdf?signature=local",
      converter: { convertInternalObject: async () => ({ markdown: "# A\n\nOne section.", structure: null, processingSeconds: 0.1, warnings: [] }) },
      embedder: { embed: async () => [[0.1]] },
      upsertVectors: async () => undefined,
      embeddingModel: "BAAI/bge-m3",
      embeddingDimensions: 2,
    })).rejects.toThrow("unexpected vector dimension");
    expect(wroteChunks).toBe(false);
  });
});
