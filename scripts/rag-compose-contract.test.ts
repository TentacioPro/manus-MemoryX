import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("local RAG Compose topology", () => {
  it("adds pinned Qdrant storage and a local Docling service without publishing their ports", async () => {
    const compose = await readFile(path.join(projectRoot, "docker-compose.yml"), "utf8");

    expect(compose).toContain("qdrant/qdrant:v1.19.0");
    expect(compose).toContain("qdrant_data:/qdrant/storage");
    expect(compose).toContain("quay.io/docling-project/docling-serve-cpu:latest");
    expect(compose).toContain("docling_cache:/root/.cache");
    expect(compose).toContain("DOCLING_DEVICE: cpu");
    expect(compose).toContain("DOCLING_SERVE_ENABLE_UI: \"false\"");
    expect(compose).not.toMatch(/qdrant:\n(?:.*\n)*?ports:/);
    expect(compose).not.toMatch(/docling:\n(?:.*\n)*?ports:/);
  });

  it("connects API and worker to the local-only retrieval services and declares tuning values", async () => {
    const [compose, config] = await Promise.all([
      readFile(path.join(projectRoot, "docker-compose.yml"), "utf8"),
      readFile(path.join(projectRoot, "ops", "local-config.template"), "utf8"),
    ]);

    expect(compose).toContain("QDRANT_URL: http://qdrant:6333");
    expect(compose).toContain("DOCLING_URL: http://docling:5001");
    expect(compose).toContain("EMBEDDINGS_URL: http://embeddings:80");
    expect(compose).toContain("RERANKER_URL: http://reranker:80");
    ["DOCLING_MAX_FILE_SIZE", "DOCLING_MAX_NUM_PAGES", "DOCLING_WORKERS"].forEach(key => {
      expect(config).toContain(`${key}=`);
    });
  });

  it("runs embeddings and reranking in internal local containers with separately persistent model caches", async () => {
    const [compose, config] = await Promise.all([
      readFile(path.join(projectRoot, "docker-compose.yml"), "utf8"),
      readFile(path.join(projectRoot, "ops", "local-config.template"), "utf8"),
    ]);

    expect(compose).toContain("${TEI_IMAGE:-ghcr.io/huggingface/text-embeddings-inference:cpu-1.9}");
    expect(compose).toMatch(/"--model-id",\s+"\$\{EMBEDDING_MODEL:-BAAI\/bge-m3\}"/);
    expect(compose).toMatch(/"--model-id",\s+"\$\{RERANKER_MODEL:-BAAI\/bge-reranker-v2-m3\}"/);
    expect(compose).toContain("embedding_models:/data");
    expect(compose).toContain("reranker_models:/data");
    expect(compose).not.toMatch(/embeddings:\n(?:.*\n)*?ports:/);
    expect(compose).not.toMatch(/reranker:\n(?:.*\n)*?ports:/);
    ["TEI_IMAGE", "EMBEDDING_MODEL", "RERANKER_MODEL"].forEach(key => expect(config).toContain(`${key}=`));
  });
});
