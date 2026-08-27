# Local document intelligence and retrieval architecture

## Objective

This extension adds a **fully local, citation-ready retrieval system** to Knowledge Vault. It is designed for files already in the archive and for explicitly requested, anonymously accessible public sources. It does not require a paid embedding API, a hosted LLM, login automation, browser cookies, stealth tooling, proxy rotation, or access-control bypassing.

> Retrieval returns source-backed passages. It does not silently turn source material into an untraceable answer.

## Selected high-quality profile

| Layer | Selected component | Role | Locality and boundary |
| --- | --- | --- | --- |
| Source bytes | Existing MinIO service | Stores original uploaded/exported files; guarded public capture stages extracted text and provenance for review rather than silently retaining raw remote HTML. | Private to the Compose network. |
| Metadata and provenance | Existing MongoDB service | Stores source, import, chunk, notebook, processing-version, and review metadata. | Private to the Compose network. |
| Document conversion | Docling service | Converts supported local documents into structured content with layout and page context. | Runs locally; model assets are downloaded once by the user, then can operate offline. |
| Semantic and hybrid retrieval | Qdrant service | Persists dense vectors, sparse/BM25 representations, payload filters, and retrieval collections. | Runs locally with a persistent Docker volume. |
| Embeddings | Local BGE-M3-compatible adapter | Generates dense and sparse representations without a hosted embedding API. | Runs locally; the configured model and revision are retained as provenance. |
| Reranking | Optional local cross-encoder adapter | Reranks a small candidate set after hybrid retrieval. | Disabled until its local model is available; never required to store or retrieve sources. |
| Public-source extraction | Guarded Scrapling parser profile | Parses only responses obtained by an ordinary anonymous public HTTP request. | Prohibits stealth, proxies, cookies, login, browser automation, captured API traffic, and anti-bot features. |
| Research workspace | Native React notebook workspace | Organizes notebooks, notes, retrieval results, and citations. | Mirrors Open Notebook's useful notebook/source/note mental model without importing its separate database and AI-provider stack. |

Docling documents local processing and broad document/image conversion support, including PDF, EPUB, office files, and HTML. The current index worker is document-text oriented; **audio and video require dedicated local transcription/extraction adapters and are not text-indexed yet**. Qdrant documents a local Docker deployment and supports vector payload filtering and hybrid retrieval. Sentence Transformers supports local embedding and cross-encoder reranking workflows. [1] [2] [3]

## Why this does not use Perplexity or LlamaIndex in the critical path

Perplexity embedding or context services would introduce a hosted dependency, account configuration, external data transfer, and possible recurring usage cost. They are intentionally excluded from the default architecture.

LlamaIndex is useful as an orchestration framework, but it is not necessary for correctness. This project owns its source, chunk, and retrieval contracts directly so that each processing step can be deterministic, versioned, testable, and recoverable. A future adapter may expose the same local Qdrant collection to LlamaIndex without changing the archive's source of truth.

## Industrial retrieval pipeline

### 1. Immutable source intake

Every ingestion job identifies a source using one of the following inputs: an existing attachment identifier, a manually uploaded file, or a policy-approved public URL response. The source record includes its original URL or object key, SHA-256 checksum, MIME type, byte length, import identifier, capture method, retrieval timestamp, and processing-policy version.

The pipeline never replaces the original bytes. Derived artifacts include an extracted structured document, normalized Markdown/text, chunks, vectors, and retrieval telemetry. Each artifact points to the immutable source and can be regenerated when its conversion, chunking, or model version changes.

### 2. Structured conversion

Docling conversion receives a local file path or a bounded local copy of an approved public response. The output preserves page number, heading hierarchy, tables, captions, and confidence where the converter provides it. Docling's HTTP server is a supported option for sharing one conversion service across the Node API and worker boundary. Conversion failures become reviewable job states rather than hidden omissions. [6]

### 3. Deterministic, structure-aware chunking

Chunks are built from heading and page boundaries first, then split only when their token budget is exceeded. The default target is **450–700 tokens** with a maximum of **850 tokens**. Overlap is limited to a small boundary carry-over only where a split occurs inside a section; headings, page identifiers, source title, and section path are repeated in metadata rather than by duplicating large text ranges.

The current implementation uses a deterministic heading-aware Markdown chunker with bounded overlap and stable provenance fingerprints. Docling's native HybridChunker is a compatible future refinement where its hierarchical output and configured tokenizer can be carried through the job contract; it is not silently claimed as active until that integration is implemented. Each emitted chunk receives a deterministic SHA-256 fingerprint over the source checksum, extractor version, section path, page range, normalized text, chunking version, and ordinal. This gives idempotent re-indexing and permits exact invalidation on source or configuration changes. [7]

### 4. Embedding, lexical representation, and optional reranking

The initial local profile creates both a dense semantic representation and a sparse lexical representation. The retrieval collection is versioned by embedding model, model revision, vector dimensions, normalization behavior, sparse model, chunking version, and conversion version. Re-indexing writes to a new collection and only switches the active alias after validation.

For each query, the service:

1. Normalizes the query without sending it outside the machine.
2. Runs dense semantic retrieval and lexical retrieval with identical notebook and metadata filters.
3. Fuses the candidate rankings with reciprocal-rank fusion.
4. Applies diversity limits so that one document cannot consume every result.
5. Optionally reranks only the top candidate set with a local cross-encoder.
6. Returns passages with source title, page/section, URL or attachment link, score components, and a stable citation identifier.

The default interface is **retrieval only**. A future locally configured generation model may use the cited results as context, but generative answers are deliberately outside this first retrieval milestone.

### 5. Evaluation and observability

The system records job status, timing, source and chunk counts, model identifiers, failure stage, and errors. It does not record imported personal message contents in the decision ledger.

Retrieval quality is evaluated with a user-owned query set containing expected source identifiers. The initial acceptance metrics are Recall@10, MRR@10, nDCG@10, zero-result rate, extraction failure rate, and indexing latency. Configuration changes are not promoted until their results can be compared with the baseline.

## Open Notebook–style research workspace

Open Notebook's useful mental model is **notebooks, sources, and notes**, alongside a distinction between full-source context and retrieval. [4] Knowledge Vault will implement those concepts directly:

| Workspace object | Meaning | Access control |
| --- | --- | --- |
| Notebook | A user-defined research scope, such as “AI learning”, “Motivation”, or “Research papers”. | Current implementation stores local notebook metadata and notes; source assignment and notebook-scoped retrieval are an explicitly tracked next step. |
| Source | An archived entry, attachment, local document, or policy-approved public capture. | Keeps original source provenance and review state. |
| Note | A user-authored observation linked to zero or more citations. | Notes are separate from imported source text. |
| Retrieval result | A ranked, cited source passage. | Shows why it matched and which source/page/section it came from. |
| Context selection | The source and notebook scope supplied to a future optional local answer model. | Defaults to retrieval only; user selection is explicit. |

## Guarded public-capture policy

The public-source integration uses a **deny-by-default configuration**. It can fetch only a user-supplied `https` URL through a normal anonymous request after policy and target-network checks. It does not follow redirects; the user must explicitly capture the final URL after review.

| Control | Required behavior |
| --- | --- |
| Access mode | Anonymous only; no login credentials, session state, browser cookies, or OAuth tokens. |
| Anti-evasion | No stealth mode, browser impersonation, proxy rotation, CAPTCHA handling, fingerprint spoofing, API capture, or anti-bot bypass. |
| Robots and terms | Prefer permitted sources; honor declared robots restrictions and stop when the host refuses ordinary access. |
| Network safety | Block localhost, private/link-local ranges, metadata endpoints, non-HTTP protocols, unsafe redirects, and user-info URL components. |
| Limits | Per-host rate limit, host lock, MIME allowlist, response-size cap, timeout, no redirects, and a maximum crawl depth of one. |
| Content hygiene | Retain raw response checksum; strip executable markup before extraction; store remote text as untrusted content; never execute source instructions. |
| Review | A response becomes a staged candidate with its policy decision, final URL, retrieval timestamp, headers subset, and source provenance. |
| Failure behavior | Treat `401`, `403`, `429`, CAPTCHA/interstitial patterns, robots rejection, and non-allowlisted MIME as terminal reviewable failures—never retry with bypass tactics. |

Scrapling will be constrained to its HTML parser functions only. Its fetchers, dynamic browser drivers, session support, proxy features, captured API traffic, and advertised anti-bot capabilities are explicitly unavailable to this integration. [5]

## Compose and resource plan

The new stack will add persistent named volumes for Qdrant vectors and Docling model/cache data. The public API will remain the only externally exposed application service. Qdrant and Docling will be internal-network services, not exposed on LAN interfaces by default.

Initial model downloads can be substantial and CPU-only conversion or embedding will be slower than GPU-backed processing. The application will therefore display queue progress, permit cancellation, and process conservative batches. Users may select a smaller local model profile later, but model revision changes must create a new retrieval collection rather than silently mixing embeddings.

## References

[1]: https://docling-project.github.io/docling/ "Docling documentation"
[2]: https://qdrant.tech/documentation/quickstart/ "Qdrant local quickstart"
[3]: https://sbert.net/ "Sentence Transformers documentation"
[4]: https://github.com/lfnovo/open-notebook/blob/main/docs/2-CORE-CONCEPTS/index.md "Open Notebook core concepts"
[5]: https://scrapling.readthedocs.io/en/latest/index.html "Scrapling documentation"
[6]: https://docling-project.github.io/docling/usage/api_server/ "Docling API server"
[7]: https://docling-project.github.io/docling/concepts/chunking/ "Docling chunking concepts"
