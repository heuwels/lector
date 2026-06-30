# Deployment

## Quick Reference

**Container image:** `ghcr.io/3stacks/lector`
**UI port:** 3400
**API port:** 3457 — the browser calls the Hono API directly (no Next.js proxy), so this port must be published and reachable.

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
| `API_PORT` | No | Host port for the Hono API the browser calls directly (default: `3457`; must match the image's baked port) |
| `DATA_PATH` | No | Persistent data directory (default: `./data`) |
