# Optional Local URL Enrichment

## Purpose

The archive can optionally suggest metadata after a user captures a URL. The feature is designed to remain **local, editable, and non-invasive**. It must never require a paid AI API, platform login, private endpoint, browser bot, or scraping.

## Permitted local inputs

| Input | Allowed use |
|---|---|
| Captured URL | Canonical platform and content-type detection from its host and path. |
| User-written title or note | Local topic, tag, and summary suggestions. |
| Local WhatsApp, Instagram, or YouTube export metadata | Source, capture method, timestamps, playlist, captions, and locally supplied attachment references. |
| Locally supplied article capture | Local title, body text, and tags. |

The enricher must not fetch an Instagram or YouTube page, simulate a login, visit private endpoints, or operate a browser bot. URL-only suggestions therefore remain conservative.

## Suggestion contract

The enrichment result is a draft, not authoritative archive data.

```json
{
  "title": "Suggested title",
  "platform": "youtube",
  "contentType": "video",
  "topics": ["AI", "motivation"],
  "tags": ["local-llm", "learning"],
  "summary": "Optional short summary from locally supplied text",
  "confidence": 0.0,
  "method": "heuristic | local-model"
}
```

The capture form must show each suggested value before commitment. A user can modify, remove, or ignore every field. The application stores the original captured URL and source provenance separately from all suggestions.

## Implementation stages

The first stage uses deterministic local URL heuristics to identify common platform and content patterns. An optional second stage may connect to a user-installed, local-only inference runtime on `localhost`, if the user deliberately enables it. The model runtime, endpoint, model choice, and any downloaded model weights remain the user’s local responsibility and are not required for importing or searching the archive.

## Safety and privacy rules

The enrichment action is opt-in per capture. It receives only the URL, local note, and local export metadata chosen by the user. It must record the method, timestamp, inputs used, and whether the user accepted or edited suggestions in the archive decision ledger.
