import asyncio
import ipaddress
import os
import socket
import time
from collections import defaultdict
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from scrapling.parser import Selector

app = FastAPI(title="Knowledge Vault Public Capture", docs_url=None, redoc_url=None)
USER_AGENT = "KnowledgeVaultPublicCapture/1.0"
MAX_RESPONSE_BYTES = int(os.getenv("PUBLIC_CAPTURE_MAX_RESPONSE_BYTES", "8388608"))
MAX_TEXT_CHARS = int(os.getenv("PUBLIC_CAPTURE_MAX_TEXT_CHARS", "250000"))
MIN_INTERVAL_SECONDS = float(os.getenv("PUBLIC_CAPTURE_MIN_INTERVAL_SECONDS", "2"))
last_request_by_host: dict[str, float] = defaultdict(float)
host_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


class CaptureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=12, max_length=2048)


class CaptureResponse(BaseModel):
    url: str
    title: str | None
    description: str | None
    text: str
    content_type: str
    status_code: int
    retrieved_at: float


def validate_public_target(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise HTTPException(400, "Only absolute HTTPS URLs are allowed.")
    if parsed.username or parsed.password or (parsed.port and parsed.port != 443):
        raise HTTPException(400, "Credentials and non-standard ports are not allowed.")
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise HTTPException(400, "Host could not be resolved.") from exc
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise HTTPException(400, "Private, loopback, link-local, multicast, and reserved targets are not allowed.")


async def respect_rate_limit(host: str) -> None:
    async with host_locks[host]:
        wait_seconds = MIN_INTERVAL_SECONDS - (time.monotonic() - last_request_by_host[host])
        if wait_seconds > 0:
            await asyncio.sleep(wait_seconds)
        last_request_by_host[host] = time.monotonic()


async def permits_robots(client: httpx.AsyncClient, url: str) -> bool:
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    response = await client.get(robots_url, follow_redirects=False)
    if response.status_code == 404:
        return True
    if response.status_code != 200:
        return False
    parser = RobotFileParser()
    parser.parse(response.text.splitlines())
    return parser.can_fetch(USER_AGENT, url)


def clean_text(selector: Selector) -> str:
    raw_text = selector.xpath("//body//text()").getall()
    return " ".join(item.strip() for item in raw_text if item.strip())[:MAX_TEXT_CHARS]


@app.get("/health")
async def health():
    return {"ok": True, "mode": "public-html-parser-only"}


@app.post("/capture", response_model=CaptureResponse)
async def capture(request: CaptureRequest):
    validate_public_target(request.url)
    host = urlparse(request.url).hostname
    assert host is not None
    await respect_rate_limit(host)
    timeout = httpx.Timeout(connect=10, read=20, write=10, pool=10)
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}
    async with httpx.AsyncClient(timeout=timeout, headers=headers, follow_redirects=False, trust_env=False) as client:
        try:
            if not await permits_robots(client, request.url):
                raise HTTPException(403, "Robots policy unavailable or disallows this path; use manual URL capture instead.")
            async with client.stream("GET", request.url) as response:
                if response.is_redirect:
                    raise HTTPException(409, "Redirects are not followed; capture the final public URL manually.")
                if response.status_code in {401, 403, 407, 429}:
                    raise HTTPException(409, "Remote access requires authorization or rejected the ordinary public request; use manual URL capture instead.")
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                if content_type not in {"text/html", "application/xhtml+xml"}:
                    raise HTTPException(415, "This public capture service accepts HTML only; upload documents locally instead.")
                chunks: list[bytes] = []
                size = 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise HTTPException(413, "Response exceeds the public HTML capture size limit.")
                    chunks.append(chunk)
        except HTTPException:
            raise
        except httpx.HTTPError as exc:
            raise HTTPException(409, "Ordinary anonymous public retrieval failed; use manual URL capture instead.") from exc
    html = b"".join(chunks).decode("utf-8", errors="replace")
    selector = Selector(html)
    return CaptureResponse(
        url=request.url,
        title=selector.css("title::text").get(),
        description=selector.css('meta[name="description"]::attr(content)').get(),
        text=clean_text(selector),
        content_type=content_type,
        status_code=response.status_code,
        retrieved_at=time.time(),
    )
