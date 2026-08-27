import type { Db } from "mongodb";
import { canonicalizeUrl } from "./domain.js";
import { addImportRows, createImport, transitionImport } from "./imports.js";

export type LocalEnrichmentDraft = { method: "heuristic" | "local-model"; suggestions: { title?: string; platform?: string; contentType?: string; topics?: string[]; tags?: string[]; summary?: string }; userAction: "accepted" | "edited" | "ignored" };
export type PublicCaptureProvenance = { contentType: string; statusCode: number; retrievedAt: string; extractor: "scrapling-parser-only" };
export type ManualCaptureInput = { url: string; title?: string; note?: string; tags?: string[]; topics?: string[]; platform?: string; contentType?: string; sourceLabel?: string; enrichment?: LocalEnrichmentDraft; captureMethod?: "manual" | "public_html"; publicCapture?: PublicCaptureProvenance };

export async function stageManualUrl(db: Db, input: ManualCaptureInput) {
  const normalized = canonicalizeUrl(input.url);
  const importId = await createImport(db, { kind: "manual", sourceLabel: input.sourceLabel?.trim() || "Manual URL capture", provenance: { inputMethod: "single_url", originalUrl: input.url, canonicalUrl: normalized.canonicalUrl, platform: normalized.platform, enrichment: input.enrichment ?? null, publicCapture: input.publicCapture ?? null } });
  await transitionImport(db, importId, "queued", { reason: "Manual URL accepted for local normalization and review staging." });
  await transitionImport(db, importId, "processing", { reason: "Creating a local review candidate from the manually supplied URL." });
  await addImportRows(db, importId, [{ ordinal: 1, warnings: [], candidate: { title: input.title?.trim() ?? "", text: input.note?.trim() || input.title?.trim() || normalized.canonicalUrl, note: input.note?.trim() ?? "", platform: input.platform?.trim() || normalized.platform, contentType: input.contentType?.trim() || null, tags: input.tags ?? [], topics: input.topics ?? [], urls: [input.url], enrichment: input.enrichment ?? null, publicCapture: input.publicCapture ?? null, source: { sourceKind: "manual_url", sourceId: `${importId.toHexString()}:1`, sourceLabel: input.sourceLabel?.trim() || "Manual URL capture", importedAt: new Date(), originalUrl: input.url, captureMethod: input.captureMethod ?? "manual" } } }]);
  await transitionImport(db, importId, "review_required", { reason: "Manual URL is staged and awaits local review before archive commitment.", summary: { parsed: 1, staged: 1 } });
  return { importId, canonicalUrl: normalized.canonicalUrl, platform: normalized.platform };
}
