import type { ObjectId } from "mongodb";

type Attachment = { _id: ObjectId; objectKey: string; filename: string; mimeType: string; checksumSha256: string; sizeBytes: number };
type IndexResult = { attachmentId: string; status: "indexed"; chunkCount: number; embeddingModel: string };

export function createDocumentIndexProcessor(input: {
  findAttachment: (attachmentId: ObjectId) => Promise<Attachment | null>;
  createInternalSourceUrl: (objectKey: string) => Promise<string>;
  setDocumentState: (state: { attachmentId: ObjectId; state: "processing" | "indexed" | "failed"; chunkCount?: number; embeddingModel?: string; failure?: string }) => Promise<unknown>;
  ensureActiveCollection: () => Promise<unknown>;
  indexAttachment: (input: { attachment: Attachment; sourceUrl: string }) => Promise<IndexResult>;
}) {
  return {
    async process(attachmentId: ObjectId) {
      const attachment = await input.findAttachment(attachmentId);
      if (!attachment) throw new Error("Attachment was not found or is not active");
      await input.setDocumentState({ attachmentId, state: "processing" });
      try {
        const sourceUrl = await input.createInternalSourceUrl(attachment.objectKey);
        await input.ensureActiveCollection();
        const result = await input.indexAttachment({ attachment, sourceUrl });
        await input.setDocumentState({ attachmentId, state: "indexed", chunkCount: result.chunkCount, embeddingModel: result.embeddingModel });
        return result;
      } catch (error) {
        const failure = error instanceof Error ? error.message.slice(0, 2000) : "Unknown local document-index failure";
        await input.setDocumentState({ attachmentId, state: "failed", failure });
        throw error;
      }
    },
  };
}
