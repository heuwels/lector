# Deployment

## Quick Reference

**Container image:** `ghcr.io/3stacks/afrikaans-reader`
**Default port:** 3400

### Deploy

```bash
cd ~/afrikaans-reader
docker compose pull
docker compose up -d
```

### Files on server (`~/afrikaans-reader/`)

- `docker-compose.yml` - from `deploy/docker-compose.yml`
- `.env` - from `deploy/.env.example`

### Environment Variables

Environment variables are injected at runtime via docker-compose. No secrets are baked into the Docker image.

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Optional | Enables AI translation for uncommon words |
| `AFRIKAANS_READER_VERSION` | No | Image tag (default: `latest`) |
| `WEB_PORT` | No | Host port (default: `3400`) |
| `DATA_PATH` | No | Persistent data directory (default: `./data`) |
