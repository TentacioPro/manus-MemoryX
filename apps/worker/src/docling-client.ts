export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type DoclingResponse = {
  status?: string;
  processing_time?: number;
  errors?: Array<{ message?: string } | string>;
  document?: { md_content?: string; json_content?: unknown };
};

function localServiceUrl(value: string, hostname: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== hostname) throw new Error(`${hostname} URL must resolve to an internal local HTTP service`);
  return url.toString().replace(/\/$/, "");
}

function assertInternalMinioUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "minio" || (url.port && url.port !== "9000")) {
    throw new Error("Docling source must resolve to the internal MinIO service");
  }
}

function messageFor(errors: DoclingResponse["errors"]) {
  return (errors ?? []).map(error => typeof error === "string" ? error : error.message ?? "Unknown conversion error").join("; ") || "No failure detail returned";
}

export function createDoclingClient(input: { url: string; fetch: FetchLike }) {
  const baseUrl = localServiceUrl(input.url, "docling");
  return {
    async convertInternalObject(sourceUrl: string) {
      assertInternalMinioUrl(sourceUrl);
      const response = await input.fetch(`${baseUrl}/v1/convert/source`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          http_sources: [{ url: sourceUrl }],
          options: { to_formats: ["md", "json"], do_ocr: true, table_mode: "accurate", image_export_mode: "placeholder" },
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Local Docling conversion failed with ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`);
      }
      const payload = await response.json() as DoclingResponse;
      if (payload.status === "failure" || !payload.document) throw new Error(`Docling reported failure: ${messageFor(payload.errors)}`);
      const markdown = payload.document.md_content;
      if (typeof markdown !== "string" || !markdown.trim()) throw new Error("Docling returned no Markdown content");
      return {
        markdown,
        structure: payload.document.json_content ?? null,
        processingSeconds: typeof payload.processing_time === "number" ? payload.processing_time : 0,
        warnings: payload.status === "partial_success" ? (payload.errors ?? []).map(error => typeof error === "string" ? error : error.message ?? "Conversion warning") : [],
      };
    },
  };
}
