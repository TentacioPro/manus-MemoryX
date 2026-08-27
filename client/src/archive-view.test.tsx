import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArchiveView, CaptureDialog, EntryCard, ImportsView, MediaView, ResearchView, ReviewRows } from "./App";

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

  it("renders final review values alongside accepted local suggestions before commitment", () => {
    const html = renderToStaticMarkup(<ReviewRows rows={[{ _id: "row-1", ordinal: 1, state: "staged", candidate: { title: "My edited AI reel", platform: "instagram", contentType: "educational reel", tags: ["edited-tag"], topics: ["My topic"], urls: ["https://www.instagram.com/reel/learn-ai/"], enrichment: { method: "heuristic", userAction: "edited", suggestions: { title: "Learn Ai", platform: "instagram", contentType: "reel", tags: ["reel"], topics: ["instagram"] } } } }]} />);
    expect(html).toContain("Final title");
    expect(html).toContain("My edited AI reel");
    expect(html).toContain("educational reel");
    expect(html).toContain("Local suggestion record · edited");
    expect(html).toContain("Suggested title:");
    expect(html).toContain("Learn Ai");
  });

  it("renders editable local suggestion controls in the actual capture dialog", () => {
    const html = renderToStaticMarkup(<CaptureDialog capture={{ url: "https://youtube.com/watch?v=local", title: "Suggested Video", note: "", tags: "video", topics: "youtube", platform: "youtube", contentType: "video", sourceLabel: "Manual capture", enrichment: { method: "heuristic", userAction: "accepted", suggestions: { title: "Suggested Video", platform: "youtube", contentType: "video", tags: ["video"], topics: ["youtube"] } } }} onCaptureChange={() => undefined} onClose={() => undefined} onSubmit={() => undefined} onSuggest={() => undefined} onPublicCapture={() => undefined} onAccept={() => undefined} onIgnore={() => undefined} />);
    expect(html).toContain("Suggest locally");
    expect(html).toContain("Platform");
    expect(html).toContain("Content type");
    expect(html).toContain("Accept suggestions");
    expect(html).toContain("Ignore suggestions");
    expect(html).toContain("Stage for review");
    expect(html).toContain("Capture permitted public page");
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
    const html = renderToStaticMarkup(<MediaView loading={false} onUpload={() => undefined} onDelete={() => undefined} onIndex={() => undefined} attachments={[{ _id: "attachment-1", filename: "notes.pdf", mimeType: "application/pdf", sizeBytes: 2048, checksumSha256: "abc123abc123abc123" }]} />);
    expect(html).toContain("Upload attachment");
    expect(html).toContain("Preview / download");
    expect(html).toContain("Remove if unreferenced");
    expect(html).toContain("Index for local RAG");
  });

  it("renders local hybrid retrieval results with source citations and without a generated answer", () => {
    const html = renderToStaticMarkup(<ResearchView query="hybrid retrieval" setQuery={() => undefined} onSearch={() => undefined} loading={false} error="" results={[{ chunkId: "chunk-1", text: "Hybrid retrieval combines lexical and dense ranking.", retrievalScore: 0.03, rerankScore: 0.97, citation: { sourceAttachmentId: "attachment-1", headingPath: ["Findings"], pageStart: 7, pageEnd: 8 } }]} notebooks={[{ _id: "notebook-1", title: "RAG evaluation", description: "Compare sources." }]} selectedNotebookId="notebook-1" onSelectNotebook={() => undefined} notes={[{ _id: "note-1", text: "The source span is useful.", sourceAttachmentId: "attachment-1" }]} notebookTitle="" setNotebookTitle={() => undefined} onCreateNotebook={() => undefined} noteText="" setNoteText={() => undefined} onAddNote={() => undefined} />);
    expect(html).toContain("Research workspace");
    expect(html).toContain("Search local sources");
    expect(html).toContain("Hybrid retrieval combines lexical and dense ranking.");
    expect(html).toContain("Findings");
    expect(html).toContain("Pages 7–8");
    expect(html).toContain("Retrieval only");
    expect(html).toContain("RAG evaluation");
    expect(html).toContain("The source span is useful.");
    expect(html).toContain("New notebook");
  });
});
