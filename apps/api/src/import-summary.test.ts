import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { attachImportMetadata } from "./import-summary.js";

describe("import review metadata", () => {
  it("attaches unique topics and capture methods from staged rows to their import", () => {
    const importId = new ObjectId("000000000000000000000001");
    const result = attachImportMetadata([{ _id: importId, sourceLabel: "Exploration" }], [
      { importId, candidate: { topics: ["AI", "Learning"], source: { captureMethod: "shared" } } },
      { importId, candidate: { topics: ["AI", "Career"], source: { captureMethod: "shared" } } },
      { importId, candidate: { topics: ["Research"], source: { captureMethod: "saved" } } },
    ]);
    expect(result[0].topics).toEqual(["AI", "Learning", "Career", "Research"]);
    expect(result[0].captureMethods).toEqual(["shared", "saved"]);
  });
});
