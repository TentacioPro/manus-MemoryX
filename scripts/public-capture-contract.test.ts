import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("guarded public capture service contract", () => {
  it("uses Scrapling only as an HTML parser and declares no browser, session, proxy, stealth, or API-capture capability", async () => {
    const app = await readFile(path.join(root, "apps", "public-capture", "app.py"), "utf8");
    expect(app).toContain("from scrapling.parser import Selector");
    ["scrapling.fetchers", "StealthyFetcher", "DynamicFetcher", "FetcherSession", "proxy", "capture_xhr", "playwright", "selenium", "cookies"].forEach(forbidden => expect(app.toLowerCase()).not.toContain(forbidden.toLowerCase()));
  });

  it("enforces HTTPS, global DNS resolution, robots, per-host delays, response bounds, and no redirect following", async () => {
    const [app, compose] = await Promise.all([
      readFile(path.join(root, "apps", "public-capture", "app.py"), "utf8"),
      readFile(path.join(root, "docker-compose.yml"), "utf8"),
    ]);
    ["ipaddress.ip_address(address).is_global", "permits_robots", "MIN_INTERVAL_SECONDS", "MAX_RESPONSE_BYTES", "follow_redirects=False", "Remote access requires authorization"].forEach(required => expect(app).toContain(required));
    expect(compose).toContain("PUBLIC_CAPTURE_URL: http://public-capture:8080");
    expect(compose).not.toMatch(/public-capture:\n(?:.*\n)*?ports:/);
  });
});
