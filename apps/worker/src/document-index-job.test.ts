import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createDocumentIndexProcessor } from "./document-index-job.js";

describe("document-index job processor", () => {
  it("marks local processing, ensures the active collection, and indexes a known attachment", async () => {
    const attachmentId = new ObjectId("64b64c711111111111111111");
    const states: unknown[] = [];
    const calls: string[] = [];
    const processor = createDocumentIndexProcessor({
      findAttachment: async id => ({ _id: id, objectKey: "attachments/abc/report.pdf", filename: "report.pdf", mimeType: "application/pdf", checksumSha256: "a".repeat(64), sizeBytes: 12 }),
      createInternalSourceUrl: async objectKey => { calls.push(`source:${objectKey}`); return "http://minio:9000/knowledge-vault/attachments/abc/report.pdf?signature=local"; },
      setDocumentState: async state => { states.push(state); },
      ensureActiveCollection: async () => { calls.push("collection"); },
      indexAttachment: async input => { calls.push(`index:${input.attachment.filename}`); return { attachmentId: input.attachment._id.toHexString(), status: "indexed" as const, chunkCount: 3, embeddingModel: "BAAI/bge-m3" }; },
    });

    await expect(processor.process(attachmentId)).resolves.toMatchObject({ status: "indexed", chunkCount: 3 });
    expect(states).toEqual([{ attachmentId, state: "processing" }, { attachmentId, state: "indexed", chunkCount: 3, embeddingModel: "BAAI/bge-m3" }]);
    expect(calls).toEqual(["source:attachments/abc/report.pdf", "collection", "index:report.pdf"]);
  });

  it("fails before an index mutation when the referenced local attachment does not exist", async () => {
    const processor = createDocumentIndexProcessor({
      findAttachment: async () => null,
      createInternalSourceUrl: async () => "",
      setDocumentState: async () => undefined,
      ensureActiveCollection: async () => undefined,
      indexAttachment: async () => { throw new Error("must not index"); },
    });
    await expect(processor.process(new ObjectId())).rejects.toThrow("Attachment was not found or is not active");
  });
});
