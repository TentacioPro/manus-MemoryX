import { ObjectId } from "mongodb";

type DbLike = { collection(name: "notebooks" | "notebookNotes"): { insertOne(value: Record<string, unknown>): Promise<{ insertedId: ObjectId }> } };

function valueBetween(value: unknown, name: string, maximum: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maximum) throw new Error(`${name} must be between 1 and ${maximum} characters`);
  return normalized;
}

export async function createNotebook(db: DbLike, input: { title: string; description?: string }, now: () => Date = () => new Date()) {
  const title = valueBetween(input.title, "Notebook title", 120);
  const description = input.description?.trim().slice(0, 1000) ?? "";
  const createdAt = now();
  const document = { title, description, state: "active", sourceAttachmentIds: [], createdAt, updatedAt: createdAt };
  const result = await db.collection("notebooks").insertOne(document);
  return { _id: result.insertedId, ...document };
}

export async function addNotebookNote(db: DbLike, input: { notebookId: string | ObjectId; sourceAttachmentId?: string; chunkId?: string; text: string }, now: () => Date = () => new Date()) {
  const notebookId = input.notebookId instanceof ObjectId ? input.notebookId : (() => {
    const normalized = typeof input.notebookId === "string" ? input.notebookId.trim() : "";
    if (!normalized) throw new Error("Notebook id is required");
    if (normalized.length > 128) throw new Error("Notebook id must be between 1 and 128 characters");
    return normalized;
  })();
  const text = valueBetween(input.text, "Notebook note", 5000);
  const createdAt = now();
  const document = { notebookId, sourceAttachmentId: input.sourceAttachmentId?.trim() || null, chunkId: input.chunkId?.trim() || null, text, createdAt, updatedAt: createdAt };
  const result = await db.collection("notebookNotes").insertOne(document);
  return { _id: result.insertedId, ...document };
}
