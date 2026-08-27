import { describe, expect, it } from "vitest";
import { createPublicCaptureClient } from "./public-capture-client.js";

function response(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

describe("local public-capture client", () => {
  it("submits only a URL to the internal parser service and normalizes its review-stage capture record", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createPublicCaptureClient({
      url: "http://public-capture:8080",
      fetch: async (url, init) => { calls.push({ url: String(url), init }); return response(200, { url: "https://arxiv.org/abs/2501.17887", title: "Paper", description: "Research", text: "A locally captured public page.", content_type: "text/html", status_code: 200, retrieved_at: 1787847000.25 }); },
    });
    await expect(client.capture("https://arxiv.org/abs/2501.17887")).resolves.toEqual({
      url: "https://arxiv.org/abs/2501.17887", title: "Paper", description: "Research", text: "A locally captured public page.", contentType: "text/html", statusCode: 200, retrievedAt: "2026-08-27T16:10:00.250Z",
    });
    expect(calls).toEqual([{ url: "http://public-capture:8080/capture", init: expect.objectContaining({ method: "POST", body: JSON.stringify({ url: "https://arxiv.org/abs/2501.17887" }) }) }]);
  });

  it("rejects external capture-service endpoints and remote capture errors", async () => {
    expect(() => createPublicCaptureClient({ url: "https://capture.example.com", fetch })).toThrow("must resolve to an internal local HTTP service");
    const client = createPublicCaptureClient({ url: "http://public-capture:8080", fetch: async () => response(409, { detail: "blocked" }) });
    await expect(client.capture("https://example.org")).rejects.toThrow("Local public capture failed with 409");
  });
});
