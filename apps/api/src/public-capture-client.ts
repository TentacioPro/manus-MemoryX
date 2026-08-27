export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type CapturePayload = { url?: unknown; title?: unknown; description?: unknown; text?: unknown; content_type?: unknown; status_code?: unknown; retrieved_at?: unknown };

export function createPublicCaptureClient(input: { url: string; fetch: FetchLike }) {
  const baseUrl = new URL(input.url);
  if (baseUrl.protocol !== "http:" || baseUrl.hostname !== "public-capture") throw new Error("public-capture URL must resolve to an internal local HTTP service");
  const base = baseUrl.toString().replace(/\/$/, "");
  return {
    async capture(url: string) {
      const response = await input.fetch(`${base}/capture`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Local public capture failed with ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`);
      }
      const payload = await response.json() as CapturePayload;
      if (typeof payload.url !== "string" || typeof payload.text !== "string" || typeof payload.content_type !== "string" || typeof payload.status_code !== "number" || typeof payload.retrieved_at !== "number") {
        throw new Error("Local public capture returned an invalid payload");
      }
      return {
        url: payload.url,
        title: typeof payload.title === "string" ? payload.title : null,
        description: typeof payload.description === "string" ? payload.description : null,
        text: payload.text,
        contentType: payload.content_type,
        statusCode: payload.status_code,
        retrievedAt: new Date(payload.retrieved_at * 1000).toISOString(),
      };
    },
  };
}
