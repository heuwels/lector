# Lector

A self-hosted language learning reader — LingQ-style reading, Clozemaster-style cloze practice, and AnkiConnect integration.

## Features

- **EPUB/Markdown reader** with click-to-translate (Claude API), word state tracking, and Literata serif typography
- **Cloze practice** with 2900+ pre-loaded sentences from Tatoeba, ordered by word frequency
  - Multiple choice and typing modes
  - SRS scheduling with mastery levels
  - Sound effects, streak tracking, hard mode
- **Vocabulary mining** — save words from reading, track known/learning states
- **AnkiConnect** — push cards directly to your local Anki (browser-to-localhost, no proxy)
- **Web/paste import** — extract articles via Readability, paste text directly
- **SQLite storage** — all data local, no cloud dependency

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Development

The app runs as two processes — the Next.js front-end (`:3456`) and the Hono API (`:3457`). Start each in its own terminal:

```bash
npm install
npm run dev:api   # terminal 1 — Hono API on :3457
npm run dev       # terminal 2 — Next.js UI on :3456
```

Open [http://localhost:3456](http://localhost:3456). The browser calls the Hono API **directly** on `:3457` (CORS-enabled) — there is no Next.js API proxy.

### Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
# Required for AI translation (word lookups fall back to local dictionary)
ANTHROPIC_API_KEY=sk-ant-...

# Optional: Google Cloud API key (for TTS)
GOOGLE_CLOUD_API_KEY=...
```

The app works without API keys — the local dictionary covers the top 2000 words. Claude API is only needed for uncommon words and phrase translation.

### AnkiConnect

The app connects directly to AnkiConnect on `localhost:8765` from your browser. Install the [AnkiConnect add-on](https://ankiweb.net/shared/info/2055492159) in Anki Desktop.

In AnkiConnect's config, ensure your app origin is allowed:
```json
{
  "webCorsOriginList": ["http://localhost:3000"]
}
```

## Docker Deployment

The image is published to GHCR on every push to master.

```bash
docker pull ghcr.io/3stacks/lector:latest
```

### Docker Compose

```yaml
services:
  lector:
    image: ghcr.io/3stacks/lector:latest
    container_name: lector
    restart: unless-stopped
    ports:
      - "3400:3000"   # UI
      - "3457:3457"   # Hono API — the browser calls it directly, so it must be reachable
    environment:
      - NODE_ENV=production
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    volumes:
      - ./data:/app/data
```

Both ports must be published: the browser loads the UI from `:3400` and calls the Hono API **directly** on `:3457` (there is no Next.js API proxy). Keep the API on host port `3457` unless you rebuild the image with `NEXT_PUBLIC_API_PORT` set to match — the client's API port is baked in at build time.

Environment variables are injected at runtime — no secrets are baked into the Docker image.

See `deploy/` for a full docker-compose setup with health checks.

## Sentence Bank

The cloze practice system ships with ~2900 Afrikaans-English sentence pairs pre-loaded. To regenerate from Tatoeba's latest data dumps:

```bash
npm run fetch-sentences
```

This downloads Tatoeba's per-language TSV exports, joins Afrikaans sentences with English translations, and tags each with word frequency data.

## Data Attribution

- **Sentence bank**: Sourced from [Tatoeba](https://tatoeba.org), licensed under [CC-BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/). Tatoeba is a collaborative project of freely-licensed sentence translations.
- **Word frequency dictionary**: The top 2000 Afrikaans words with English translations, compiled from publicly available frequency lists.

## License

MIT License. See [LICENSE](LICENSE).
