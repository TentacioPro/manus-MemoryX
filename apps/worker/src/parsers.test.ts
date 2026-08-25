import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { parseManualCsv, parseSocialExport, parseWhatsAppTranscript } from "./parsers.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const importId = new ObjectId("000000000000000000000001");

describe("local source parsers", () => {
  it("preserves multiline WhatsApp messages, URLs, and shared-message provenance", () => {
    const transcript = "6/25/25, 08:05 - Abishek M: First line\nSecond line https://youtu.be/example?si=tracking\n6/25/25, 08:06 - Abishek M: Another message";
    const rows = parseWhatsAppTranscript(transcript, { importId, sourceLabel: "Exploration group", attachmentIds: new Map() });
    expect(rows).toHaveLength(2);
    expect(rows[0].candidate.text).toContain("Second line");
    expect(rows[0].candidate.urls).toEqual(["https://youtu.be/example?si=tracking"]);
    expect((rows[0].candidate.source as { sourceKind: string }).sourceKind).toBe("whatsapp_export");
  });

  it("stages locally exported Instagram saved references and supplied media without remote access", async () => {
    const content = await readFile(fixture("instagram-saved-export.json"));
    const rows = await parseSocialExport([{ path: "your_instagram_activity/saved/saved_posts.json", type: "File", buffer: async () => content } as never], { _id: importId, kind: "instagram", sourceLabel: "Instagram export", fileName: "instagram.zip" }, new Map([["saved-image.jpg", new ObjectId("000000000000000000000002")]]));
    expect(rows).toHaveLength(2);
    expect(rows[0].candidate.urls).toContain("https://www.instagram.com/reel/EDUCATIONAL001/?igsh=tracking-value");
    expect((rows[0].candidate.source as { captureMethod: string }).captureMethod).toBe("saved");
    expect(rows[1].candidate.attachmentIds).toHaveLength(1);
  });

  it("stages locally exported YouTube Watch Later references without account access", async () => {
    const content = await readFile(fixture("youtube-watch-later-export.json"));
    const rows = await parseSocialExport([{ path: "YouTube and YouTube Music/playlists/Watch Later.json", type: "File", buffer: async () => content } as never], { _id: importId, kind: "youtube", sourceLabel: "Google Takeout", fileName: "takeout.zip" }, new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0].candidate.urls).toContain("https://www.youtube.com/watch?v=privateEducationalVideo&feature=share");
    expect((rows[0].candidate.source as { captureMethod: string }).captureMethod).toBe("watch_later");
  });

  it("stages manual CSV capture with tags, topics, and a manual source label", async () => {
    const rows = await parseManualCsv(fixture("manual-capture.csv"), { _id: importId, kind: "csv", sourceLabel: "CSV", fileName: "manual-capture.csv" });
    expect(rows).toHaveLength(1);
    expect(rows[0].candidate.tags).toEqual(["ai", "video"]);
    expect(rows[0].candidate.topics).toEqual(["AI", "learning"]);
    expect((rows[0].candidate.source as { sourceKind: string }).sourceKind).toBe("csv");
  });
});
