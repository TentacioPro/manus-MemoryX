import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { enqueueDocumentIndex } from "./queue.js";

describe("local document-index queue", () => {
  it("enqueues a retryable index job and persists visible local job metadata", async () => {
    const attachmentId = new ObjectId("64b64c711111111111111111");
    const jobs: unknown[] = [];
    const db = { collection: (name: string) => {
      if (name !== "jobs") throw new Error(`Unexpected collection ${name}`);
      return { insertOne: async (document: unknown) => { jobs.push(document); } };
    } };
    const queue = { add: async (...args: unknown[]) => {
      expect(args).toEqual(["index-document", { attachmentId: attachmentId.toHexString() }, { attempts: 3, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 1000, removeOnFail: 1000 }]);
      return { id: "document-job-7" };
    } };

    await expect(enqueueDocumentIndex(db as never, attachmentId, queue as never)).resolves.toBe("document-job-7");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ queueJobId: "document-job-7", attachmentId, kind: "index-document", state: "queued", progress: 0, attemptsMade: 0 });
  });
});
