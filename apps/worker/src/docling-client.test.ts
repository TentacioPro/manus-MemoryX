import { describe, expect, it } from "vitest";
import { createDoclingClient } from "./docling-client.js";

function response(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

describe("local Docling conversion client", () => {
  it("submits an internal MinIO presigned URL with structured, local conversion options", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createDoclingClient({
      url: "http://docling:5001",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return response(200, {
          status: "success",
          processing_time: 1.2,
          errors: [],
          document: { md_content: "# Source\n\nA useful local document.", json_content: { body: { children: [] } } },
        });
      },
    });

    await expect(client.convertInternalObject("http://minio:9000/knowledge-vault/attachments/a.pdf?X-Amz-Signature=local")).resolves.toEqual({
      markdown: "# Source\n\nA useful local document.",
      structure: { body: { children: [] } },
      processingSeconds: 1.2,
      warnings: [],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://docling:5001/v1/convert/source");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      http_sources: [{ url: "http://minio:9000/knowledge-vault/attachments/a.pdf?X-Amz-Signature=local" }],
      options: { to_formats: ["md", "json"], do_ocr: true, table_mode: "accurate", image_export_mode: "placeholder" },
    });
  });

  it("fails closed for direct public URLs and unsuccessful conversion responses", async () => {
    const client = createDoclingClient({ url: "http://docling:5001", fetch: async () => response(403, { detail: "blocked" }) });
    await expect(client.convertInternalObject("https://example.com/document.pdf")).rejects.toThrow("must resolve to the internal MinIO service");
    await expect(client.convertInternalObject("http://minio:9000/file.pdf")).rejects.toThrow("Local Docling conversion failed with 403");
  });

  it("rejects non-local conversion service endpoints and malformed responses", async () => {
    expect(() => createDoclingClient({ url: "https://api.example.com", fetch })).toThrow("must resolve to an internal local HTTP service");
    const client = createDoclingClient({ url: "http://docling:5001", fetch: async () => response(200, { status: "failure", errors: [{ message: "parse failed" }] }) });
    await expect(client.convertInternalObject("http://minio:9000/file.pdf")).rejects.toThrow("Docling reported failure");
  });

  it.each([
    ["PDF", "research.pdf"],
    ["EPUB", "book.epub"],
    ["HTML", "article.html"],
    ["Office document", "notes.docx"],
  ])("uses the same internal-only conversion contract for a %s attachment", async (_label, filename) => {
    const client = createDoclingClient({
      url: "http://docling:5001",
      fetch: async (_url, init) => {
        const payload = JSON.parse(String(init?.body)) as { http_sources: Array<{ url: string }> };
        expect(payload.http_sources[0].url).toContain(`/attachments/a/${filename}?signature=local`);
        return response(200, { status: "success", document: { md_content: "# Local source\n\nIndexable text." } });
      },
    });
    await expect(client.convertInternalObject(`http://minio:9000/knowledge-vault/attachments/a/${filename}?signature=local`)).resolves.toMatchObject({ markdown: "# Local source\n\nIndexable text." });
  });
});
