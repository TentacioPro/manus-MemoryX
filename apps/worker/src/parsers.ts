import { createReadStream, promises as fs } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { lookup } from "mime-types";
import { parse as parseCsv } from "csv-parse/sync";
import * as unzipper from "unzipper";
import type { Db, ObjectId } from "mongodb";
import { saveStream } from "./storage.js";

export type ParsedCandidate = { ordinal: number; candidate: Record<string, unknown>; warnings: string[]; duplicateState?: "unique" | "possible_duplicate" | "duplicate" };
type ImportInfo = { _id: ObjectId; kind: "whatsapp" | "instagram" | "youtube" | "manual" | "csv"; sourceLabel: string; fileName: string; provenance?: Record<string, unknown> };
type ZipEntry = { path: string; type: "File" | "Directory"; stream: () => NodeJS.ReadableStream; buffer: () => Promise<Buffer> };

const urlPattern = /https?:\/\/[^\s<>()"']+/gi;
const whatsappStart = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s(\d{1,2}):(\d{2})(?:\s?(AM|PM))?\s-\s(?:(.*?):\s)?(.*)$/;
const attachmentPattern = /(?:^|\n)([^\n]+?\.(?:jpg|jpeg|png|gif|webp|mp4|mov|mp3|ogg|opus|wav|pdf|epub|docx?|pptx?|xlsx?|zip))\s*\(file attached\)/gi;

const extractUrls = (text: string) => [...new Set((text.match(urlPattern) ?? []).map(url => url.replace(/[),.;]+$/, "")))];
const captureMethodFor = (name: string) => /watch.?later/i.test(name) ? "watch_later" : /playlist/i.test(name) ? "playlist" : /liked/i.test(name) ? "liked" : /saved/i.test(name) ? "saved" : "manual";
const parsedDate = (month: string, day: string, year: string, hour: string, minute: string, period?: string) => {
  let normalizedHour = Number(hour); if (period === "PM" && normalizedHour < 12) normalizedHour += 12; if (period === "AM" && normalizedHour === 12) normalizedHour = 0;
  return new Date(Date.UTC(Number(year.length === 2 ? `20${year}` : year), Number(month) - 1, Number(day), normalizedHour, Number(minute)));
};
const streamToBuffer = async (stream: NodeJS.ReadableStream) => { const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); return Buffer.concat(chunks); };
const zipEntries = async (filePath: string) => (await unzipper.Open.file(filePath)).files as ZipEntry[];

export function parseWhatsAppTranscript(text: string, input: { importId: ObjectId; sourceLabel: string; attachmentIds: Map<string, ObjectId> }) {
  const output: ParsedCandidate[] = [];
  let current: { date: Date; sender: string | null; text: string } | null = null;
  const flush = () => {
    if (!current) return;
    const message = current.text.trim();
    const isSystemMessage = !current.sender && /(end-to-end encrypted|created this group)/i.test(message);
    if (!isSystemMessage && message) {
      const attachmentIds: ObjectId[] = []; let hit: RegExpExecArray | null;
      attachmentPattern.lastIndex = 0;
      while ((hit = attachmentPattern.exec(message))) { const id = input.attachmentIds.get(basename(hit[1]).toLowerCase()); if (id) attachmentIds.push(id); }
      output.push({ ordinal: output.length + 1, warnings: [], candidate: { text: message, originalTimestamp: current.date, sender: current.sender, urls: extractUrls(message), attachmentIds, source: { sourceKind: "whatsapp_export", sourceId: `${input.importId.toHexString()}:${output.length + 1}`, sourceLabel: input.sourceLabel, importedAt: new Date(), originalTimestamp: current.date, sender: current.sender, captureMethod: "shared" } } });
    }
    current = null;
  };
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(whatsappStart);
    if (match) { flush(); current = { date: parsedDate(match[1], match[2], match[3], match[4], match[5], match[6]), sender: match[7] ?? null, text: match[8] }; }
    else if (current) current.text += `\n${line}`;
  }
  flush();
  return output;
}

function collectStrings(value: unknown, output: string[] = []) { if (typeof value === "string") output.push(value); else if (Array.isArray(value)) value.forEach(item => collectStrings(item, output)); else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(item => collectStrings(item, output)); return output; }
export async function parseSocialExport(entries: ZipEntry[], info: ImportInfo, attachmentIds: Map<string, ObjectId>) {
  const selectors = info.kind === "instagram" ? /(saved|liked|post|reel).*(json|html)$/i : /(watch.?later|playlist|watch.?history|liked|video).*(json|html)$/i;
  const candidates: ParsedCandidate[] = [];
  for (const entry of entries.filter(entry => entry.type === "File" && selectors.test(entry.path))) {
    const content = (await entry.buffer()).toString("utf8"); let strings: string[] = [content];
    if (/\.json$/i.test(entry.path)) { try { strings = collectStrings(JSON.parse(content)); } catch { strings = [content]; } }
    const urls = [...new Set(strings.flatMap(extractUrls))];
    for (const url of urls) candidates.push({ ordinal: candidates.length + 1, warnings: [], candidate: { text: `${info.kind === "instagram" ? "Instagram" : "YouTube"} export reference from ${entry.path}`, urls: [url], source: { sourceKind: info.kind === "instagram" ? "instagram_export" : "youtube_takeout", sourceId: `${info._id.toHexString()}:${entry.path}:${candidates.length + 1}`, sourceLabel: info.sourceLabel, importedAt: new Date(), originalUrl: url, captureMethod: captureMethodFor(entry.path) } } });
  }
  for (const [filename, attachmentId] of attachmentIds) {
    candidates.push({ ordinal: candidates.length + 1, warnings: [], candidate: { text: `Locally supplied ${info.kind} export media: ${filename}`, attachmentIds: [attachmentId], source: { sourceKind: info.kind === "instagram" ? "instagram_export" : "youtube_takeout", sourceId: `${info._id.toHexString()}:media:${filename}`, sourceLabel: info.sourceLabel, importedAt: new Date(), captureMethod: captureMethodFor(filename) } } });
  }
  return candidates;
}

export async function parseManualCsv(filePath: string, info: ImportInfo): Promise<ParsedCandidate[]> {
  const records = parseCsv(await fs.readFile(filePath, "utf8"), { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>;
  return records.map((row, index) => ({ ordinal: index + 1, warnings: row.url ? [] : ["No URL supplied"], candidate: { title: row.title ?? "", text: row.note ?? row.title ?? "", note: row.note ?? "", tags: (row.tags ?? "").split(",").map(value => value.trim()).filter(Boolean), topics: (row.topics ?? "").split(",").map(value => value.trim()).filter(Boolean), urls: row.url ? [row.url] : [], source: { sourceKind: info.kind === "csv" ? "csv" : "manual_url", sourceId: `${info._id.toHexString()}:${index + 1}`, sourceLabel: row.sourceLabel || info.sourceLabel, importedAt: new Date(), originalUrl: row.url || undefined, captureMethod: "manual" } } }));
}

async function uploadZipAttachments(db: Db, entries: ZipEntry[], importId: ObjectId) {
  const map = new Map<string, ObjectId>();
  for (const entry of entries.filter(entry => entry.type === "File" && !/\.(txt|json|html|csv)$/i.test(entry.path))) {
    const filename = basename(entry.path); const mimeType = lookup(filename) || "application/octet-stream";
    const uploaded = await saveStream(db, { stream: entry.stream(), filename, mimeType, importId, kind: "attachment" });
    if (uploaded.id) map.set(filename.toLowerCase(), uploaded.id);
  }
  return map;
}

export async function parseLocalImport(db: Db, info: ImportInfo, rootDirectory: string) {
  const filePath = resolve(rootDirectory, "incoming", basename(info.fileName));
  if (!filePath.startsWith(resolve(rootDirectory, "incoming"))) throw new Error("Unsafe local import file path");
  await fs.access(filePath);
  if (info.kind === "manual" || info.kind === "csv") return parseManualCsv(filePath, info);
  const isZip = extname(filePath).toLowerCase() === ".zip";
  if (info.kind === "whatsapp") {
    if (!isZip) return parseWhatsAppTranscript(await fs.readFile(filePath, "utf8"), { importId: info._id, sourceLabel: info.sourceLabel, attachmentIds: new Map() });
    const entries = await zipEntries(filePath); const transcript = entries.find(entry => entry.type === "File" && /\.txt$/i.test(entry.path));
    if (!transcript) throw new Error("WhatsApp ZIP has no TXT chat transcript");
    const attachmentIds = await uploadZipAttachments(db, entries, info._id);
    return parseWhatsAppTranscript((await transcript.buffer()).toString("utf8"), { importId: info._id, sourceLabel: info.sourceLabel, attachmentIds });
  }
  if (!isZip) throw new Error(`${info.kind} imports must be supplied as an official ZIP export or manual CSV`);
  const entries = await zipEntries(filePath);
  const attachmentIds = await uploadZipAttachments(db, entries, info._id);
  return parseSocialExport(entries, info, attachmentIds);
}
