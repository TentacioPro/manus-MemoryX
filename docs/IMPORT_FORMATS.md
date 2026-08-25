# Local import formats and privacy boundaries

## WhatsApp

The local parser accepts either a WhatsApp chat `.txt` file or the WhatsApp export `.zip` that contains the chat transcript plus media. It recognizes the Android-style `M/D/YY, HH:MM - Sender: message` line form, preserves multiline messages, extracts each shared HTTP(S) URL, and records shared file references. Media files in an export ZIP are copied to local MinIO, checksummed, and matched to `file attached` entries in the transcript.

The supplied archive was inspected locally without sending it anywhere. It contains one transcript and 99 other files. The parser read **1,447** non-system message candidates and identified **1,095** candidates containing at least one URL. The Docker-local review import is intentionally not committed in this sandbox because Docker is not available here; on the Windows target computer, it will run through the normal review gate.

## Instagram

Use only an archive requested through Instagram’s **Export to device** flow. The parser reads local JSON or HTML references available within the ZIP and locally supplied media. It labels every candidate as `instagram_export` and infers a Saved or Liked capture label only from the source path when it exists. If a post or reel is absent from the export, capture its URL manually or in a CSV; the system never signs into Instagram, fetches private data, scrapes pages, or automates a browser. [1]

## YouTube

Use a locally downloaded Google Takeout archive for YouTube data. The parser searches local JSON and HTML files named for playlists, Watch Later, watch history, liked content, or video records, and it canonicalizes user-provided YouTube watch, short, and short-link URLs. Private playlists and Watch Later entries are retained only where present in the user's own local archive. No YouTube Data API, sign-in, scraper, or download bot is used. Google Takeout allows users to select data for products and create a download archive; availability and exact files are determined by the user’s export. [2]

## Manual and CSV capture

For content missing from an official export, place a UTF-8 CSV in `local-imports/incoming` with the headers below. One row becomes a staged candidate and requires review before it reaches the archive.

```csv
url,title,note,tags,topics,sourceLabel
https://example.com/article,Example article,Why it matters,ai;research,LLMs,Manual capture
```

Supported fields are `url`, `title`, `note`, `tags`, `topics`, and `sourceLabel`. The `tags` and `topics` columns use comma-separated values. A URL is normalized locally; no remote metadata lookup is performed.

## Review and idempotency

Every input starts in `received`, is queued and parsed locally, then lands in `review_required`. The user may approve, reject, or cancel individual rows. Only approved rows are committed. Equivalent messages merge by deterministic fingerprints, equivalent links merge by canonical URL, and matching attachment bytes merge by SHA-256 checksum while all source references are retained.

## References

[1]: https://help.instagram.com/181231772500920/ "Instagram Help Center — Review and export a copy of your Instagram information"
[2]: https://support.google.com/accounts/answer/3024190?hl=en "Google Account Help — How to download your Google data"
