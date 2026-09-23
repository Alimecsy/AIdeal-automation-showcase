# AIDEAL Research Scraper

Small Scrapling-backed extraction service for the AIDEAL research worker.

Run locally with the shared Scrapling environment:

```bash
python -m venv .venv && .venv/bin/pip install -r apps/research-scraper/requirements.txt
.venv/bin/python apps/research-scraper/main.py
```

Endpoints:

- `GET /health`
- `POST /extract` with `{ "sources": [{ "title": "...", "url": "https://..." }] }`

The service allows public HTTP(S) targets, rejects credentials and private-network destinations, checks robots policy, limits global concurrency and per-domain request frequency, caches successful extractions for five minutes, validates final redirect targets, bounds the candidate count/content size, and returns provenance metadata. When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are present, rate limits and cache entries are shared across scraper instances. Without Redis, the service uses process-local fallback behavior and marks the backend in its response metadata.
