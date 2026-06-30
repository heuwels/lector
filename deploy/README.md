# Deployment

## Quick Reference

**Container image:** `ghcr.io/3stacks/lector`
**UI port:** 3400
**API:** published on 3457; set `API_URL` to the browser-facing origin (e.g. `http://<host>:3457`). The browser calls the Hono API directly (no Next.js proxy), so it must be reachable.

### Deploy

```bash
cd ~/lector
docker compose pull
docker compose up -d
```

### Files on server (`~/lector/`)

- `docker-compose.yml` - from `deploy/docker-compose.yml`
- `.env` - from `deploy/.env.example`

### Environment Variables

Environment variables are injected at runtime via docker-compose. No secrets are baked into the Docker image.

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Optional | Enables AI translation for uncommon words |
| `LECTOR_VERSION` | No | Image tag (default: `latest`) |
| `WEB_PORT` | No | Host port for the UI (default: `3400`) |
| `API_URL` | **Remote** | Browser-facing API origin, e.g. `http://<host>:3457` (the API is published on host `:3457`). The web app calls Hono directly, so it must be reachable from the browser. Defaults to `http://localhost:3457` — correct only when browsing from the host. |
| `DATA_PATH` | No | Persistent data directory (default: `./data`) |
