import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ObjectId } from "../apps/worker/node_modules/mongodb/lib/bson.js";
import * as unzipper from "../apps/worker/node_modules/unzipper/unzip.js";
import { parseWhatsAppTranscript } from "../apps/worker/src/parsers.ts";

const archivePath = process.argv[2];
if (!archivePath) throw new Error("Usage: npx tsx scripts/verify-whatsapp-parser.mjs <whatsapp-export.zip>");

const archive = await unzipper.Open.file(archivePath);
const transcript = archive.files.find(file => /\.txt$/i.test(file.path));
if (!transcript) throw new Error("No WhatsApp TXT transcript found inside the archive");
const text = (await transcript.buffer()).toString("utf8");
const rows = parseWhatsAppTranscript(text, { importId: new ObjectId("000000000000000000000001"), sourceLabel: "verification", attachmentIds: new Map() });
const rowsWithUrls = rows.filter(row => Array.isArray(row.candidate.urls) && row.candidate.urls.length > 0).length;
assert(rows.length > 0, "Expected at least one parsed WhatsApp message");

console.log(JSON.stringify({
  archiveSha256: createHash("sha256").update(await readFile(archivePath)).digest("hex"),
  archiveFiles: archive.files.length,
  transcript: transcript.path,
  parsedMessages: rows.length,
  messagesWithUrls: rowsWithUrls,
}, null, 2));

