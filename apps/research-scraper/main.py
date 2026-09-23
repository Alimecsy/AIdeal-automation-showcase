from __future__ import annotations

import hashlib
import ipaddress
import json
import logging
import os
import threading
import socket
import time
import urllib.robotparser
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urljoin, urlparse

from scrapling import Fetcher

MAX_URLS = 5
MAX_CONTENT_CHARS = 12_000
CACHE_TTL_SECONDS = 300
ROBOTS_TTL_SECONDS = 600
MIN_DOMAIN_INTERVAL_SECONDS = 1.0
MAX_REDIRECTS = 3
USER_AGENT = "AIDEALResearchBot/0.1 (+research policy)"
logger = logging.getLogger("aideal-research-scraper")
cache: dict[str, tuple[float, dict[str, object]]] = {}
robots_cache: dict[str, tuple[float, urllib.robotparser.RobotFileParser | None]] = {}
domain_next_request: dict[str, float] = {}
policy_lock = threading.Lock()
fetch_slots = threading.BoundedSemaphore(2)


class RedisStore:
    def __init__(self):
        self.base_url = os.environ.get("UPSTASH_REDIS_REST_URL", "").rstrip("/")
        self.token = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")

    @property
    def enabled(self) -> bool:
        return bool(self.base_url and self.token)

    def command(self, *args: object):
        if not self.enabled:
            raise RuntimeError("Upstash Redis REST is not configured")
        request = urllib.request.Request(
            self.base_url,
            data=json.dumps(list(args)).encode("utf-8"),
            headers={"authorization": f"Bearer {self.token}", "content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                body = json.loads(response.read())
        except (OSError, urllib.error.URLError) as error:
            raise RuntimeError("Upstash Redis request failed") from error
        if body.get("error"):
            raise RuntimeError("Upstash Redis command failed")
        return body.get("result")


redis_store = RedisStore()


def reject_private_host(hostname: str | None) -> None:
    if not hostname:
        raise ValueError("URL hostname is required")
    if hostname.lower() in {"localhost", "localhost.localdomain"}:
        raise ValueError("Private host is not allowed")
    try:
        addresses = socket.getaddrinfo(hostname, None)
    except socket.gaierror as error:
        raise ValueError("URL hostname could not be resolved") from error
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError("Private network target is not allowed")


def validate_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
        raise ValueError("Only public HTTP(S) URLs are allowed")
    reject_private_host(parsed.hostname)
    return value


def canonical_url(value: str) -> str:
    parsed = urlparse(validate_url(value))
    return parsed._replace(fragment="").geturl()


def wait_for_domain(hostname: str) -> None:
    if redis_store.enabled:
        key = f"aideal:research:scraper:rate:{hostname.lower()}"
        while True:
            try:
                if redis_store.command("SET", key, str(time.time()), "NX", "EX", 2) == "OK":
                    return
            except RuntimeError:
                logger.warning("redis rate limit unavailable; using local limiter")
                break
            time.sleep(MIN_DOMAIN_INTERVAL_SECONDS)
    with policy_lock:
        now = time.monotonic()
        wait = max(0.0, domain_next_request.get(hostname, 0.0) - now)
        domain_next_request[hostname] = max(now, domain_next_request.get(hostname, 0.0)) + MIN_DOMAIN_INTERVAL_SECONDS
    if wait:
        time.sleep(wait)


def robots_allowed(url: str) -> str:
    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    now = time.monotonic()
    with policy_lock:
        entry = robots_cache.get(origin)
    if entry and entry[0] > now:
        parser = entry[1]
    else:
        parser = urllib.robotparser.RobotFileParser(urljoin(origin, "/robots.txt"))
        try:
            parser.read()
        except OSError:
            parser = None
        with policy_lock:
            robots_cache[origin] = (now + ROBOTS_TTL_SECONDS, parser)
    if parser is not None and not parser.can_fetch(USER_AGENT, url):
        raise PermissionError("Robots policy disallows this URL")
    return "robots_allowed" if parser is not None else "robots_unavailable_allowed"


def extract_source(candidate: dict[str, object]) -> dict[str, object]:
    original_url = candidate.get("url")
    if not isinstance(original_url, str):
        raise ValueError("Source URL is required")
    url = canonical_url(original_url)
    now = time.monotonic()
    cache_key = f"aideal:research:scraper:cache:{hashlib.sha256(url.encode('utf-8')).hexdigest()}"
    if redis_store.enabled:
        try:
            cached_json = redis_store.command("GET", cache_key)
            if isinstance(cached_json, str):
                source = json.loads(cached_json)
                source["cacheHit"] = True
                source["cacheBackend"] = "upstash"
                return source
        except (RuntimeError, json.JSONDecodeError, TypeError):
            logger.warning("redis cache unavailable; using local cache")
    cached = cache.get(url)
    if cached and cached[0] > now:
        source = dict(cached[1])
        source["cacheHit"] = True
        source["cacheBackend"] = "process"
        return source

    policy = robots_allowed(url)
    parsed = urlparse(url)
    wait_for_domain(parsed.hostname or "")
    with fetch_slots:
        page = Fetcher.get(
            url,
            headers={"user-agent": USER_AGENT},
            timeout=15,
            follow_redirects=True,
            max_redirects=MAX_REDIRECTS,
        )
    final_url = canonical_url(str(getattr(page, "url", url)))
    final_policy = robots_allowed(final_url)
    body = page.css("body").first
    content = body.get_all_text() if body else ""
    content = " ".join(content.split())[:MAX_CONTENT_CHARS]
    title_node = page.css("title").first
    title = title_node.text.strip() if title_node else str(candidate.get("title") or url)
    source = {
        "title": title,
        "url": final_url,
        "originalUrl": url,
        "snippet": content,
        "contentHash": hashlib.sha256(content.encode("utf-8")).hexdigest(),
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "statusCode": getattr(page, "status", None),
        "extractionMethod": "scrapling.static",
        "policy": f"{policy}+{final_policy}",
        "cacheHit": False,
        "cacheBackend": "upstash" if redis_store.enabled else "process",
    }
    cache[url] = (now + CACHE_TTL_SECONDS, source)
    if redis_store.enabled:
        try:
            redis_store.command("SET", cache_key, json.dumps(source), "EX", CACHE_TTL_SECONDS)
        except RuntimeError:
            logger.warning("redis cache write unavailable; retaining process cache")
    return source


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._json(200, {"ok": True, "service": "aideal-research-scraper"})
            return
        self._json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/extract":
            self._json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length))
            candidates = payload.get("sources") if isinstance(payload, dict) else None
            if not isinstance(candidates, list) or not candidates or len(candidates) > MAX_URLS:
                raise ValueError(f"sources must contain 1 to {MAX_URLS} items")
            sources: list[dict[str, object]] = []
            skipped: list[dict[str, object]] = []
            for candidate in candidates:
                if not isinstance(candidate, dict):
                    continue
                try:
                    sources.append(extract_source(candidate))
                except PermissionError as error:
                    skipped.append({
                        "title": candidate.get("title", "Source"),
                        "url": candidate.get("url", ""),
                        "reason": "policy_disallowed",
                        "detail": str(error),
                    })
                except Exception as error:  # noqa: BLE001
                    logger.warning("skipping source %s: %s", candidate.get("url", ""), error)
                    skipped.append({
                        "title": candidate.get("title", "Source"),
                        "url": candidate.get("url", ""),
                        "reason": "extraction_failed",
                    })
            self._json(200, {"sources": sources, "skipped": skipped})
        except Exception as error:  # noqa: BLE001
            logger.exception("source extraction failed")
            self._json(400, {"error": str(error)})

    def log_message(self, format: str, *args: object) -> None:
        logger.info(format, *args)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    server = ThreadingHTTPServer(("127.0.0.1", 8766), Handler)
    logger.info("research scraper listening on http://127.0.0.1:8766")
    server.serve_forever()


if __name__ == "__main__":
    main()
