import type { ObjectId } from "mongodb";
import { chunkStructuredText, type StructuredTextBlock } from "./chunking.js";

type Attachment = { _id: ObjectId; objectKey: string; filename: string; mimeType: string; checksumSha256: string; sizeBytes: number };
type Conversion = { markdown: string; structure: unknown; processingSeconds: number; warnings: string[] };

function markdownBlocks(markdown: string): StructuredTextBlock[] {
  const blocks: StructuredTextBlock[] = [];
  const headingPath: string[] = [];
  let lines: string[] = [];
  const flush = () => {
    const text = lines.join("\n").replace(/\s+/g, " ").trim();
    if (text) blocks.push({ text, headingPath: [...headingPath], pageStart: null, pageEnd: null });
    lines = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      headingPath.length = level - 1;
      headingPath[level - 1] = heading[2].trim();
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    lines.push(line);
  }
  flush();
  return blocks;
}

export async function indexLocalAttachment(
  db: { collection(name: "documents" | "documentChunks"): { updateOne?: (...args: unknown[]) => Promise<unknown>; bulkWrite?: (writes: unknown[]) => Promise<unknown> } },
  input: {
    attachment: Attachment;
    sourceUrl: string;
    converter: { convertInternalObject(sourceUrl: string): Promise<Conversion> };
    embedder: { embed(texts: string[]): Promise<number[][]> };
  upsertVectors: (input: { chunks: Array<{ id: string; sourceAttachmentId: string; mimeType: string; text: string; headingPath: string[]; pageStart: number | null; pageEnd: number | null }>; vectors: number[][] }) => Promise<void>;
    embeddingModel: string;
    embeddingDimensions: number;
    chunkingVersion?: string;
    now?: () => Date;
  },
) {
  const converted = await input.converter.convertInternalObject(input.sourceUrl);
  const chunkingVersion = input.chunkingVersion ?? "rag-chunk-v1";
  const chunks = chunkStructuredText({ sourceChecksum: input.attachment.checksumSha256, chunkingVersion, blocks: markdownBlocks(converted.markdown) });
  if (!chunks.length) throw new Error("Local document conversion produced no indexable text");
  const vectors = await input.embedder.embed(chunks.map(chunk => chunk.text));
  if (vectors.length !== chunks.length || vectors.some(vector => vector.length !== input.embeddingDimensions || vector.some(value => !Number.isFinite(value)))) {
    throw new Error("Local embedding response contains unexpected vector dimension or values");
  }
  const sourceAttachmentId = input.attachment._id.toHexString();
  const vectorChunks = chunks.map(chunk => ({ id: chunk.fingerprint, sourceAttachmentId, mimeType: input.attachment.mimeType, text: chunk.text, headingPath: chunk.headingPath, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd }));
  await input.upsertVectors({ chunks: vectorChunks, vectors });

  const indexedAt = (input.now ?? (() => new Date()))();
  const document = {
    sourceAttachmentId,
    sourceObjectKey: input.attachment.objectKey,
    sourceChecksumSha256: input.attachment.checksumSha256,
    filename: input.attachment.filename,
    mimeType: input.attachment.mimeType,
    sizeBytes: input.attachment.sizeBytes,
    extractor: "docling-serve",
    extractorVersion: "v1",
    chunkingVersion,
    embeddingModel: input.embeddingModel,
    embeddingDimensions: input.embeddingDimensions,
    extraction: {
      markdown: converted.markdown,
      structure: converted.structure,
    },
    conversionProcessingSeconds: converted.processingSeconds,
    warnings: converted.warnings,
    chunkCount: chunks.length,
    state: "indexed",
    indexedAt,
    updatedAt: indexedAt,
  };
  await db.collection("documents").updateOne?.({ sourceAttachmentId }, { $set: document }, { upsert: true });
  await db.collection("documentChunks").bulkWrite?.(chunks.map((chunk, index) => ({
    replaceOne: {
      filter: { fingerprint: chunk.fingerprint },
      replacement: {
        ...chunk,
        sourceAttachmentId,
        sourceObjectKey: input.attachment.objectKey,
        sourceChecksumSha256: input.attachment.checksumSha256,
        filename: input.attachment.filename,
        mimeType: input.attachment.mimeType,
        embeddingModel: input.embeddingModel,
        embeddingDimensions: input.embeddingDimensions,
        chunkingVersion,
        vectorId: chunk.fingerprint,
        updatedAt: indexedAt,
        createdAt: indexedAt,
        vectorOrdinal: index,
      },
      upsert: true,
    },
  })));
  return { attachmentId: sourceAttachmentId, status: "indexed" as const, chunkCount: chunks.length, embeddingModel: input.embeddingModel };
}
