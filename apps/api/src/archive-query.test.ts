import { describe, expect, it } from "vitest";
import { buildArchiveFilter } from "./archive-query.js";

describe("archive query filter", () => {
  it("combines text, metadata, and valid date-range filters", () => {
    const result = buildArchiveFilter({ search: "agentic ai", state: "saved", platform: "youtube", source: "youtube_takeout", topic: "LLMs", tag: "learning", from: "2026-01-01", to: "2026-01-31" });
    expect(result.search).toBe("agentic ai");
    expect(result.filter).toMatchObject({ workflowState: "saved", platform: "youtube", sourceKinds: "youtube_takeout", topics: "LLMs", tags: "learning", $text: { $search: "agentic ai" } });
    expect((result.filter.originalTimestamp as { $gte: Date; $lte: Date }).$gte).toEqual(new Date("2026-01-01"));
    expect((result.filter.originalTimestamp as { $gte: Date; $lte: Date }).$lte).toEqual(new Date("2026-01-31"));
  });

  it("ignores malformed dates while retaining other usable filters", () => {
    const result = buildArchiveFilter({ state: "review", from: "not-a-date", to: "" });
    expect(result.filter).toEqual({ workflowState: "review" });
  });
});
