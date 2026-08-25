import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { recordLedger } from "./ledger.js";

describe("append-only task ledger", () => {
  it("inserts a separate timestamped event for each state change", async () => {
    const events: Array<Record<string, unknown>> = [];
    const db = { collection(name: string) { if (name !== "taskLedger") throw new Error(`Unexpected collection ${name}`); return { insertOne: async (event: Record<string, unknown>) => { events.push(event); return { insertedId: new ObjectId() }; } }; } } as any;
    const base = { taskId: "import.whatsapp", decision: "Queue the local export.", action: "Created a queue job.", rationale: "Imports must be auditable.", evidence: "job=1" };
    await recordLedger(db, { ...base, state: "started" });
    await recordLedger(db, { ...base, state: "completed", action: "Completed parsing." });
    expect(events).toHaveLength(2);
    expect(events.map(event => event.state)).toEqual(["started", "completed"]);
    expect(events.every(event => event.timestamp instanceof Date)).toBe(true);
  });
});
