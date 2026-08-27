import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { addNotebookNote, createNotebook } from "./notebooks.js";

describe("local research notebooks", () => {
  it("creates a trimmed local notebook and records a bounded source-bound note", async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = { collection: (name: string) => ({ insertOne: async (value: Record<string, unknown>) => { inserted.push({ collection: name, ...value }); return { insertedId: new ObjectId("64b64c711111111111111111") }; } }) };
    const notebook = await createNotebook(db as never, { title: "  Retrieval evaluation  ", description: "Compare local source quality." }, () => new Date("2026-08-27T16:20:00.000Z"));
    await addNotebookNote(db as never, { notebookId: notebook._id, sourceAttachmentId: "attachment-a", text: "This span supports the retrieval answer." }, () => new Date("2026-08-27T16:21:00.000Z"));
    expect(notebook).toMatchObject({ title: "Retrieval evaluation", description: "Compare local source quality.", state: "active" });
    expect(inserted).toEqual([
      expect.objectContaining({ collection: "notebooks", title: "Retrieval evaluation", state: "active" }),
      expect.objectContaining({ collection: "notebookNotes", notebookId: notebook._id, sourceAttachmentId: "attachment-a", text: "This span supports the retrieval answer." }),
    ]);
  });

  it("rejects blank, oversized, and invalid notebook input before a database write", async () => {
    const db = { collection: () => ({ insertOne: async () => { throw new Error("must not write"); } }) };
    await expect(createNotebook(db as never, { title: "  " })).rejects.toThrow("Notebook title must be between 1 and 120 characters");
    await expect(addNotebookNote(db as never, { notebookId: "", text: "note" })).rejects.toThrow("Notebook id is required");
    await expect(addNotebookNote(db as never, { notebookId: "notebook", text: "x".repeat(5001) })).rejects.toThrow("Notebook note must be between 1 and 5000 characters");
  });
});
