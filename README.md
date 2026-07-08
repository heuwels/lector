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

- Node.js 22+ (see `.nvmrc`)
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

#### Deployment mode

`LECTOR_MODE` selects the deployment shape: `selfhost` (the default — leave it unset, this is the app as it has always been: single user, no login) or `cloud` — real accounts and per-user data, powered by built-in [Better Auth](https://better-auth.com) sessions ([#218](https://github.com/heuwels/lector/issues/218)). The two modes share one codebase and one image ([#242](https://github.com/heuwels/lector/issues/242)); self-hosting stays free and BYO-everything. Cloud mode is also the **multi-user opt-in for self-hosters** — run it on your own box to give each household member their own library.

Cloud mode env:

- `BETTER_AUTH_SECRET` (**required** — cloud refuses to boot without it; generate with `openssl rand -base64 32`)
- `BETTER_AUTH_URL` — the public origin auth links are minted against (e.g. `https://app.example.com`)
- `LECTOR_TRUSTED_ORIGINS` — comma-separated browser origins allowed to send credentialed cross-origin requests (only needed when the UI is served from a different origin than the API)
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — optional; enables "Sign in with GitHub"
- `RESEND_API_KEY` (+ optional `EMAIL_FROM`) — verification and password-reset email delivery; without it, emails land in the server log (fine for trying it out on your own box)
- `EMAIL_FILE` — append outbound emails as JSON lines to this file instead of sending (a local outbox; the e2e suites read verification links from it — takes precedence over Resend)
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` — optional; puts [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) bot protection on sign-up, sign-in, and password-reset (set both or neither)

Signed-in cloud users can mint **personal API tokens** in Settings — the same scoped `Bearer` tokens self-host has, tenanted per account, for CLI/script access without a browser session ([#218](https://github.com/heuwels/lector/issues/218)).

The **cloud canary** exception is unchanged: `LECTOR_CLOUD_GATE=external` declares that an authenticating gateway (e.g. Cloudflare Access) fronts every request, letting cloud mode boot with app-level auth delegated to the gate (built-in accounts are not mounted). The full canary deployment (AWS CDK + Cloudflare Tunnel) lives in [`deploy/cloud/`](deploy/cloud/).

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
      - API_URL=http://localhost:3457   # browser-facing API origin — set to http://<host>:3457 for remote access
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    volumes:
      - ./data:/app/data
```

Both ports must be published: the browser loads the UI from `:3400` and calls the Hono API **directly** on `:3457` (there is no Next.js API proxy). Set `API_URL` to the origin the browser uses to reach the API (e.g. `http://<host>:3457`) — it's injected into the page at container start (`/__env.js`). It defaults to `http://localhost:3457`, which only works when you browse from the same host.

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

Copyright © 2026 Luke Boyle.

Licensed under the **GNU Affero General Public License v3.0** (AGPLv3) — see [LICENSE](LICENSE). You're free to use, self-host, study, modify, and redistribute Lector. Under the AGPL's network-use clause (§13), anyone who runs a modified version as a network service must make the corresponding source available to its users.
