import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArchiveView, EntryCard, ImportsView, MediaView } from "./App";

describe("archive metadata views", () => {
  it("renders persisted topic, capture, duplicate, and invalid-link signals on an archive card", () => {
    const html = renderToStaticMarkup(<EntryCard entry={{ _id: "entry-1", text: "Useful item", workflowState: "review", duplicateState: "merged", linkState: "invalid", invalidLinkCount: 2, topics: ["AI", "Learning"], sourceRefs: [{ sourceLabel: "Exploration", sourceKind: "whatsapp_export", captureMethod: "shared" }], attachments: [{ _id: "attachment-1", filename: "notes.pdf", mimeType: "application/pdf", sizeBytes: 1024, checksumSha256: "abc" }] }} onMove={() => undefined} onUnlinkAttachment={() => undefined} />);
    expect(html).toContain("merged");
    expect(html).toContain("invalid links");
    expect(html).toContain("Topic · AI");
    expect(html).toContain("shared");
    expect(html).toContain("Unlink notes.pdf");
  });

  it("renders import-level source, capture, and topic metadata", () => {
    const html = renderToStaticMarkup(<ImportsView loading={false} jobs={[]} imports={[{ _id: "import-1", kind: "youtube", sourceLabel: "Google Takeout", state: "review_required", captureMethods: ["watch_later"], topics: ["AI", "Research"], summary: { parsed: 2, staged: 2 } }]} />);
    expect(html).toContain("Source · Google Takeout");
    expect(html).toContain("Capture · watch_later");
    expect(html).toContain("Topic · Research");
  });

  it("renders the active search string and date-range controls when filters are open", () => {
    const grouped = { inbox: [], review: [], saved: [], archived: [] };
    const html = renderToStaticMarkup(<ArchiveView entries={[]} grouped={grouped} filters={{ platform: "", source: "", attachmentType: "", state: "", from: "2026-01-01", to: "2026-01-31" }} setFilters={() => undefined} search="agentic ai" setSearch={() => undefined} filtersOpen setFiltersOpen={() => undefined} loading={false} onMove={() => undefined} onUnlinkAttachment={() => undefined} onCapture={() => undefined} />);
    expect(html).toContain("agentic ai");
    expect(html).toContain("From date");
    expect(html).toContain("To date");
    expect(html).toContain("2026-01-01");
    expect(html).toContain("2026-01-31");
  });

  it("renders local attachment upload, preview, and guarded removal actions", () => {
    const html = renderToStaticMarkup(<MediaView loading={false} onUpload={() => undefined} onDelete={() => undefined} attachments={[{ _id: "attachment-1", filename: "notes.pdf", mimeType: "application/pdf", sizeBytes: 2048, checksumSha256: "abc123abc123abc123" }]} />);
    expect(html).toContain("Upload attachment");
    expect(html).toContain("Preview / download");
    expect(html).toContain("Remove if unreferenced");
  });
});
