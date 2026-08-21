# Deployment

## Quick Reference

**Container image:** `ghcr.io/heuwels/lector`
**UI port:** 3400
**API:** published on 3457. Set `API_URL` to the origin that the browser uses for the API, for example `http://<host>:3457`. The browser calls the Hono API directly. There is no Next.js proxy. The API must be reachable from the browser.

### Deploy

```bash
cd ~/lector
docker compose pull
docker compose up -d
```

### Files on server (`~/lector/`)

- `docker-compose.yml`: copy from `deploy/docker-compose.yml`
- `.env`: copy from `deploy/.env.example`

### Environment Variables

Compose injects environment variables at runtime. The image contains no secrets.

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Optional | Enables AI translation for uncommon words |
| `LECTOR_VERSION` | No | Image tag (default: `latest`) |
| `WEB_PORT` | No | Host port for the UI (default: `3400`) |
| `API_URL` | **Remote** | Browser-facing API origin, for example `http://<host>:3457`. The API is published on host port 3457. The web app calls Hono directly, so the browser must reach it. Default `http://localhost:3457` is correct only on the host. |
| `DATA_PATH` | No | Persistent data directory (default: `./data`) |

Root `docker-compose.yml` is the local path. This `deploy/docker-compose.yml` is the server path. Both pull `ghcr.io/heuwels/lector`.

For cloud mode, Anki, backups, and adoption of self-host data, see the root [README.md](../README.md).

## Cost controls

The app caches synthesized audio. Repeat requests for the same language, voice, rate, and text come from the cache. Default store: `DATA_DIR/tts-cache`.

- `TTS_CACHE=0`: disable the cache
- `TTS_CACHE_MAX_BYTES`: size cap. The cache evicts the oldest entries. Default 1 GiB.
- `TTS_CACHE_S3_BUCKET`: store audio in S3-compatible object storage. Optional companions are `TTS_CACHE_S3_REGION`, `TTS_CACHE_S3_PREFIX` (default `tts-cache/`), and `TTS_CACHE_S3_ENDPOINT`. Credentials come from the usual `AWS_*` and `S3_*` variables. Attach a bucket lifecycle rule for eviction.

When the provider supports a batch API, the word-to-domain classifier uses it at 50% of the synchronous price. Anthropic with an API key is the current batch path. LM Studio, Ollama, and OpenRouter stay on the synchronous path.

- `CLASSIFY_BATCH=0`: force the synchronous path
- `CLASSIFY_BATCH_MAX_REQUESTS`: prompts per batch. Each prompt carries `CLASSIFY_BATCH_SIZE` words. Default 40 × 30.

## Audio import and transcription

Import Audio uploads a podcast or a recording. A worker transcribes it into a timestamped transcript. The result is a reading lesson and a listen-along player. Transcription uses any OpenAI-compatible `POST /v1/audio/transcriptions` backend.

- **Local, default on a Mac.** Run [Speaches](https://speaches.ai) or `faster-whisper-server` on the host, not inside the Lector container. Default `ASR_URL` is `http://localhost:8000`. From a container use `ASR_URL=http://host.docker.internal:8000`.
- **Hosted fallback on Groq.** Set `ASR_URL=https://api.groq.com/openai` plus `ASR_API_KEY` plus `ASR_MAX_BYTES=104857600`.

`ASR_MODEL` defaults to `whisper-large-v3`. The language hint is always sent. Enable the worker with `TRANSCRIBE_WORKER=1`. Audio files live under `DATA_DIR/audio/`. They are not part of the JSON export. The transcript text is part of the export.

`ffmpeg` is optional. It supplies the duration estimate at upload time.

On billed cloud plans, two limits apply. Self-host ignores them.

- `audioTranscriptionMinutesPerMonth`: minutes reserved at upload from the probed duration. Cloud is 300 per month. Plus is 900. Free is 0.
- `maxAudioStorageBytes`: total audio on disk. Cloud is 2 GiB. Plus is 10 GiB.

Both are tunable through `LECTOR_PLAN_LIMITS`.
