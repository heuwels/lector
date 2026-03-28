# Afrikaans Reader

A self-hosted language learning app for Afrikaans — LingQ-style reader, Clozemaster-style cloze practice, and AnkiConnect integration.

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

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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
docker pull ghcr.io/3stacks/afrikaans-reader:latest
```

### Docker Compose

```yaml
services:
  afrikaans-reader:
    image: ghcr.io/3stacks/afrikaans-reader:latest
    container_name: afrikaans-reader
    restart: unless-stopped
    ports:
      - "3400:3000"
    environment:
      - NODE_ENV=production
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    volumes:
      - ./data:/app/data
```

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
