import { describe, expect, it } from "vitest";
import { evaluatePublicCaptureRequest } from "./public-capture-policy.js";

describe("guarded public capture policy", () => {
  it("allows a single ordinary HTTPS public-page request with no automation features", () => {
    expect(evaluatePublicCaptureRequest({ url: "https://arxiv.org/abs/2501.17887" })).toEqual({ allowed: true, canonicalUrl: "https://arxiv.org/abs/2501.17887" });
  });

  it("denies social-platform retrieval and leaves the existing manual URL path available", () => {
    for (const url of ["https://www.instagram.com/p/example/", "https://x.com/account/status/1", "https://www.linkedin.com/posts/example", "https://www.threads.net/@account/post/example", "https://youtube.com/watch?v=test"]) {
      expect(evaluatePublicCaptureRequest({ url })).toMatchObject({ allowed: false, reason: expect.stringMatching(/manual URL capture/i) });
    }
  });

  it("fails closed on private addresses, credentials, non-HTTP(S) protocols, and evasion-related request flags", () => {
    for (const input of [
      { url: "http://127.0.0.1/private" },
      { url: "http://192.168.1.8/document" },
      { url: "https://user:pass@example.org/file" },
      { url: "file:///etc/passwd" },
      { url: "https://example.org", options: { useCookies: true } },
      { url: "https://example.org", options: { browserAutomation: true } },
      { url: "https://example.org", options: { stealth: true } },
      { url: "https://example.org", options: { useProxy: true } },
      { url: "https://example.org", options: { followLinks: true } },
    ]) expect(evaluatePublicCaptureRequest(input)).toMatchObject({ allowed: false });
  });
});
