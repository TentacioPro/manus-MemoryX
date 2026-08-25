import { createHash } from "node:crypto";

export type Platform = "whatsapp" | "instagram" | "youtube" | "github" | "linkedin" | "reddit" | "x" | "web" | "manual";

export type SourceReference = {
  sourceKind: "whatsapp_export" | "instagram_export" | "youtube_takeout" | "manual_url" | "csv";
  sourceId: string;
  sourceLabel: string;
  importedAt: Date;
  originalUrl?: string;
  originalTimestamp?: Date | null;
  sender?: string | null;
  captureMethod?: "saved" | "liked" | "watch_later" | "playlist" | "manual" | "shared";
};

const trackingParameter = /^(utm_|fbclid$|gclid$|igsh$|si$|feature$|app$|ref$)/i;

export function identifyPlatform(value: URL): Platform {
  const host = value.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "instagram.com") return "instagram";
  if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") return "youtube";
  if (host === "github.com") return "github";
  if (host === "linkedin.com") return "linkedin";
  if (host === "reddit.com") return "reddit";
  if (host === "x.com" || host === "twitter.com") return "x";
  return "web";
}

export function canonicalizeUrl(raw: string) {
  const supplied = raw.trim();
  const withProtocol = /^https?:\/\//i.test(supplied) ? supplied : `https://${supplied}`;
  const parsed = new URL(withProtocol);
  parsed.protocol = "https:";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) if (trackingParameter.test(key)) parsed.searchParams.delete(key);

  let platform = identifyPlatform(parsed);
  if (platform === "youtube") {
    const videoId = parsed.hostname === "youtu.be" ? parsed.pathname.slice(1) : parsed.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/)?.[1] ?? parsed.searchParams.get("v");
    if (videoId) return { canonicalUrl: `https://youtube.com/watch?v=${encodeURIComponent(videoId)}`, platform, isValid: true };
    parsed.hostname = "youtube.com";
  }
  if (platform === "instagram") {
    const match = parsed.pathname.match(/^\/(p|reel|reels)\/([^/?]+)/i);
    if (match) return { canonicalUrl: `https://instagram.com/${match[1].toLowerCase() === "reels" ? "reel" : match[1].toLowerCase()}/${match[2]}/`, platform, isValid: true };
  }
  if (platform === "x") parsed.hostname = "x.com";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return { canonicalUrl: parsed.toString(), platform, isValid: true };
}

export function messageFingerprint(input: { sourceKind: string; originalTimestamp?: Date | null; sender?: string | null; text?: string | null; attachmentKeys?: string[] }) {
  const stable = JSON.stringify({
    sourceKind: input.sourceKind,
    originalTimestamp: input.originalTimestamp?.toISOString() ?? null,
    sender: (input.sender ?? "").trim().toLocaleLowerCase(),
    text: (input.text ?? "").replace(/\s+/g, " ").trim(),
    attachmentKeys: [...(input.attachmentKeys ?? [])].sort(),
  });
  return createHash("sha256").update(stable).digest("hex");
}

export function sourceReferenceFingerprint(reference: SourceReference) {
  return createHash("sha256").update(JSON.stringify({ sourceKind: reference.sourceKind, sourceId: reference.sourceId, sourceLabel: reference.sourceLabel, originalUrl: reference.originalUrl ?? null, originalTimestamp: reference.originalTimestamp?.toISOString() ?? null, sender: reference.sender ?? null, captureMethod: reference.captureMethod ?? null })).digest("hex");
}
