type CaptureOptions = { useCookies?: boolean; browserAutomation?: boolean; stealth?: boolean; useProxy?: boolean; followLinks?: boolean; captureApi?: boolean; login?: boolean };
type CaptureRequest = { url: string; options?: CaptureOptions };

const socialHosts = ["instagram.com", "x.com", "twitter.com", "linkedin.com", "threads.net", "youtube.com", "youtu.be", "facebook.com", "tiktok.com"];
const blockedOptionNames: Array<keyof CaptureOptions> = ["useCookies", "browserAutomation", "stealth", "useProxy", "followLinks", "captureApi", "login"];

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] === 0;
}

export function evaluatePublicCaptureRequest(request: CaptureRequest): { allowed: true; canonicalUrl: string } | { allowed: false; reason: string } {
  const riskyOption = blockedOptionNames.find(name => request.options?.[name]);
  if (riskyOption) return { allowed: false, reason: `Public capture forbids ${riskyOption}; use the manual URL capture flow instead.` };
  let url: URL;
  try { url = new URL(request.url); } catch { return { allowed: false, reason: "A valid absolute HTTPS URL is required." }; }
  if (url.protocol !== "https:") return { allowed: false, reason: "Public capture accepts HTTPS URLs only." };
  if (url.username || url.password) return { allowed: false, reason: "URLs containing credentials are not allowed." };
  if (url.port && url.port !== "443") return { allowed: false, reason: "Non-standard ports are not allowed for public capture." };
  if (isPrivateHost(url.hostname)) return { allowed: false, reason: "Private, loopback, link-local, and local-network targets are not allowed." };
  if (socialHosts.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return { allowed: false, reason: "Social-platform content must use an official export or manual URL capture; public fetch is intentionally disabled for this source." };
  url.hash = "";
  return { allowed: true, canonicalUrl: url.toString() };
}
