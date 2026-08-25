# Local Knowledge Archive — Architecture

**Status:** Approved for implementation  
**Updated:** 2026-08-25T19:05:09+00:00  
**Operating model:** Local-only, Windows-first, Docker Compose

## Purpose and boundaries

This application is a personal knowledge archive for chat exports, educational social-media references, private video lists present in the user's own exports, notes, and locally supplied files. The stack runs on the user's Windows computer. It does not depend on paid APIs, paid hosting, scraping, account automation, private endpoints, headless browsers, or background bots.

The app accepts **WhatsApp chat exports**, **Instagram Download Your Information archives**, **Google Takeout / YouTube export data**, manual URL capture, CSV capture, and locally supplied media. Instagram exports must be requested using Instagram’s export-to-device flow. Google Takeout can create export archives for selected Google products; archive contents can differ from the user’s current account state and should be treated as source data, not a live synchronization mechanism. [1] [2]

> **Privacy rule:** A source must be a local file supplied by the user or a URL deliberately typed, pasted, or loaded from a CSV by the user. The system never signs into a social account, fetches private data, scrapes pages, simulates user behavior, or calls platform APIs.

## Architecture decision

| Component | Technology | Local responsibility | Persistence |
|---|---|---|---|
| Web interface | React + Vite | Kanban archive, review, search, import controls, job status, ledger viewer | Browser only |
| Application API | Node.js + Express + tRPC | Typed domain API, file intake, search, exports, access to MinIO and queue | Stateless container |
| Worker | Node.js + BullMQ | ZIP parsing, checksums, canonicalization, duplicate analysis, review staging, optional reachability check | Redis job records |
| Metadata store | MongoDB | Entries, sources, tags, attachments, job records, decisions, fingerprints, links | `mongo_data` Docker volume |
| Object store | MinIO | Original attachments, import archives, article captures, PDFs, EPUBs, audio, image, and video objects | `minio_data` Docker volume |
| Queue/cache | Redis | Background job queues, job state, retry metadata | `redis_data` Docker volume |
| Orchestrator | Docker Compose | One local command to start the complete application stack | Compose file + local volumes |

Windows Docker Desktop supports the Linux-container workflow used here. Docker documents the WSL 2 backend as the default Windows option and provides installation guidance. For personal use, education, non-commercial open source, and small businesses under Docker’s stated thresholds, Docker Desktop is available without a paid subscription; users in other commercial contexts should verify Docker’s current licensing terms. [3]

## Domain model

| Collection | Key fields | Purpose |
|---|---|---|
| `entries` | `fingerprint`, `text`, `note`, `workflowState`, `platform`, `topics`, `tags`, `sourceRefs`, `linkRefs`, `attachmentRefs`, `createdAt` | Searchable archive card and its preserved original context |
| `links` | `canonicalUrl`, `originalUrls`, `platform`, `reachability`, `entryIds`, `firstSeenAt` | Normalized URL entity that preserves all original references |
| `attachments` | `objectKey`, `mimeType`, `sizeBytes`, `checksumSha256`, `entryIds`, `sourceImportId`, `deletedAt` | Metadata-only attachment record; bytes remain in MinIO |
| `imports` | `kind`, `provenanceLabel`, `archiveObjectKey`, `state`, `warnings`, `jobIds`, `summary` | Import run, review state, and actionable parse issues |
| `importRows` | `importId`, `candidateEntry`, `state`, `reasons`, `entryId` | Staging table for review-before-commit processing |
| `jobs` | `queueId`, `kind`, `state`, `progress`, `failure`, `importId` | UI-visible background processing status |
| `taskLedger` | `taskId`, `parentTaskId`, `timestamp`, `state`, `decision`, `action`, `rationale`, `evidence` | Append-only development and operation log |

The database holds only metadata, references, hashes, text, and structured import data. Original file bytes are stored only in MinIO. This separation avoids database bloat and permits portable object-store backups.

## Idempotency and deduplication

An imported message has a deterministic fingerprint. For WhatsApp, the fingerprint uses a stable source identifier plus normalized message timestamp, sender, message text, and attachment reference list. For Instagram and YouTube data, it uses the source-export item identifier if available, otherwise canonical URL plus timestamp and source context. The system saves a source reference for every imported occurrence, even when content collapses into one equivalent knowledge entry.

The worker computes SHA-256 checksums for every locally supplied binary object. A matching checksum reuses the attachment record and adds the new provenance reference. Canonical URLs remove tracking parameters, lowercase hosts, normalize protocol and slash variants, and convert recognized equivalent platform formats to a single canonical form. Equivalent normalized links are merged in the `links` collection but each original URL and source entry remains traceable.

## Import and review lifecycle

| State | Meaning | Permitted transition |
|---|---|---|
| `received` | File or manual capture accepted locally | `queued`, `cancelled` |
| `queued` | Parsing and enrichment work has been scheduled | `processing`, `failed` |
| `processing` | Worker is parsing or computing hashes | `review_required`, `failed` |
| `review_required` | Candidate rows, warnings, and duplicate findings are available | `committed`, `cancelled` |
| `committed` | Reviewed candidates entered the archive | `archived` |
| `failed` | A recoverable or actionable error is present | `queued`, `cancelled` |

No import is committed directly into the archive. A review action is always required after parsing, which makes skipped files, unsupported export variants, warnings, duplicate merges, and potentially invalid links visible before persistence.

## Source-specific capabilities

| Source | Accepted local input | Supported content | Explicit non-goals |
|---|---|---|---|
| WhatsApp | `.txt` chat export or export `.zip` with media | Messages, timestamps, sender names, shared URLs, linked/local attachments | WhatsApp API access, live synchronization |
| Instagram | Official device export archive, selected JSON/HTML files, local media, manual/CSV URLs | Available saved/liked references, captions, timestamps, supplied media, source labels | Login, scraping, browser automation, private endpoints |
| YouTube | Google Takeout archive/files, manual/CSV URLs | Available watch history, playlists, Watch Later/private list entries when present, video URLs and supplied metadata | YouTube Data API, login, scraping, download bots |
| Manual | Form input, CSV, local files | Notes, URLs, tags, labels, attachments | Automatic discovery or remote page extraction |

## Object lifecycle and safe deletion

The application uploads a new object to a temporary MinIO key, calculates its checksum, and creates/updates its MongoDB attachment metadata. On commit, the object moves to a durable key that includes the checksum. When an entry loses an attachment reference, the backend checks MongoDB for remaining live references before deleting the MinIO object. A deletion worker can remove an object only after the database reference removal has succeeded and an orphan check returns zero references. The decision is logged in `taskLedger` and the deletion job record remains visible.

## Task and decision ledger

The ledger is append-only. Every development and major operational event has a timestamped state, a decision, the action that occurred, the rationale, and verification evidence. The repository copy at `docs/decision-ledger.jsonl` is the human-auditable project build log; the running application persists the same shape in MongoDB for import and maintenance events. The UI will expose a filtered ledger view that excludes imported content.

## Backup model

Metadata is exported with `mongodump` and a JSON/CSV application export. Media is backed up from MinIO using its native client synchronization command. Backup commands create timestamped directories and a manifest containing checksums. A Windows Task Scheduler-compatible PowerShell wrapper triggers the same Docker Compose commands at a user-selected schedule, while manual commands remain available for offline recovery.

## References

[1]: https://help.instagram.com/181231772500920/ "Instagram Help Center — Review and export a copy of your Instagram information"
[2]: https://support.google.com/accounts/answer/3024190?hl=en "Google Account Help — How to download your Google data"
[3]: https://docs.docker.com/desktop/setup/install/windows-install/ "Docker Docs — Install Docker Desktop on Windows"
