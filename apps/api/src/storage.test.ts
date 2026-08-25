import { ObjectId } from "mongodb";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteOrphanAttachment, getAttachmentDownloadUrl, minio, saveAttachment } from "./storage.js";

function makeDb(referencedEntries: number, sameObjectCount: number) {
  const attachment = { _id: new ObjectId("0000000000000000000000aa"), objectKey: "attachments/checksum/guide.pdf", state: "active", entryIds: [] as ObjectId[] };
  const calls: string[] = [];
  return {
    attachment, calls,
    db: {
      collection(name: string) {
        if (name === "attachments") return {
          findOne: async () => attachment,
          updateOne: async () => { calls.push("mark-orphaned"); return { modifiedCount: 1 }; },
          countDocuments: async () => sameObjectCount,
          deleteOne: async () => { calls.push("delete-metadata"); return { deletedCount: 1 }; },
        };
        if (name === "entries") return { countDocuments: async () => referencedEntries };
        if (name === "taskLedger") return { insertOne: async () => { calls.push("ledger"); return { insertedId: new ObjectId() }; } };
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as any,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("orphan attachment deletion", () => {
  it("keeps the object and metadata when an archive entry still references it", async () => {
    const context = makeDb(1, 0);
    const remove = vi.spyOn(minio, "removeObject").mockResolvedValue();
    const result = await deleteOrphanAttachment(context.db, context.attachment._id);
    expect(result.deleted).toBe(false);
    expect(result.reason).toContain("still referenced");
    expect(remove).not.toHaveBeenCalled();
    expect(context.calls).toEqual([]);
  });

  it("deletes the object only after its metadata has no active entry or object references", async () => {
    const context = makeDb(0, 0);
    const remove = vi.spyOn(minio, "removeObject").mockResolvedValue();
    const result = await deleteOrphanAttachment(context.db, context.attachment._id);
    expect(result).toEqual({ deleted: true });
    expect(remove).toHaveBeenCalledWith("knowledge-vault", context.attachment.objectKey);
    expect(context.calls).toEqual(["mark-orphaned", "delete-metadata", "ledger"]);
  });

  it("removes only metadata when another active attachment shares the same stored object", async () => {
    const context = makeDb(0, 1);
    const remove = vi.spyOn(minio, "removeObject").mockResolvedValue();
    const result = await deleteOrphanAttachment(context.db, context.attachment._id);
    expect(result.deleted).toBe(true);
    expect(remove).not.toHaveBeenCalled();
    expect(context.calls).toEqual(["mark-orphaned", "delete-metadata", "ledger"]);
  });
});

describe("attachment upload and download lookup", () => {
  function storageDb(existing?: any) {
    const stored: any[] = existing ? [existing] : [];
    return {
      stored,
      db: { collection(name: string) {
        if (name === "attachments") return {
          findOne: async (filter: any) => filter._id ? stored.find(item => item._id.equals(filter._id)) ?? null : stored.find(item => item.checksumSha256 === filter.checksumSha256 && item.state === filter.state) ?? null,
          insertOne: async (document: any) => { const row = { ...document, _id: new ObjectId() }; stored.push(row); return { insertedId: row._id }; },
          updateOne: async () => ({ modifiedCount: 1 }),
        };
        throw new Error(`Unexpected collection: ${name}`);
      } } as any,
    };
  }

  function mockObjectStore() {
    vi.spyOn(minio, "bucketExists").mockResolvedValue(true);
    vi.spyOn(minio, "putObject").mockImplementation(async (_bucket: any, _key: any, stream: any) => { for await (const _chunk of stream as AsyncIterable<Buffer>) { /* consume stream */ } return "etag" as any; });
    vi.spyOn(minio, "copyObject").mockResolvedValue("etag" as any);
    vi.spyOn(minio, "removeObject").mockResolvedValue();
  }

  it("streams an uploaded file, persists a SHA-256 record, and stores the final MinIO key", async () => {
    mockObjectStore(); const context = storageDb();
    const result = await saveAttachment(context.db, { stream: Readable.from([Buffer.from("hello")]), filename: "hello.txt", mimeType: "text/plain" });
    expect(result.deduplicated).toBe(false);
    expect(result.attachment.checksumSha256).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(result.attachment.objectKey).toMatch(/^attachments\/2cf24d/);
    expect(minio.copyObject).toHaveBeenCalled();
    expect(minio.removeObject).toHaveBeenCalledTimes(1);
  });

  it("reuses existing metadata and removes the temporary object for a checksum duplicate", async () => {
    mockObjectStore(); const existing = { _id: new ObjectId(), checksumSha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", objectKey: "attachments/existing", state: "active", entryIds: [] }; const context = storageDb(existing);
    const result = await saveAttachment(context.db, { stream: Readable.from([Buffer.from("hello")]), filename: "duplicate.txt", mimeType: "text/plain" });
    expect(result.deduplicated).toBe(true);
    expect(result.attachment._id).toEqual(existing._id);
    expect(minio.copyObject).not.toHaveBeenCalled();
    expect(minio.removeObject).toHaveBeenCalledTimes(1);
  });

  it("returns a browser-supported presigned download URL for an active attachment", async () => {
    const attachment = { _id: new ObjectId(), objectKey: "attachments/guide.pdf", state: "active" }; const context = storageDb(attachment);
    vi.spyOn(minio, "presignedGetObject").mockResolvedValue("http://minio.local/signed-guide" as any);
    await expect(getAttachmentDownloadUrl(context.db, attachment._id)).resolves.toMatchObject({ attachment, url: "http://minio.local/signed-guide" });
  });
});
