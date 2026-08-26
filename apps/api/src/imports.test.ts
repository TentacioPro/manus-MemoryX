import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { addImportRows, createImport, transitionImport } from "./imports.js";
import { cancelImportRow, reviewImportRow, retryFailedRows, transitionImportRow } from "./import-rows.js";

function makeWorkflowDb() {
  const importId = new ObjectId("0000000000000000000000c1"); const rowId = new ObjectId("0000000000000000000000c2");
  const imports: any[] = [{ _id: importId, state: "received", summary: { staged: 0 }, warnings: [] }];
  const rows: any[] = [{ _id: rowId, importId, state: "staged", candidate: {}, ordinal: 0 }]; const ledger: any[] = [];
  return { importId, rowId, imports, rows, ledger, db: { collection(name: string) {
    if (name === "imports") return {
      insertOne: async (doc: any) => { const item = { ...doc, _id: importId }; imports.push(item); return { insertedId: importId }; },
      findOne: async (filter: any) => imports.find(item => item._id.equals(filter._id)) ?? null,
      updateOne: async (filter: any, update: any) => { const item = imports.find(row => row._id.equals(filter._id)); if (!item) return { modifiedCount: 0 }; if (update.$set) Object.assign(item, update.$set); if (update.$inc) Object.entries(update.$inc).forEach(([key, value]) => { const part = key.split(".")[1]; item.summary[part] = (item.summary[part] ?? 0) + Number(value); }); if (update.$addToSet?.warnings && !item.warnings.includes(update.$addToSet.warnings)) item.warnings.push(update.$addToSet.warnings); return { modifiedCount: 1 }; },
    };
    if (name === "importRows") return {
      insertMany: async (items: any[]) => { rows.push(...items.map(item => ({ ...item, _id: new ObjectId() }))); return { insertedCount: items.length }; },
      findOne: async (filter: any) => rows.find(item => item._id.equals(filter._id)) ?? null,
      updateOne: async (filter: any, update: any) => { const item = rows.find(row => row._id.equals(filter._id)); if (item && update.$set) Object.assign(item, update.$set); return { modifiedCount: item ? 1 : 0 }; },
      updateMany: async (filter: any, update: any) => { const selected = rows.filter(item => item.importId.equals(filter.importId) && item.state === filter.state); selected.forEach(item => Object.assign(item, update.$set)); return { modifiedCount: selected.length }; },
    };
    if (name === "taskLedger") return { insertOne: async (event: any) => { ledger.push(event); return { insertedId: new ObjectId() }; } };
    throw new Error(`Unexpected collection ${name}`);
  } } as any };
}

describe("import and review row lifecycles", () => {
  it("creates, stages, and transitions an import through review_required with durable warnings", async () => {
    const context = makeWorkflowDb();
    const created = await createImport(context.db, { kind: "whatsapp", sourceLabel: "Study group", fileName: "chat.zip", provenance: { format: "zip" } });
    expect(created).toEqual(context.importId);
    await transitionImport(context.db, context.importId, "queued"); await transitionImport(context.db, context.importId, "failed", { failure: "Temporary parse error" }); await transitionImport(context.db, context.importId, "queued"); await transitionImport(context.db, context.importId, "processing"); await transitionImport(context.db, context.importId, "review_required", { warning: "One malformed URL" });
    await addImportRows(context.db, context.importId, [{ ordinal: 1, candidate: { text: "Useful note" } }]);
    expect(context.imports[0].state).toBe("review_required");
    expect(context.imports[0].warnings).toContain("One malformed URL");
    expect(context.imports[0].summary.staged).toBe(1);
  });

  it("allows review, rejection, cancellation, failed-row retry, and rejects invalid row transitions", async () => {
    const context = makeWorkflowDb();
    await reviewImportRow(context.db, context.rowId, true, "Useful reference"); await transitionImportRow(context.db, context.rowId, "failed", { failure: "Parser warning needs retry" });
    expect(context.rows[0].state).toBe("failed");
    expect(await retryFailedRows(context.db, context.importId)).toBe(1);
    await transitionImportRow(context.db, context.rowId, "rejected", { reason: "Out of scope" }); await reviewImportRow(context.db, context.rowId, true);
    await cancelImportRow(context.db, context.rowId, "No longer needed");
    expect(context.rows[0].state).toBe("cancelled");
    await expect(transitionImportRow(context.db, context.rowId, "committed")).rejects.toThrow("Cannot move import row");
  });

  it("allows a reviewed candidate to become committed with its resulting archive entry id", async () => {
    const context = makeWorkflowDb(); const entryId = new ObjectId("0000000000000000000000c3");
    await reviewImportRow(context.db, context.rowId, true);
    await transitionImportRow(context.db, context.rowId, "committed", { entryId, reason: "Archive entry created." });
    expect(context.rows[0].state).toBe("committed");
    expect(context.rows[0].entryId).toEqual(entryId);
  });
});
