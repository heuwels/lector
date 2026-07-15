# Lector

A self-hosted and cloud language learning reader — LingQ-style reading, Clozemaster-style cloze practice, and a first party Anki integration.

## Features

- **EPUB/Markdown reader** with click-to-translate (Claude API), word state tracking, and Literata serif typography
- **Cloze practice** with 2900+ pre-loaded sentences from Tatoeba, ordered by word frequency
  - Multiple choice and typing modes
  - SRS scheduling with mastery levels
  - Sound effects, streak tracking, hard mode
- **Vocabulary mining** — save words from reading, track known/learning states
- **AnkiConnect** — push cards directly to your local Anki (browser-to-localhost, no proxy)
- **Web/paste import** — extract articles via Readability, paste text directly
- **YouTube transcript import** — turn a video's captions into a lesson with clickable, seekable timestamps; the video is never downloaded or hosted, and mined cards carry a timestamped source link into Anki
- **SQLite storage** — all data local, no cloud dependency

## Getting Started

### Prerequisites

- Node.js 22+ (see `.nvmrc`)
- npm

### Styleguide

#### Folder structure

Where appropriate, files should be broken into a folder with categorised files. e.g. components/TranslationDrawer.tsx should become

```
components/TranslationDrawer
    -> index.tsx
    -> utils.ts
    -> types.ts
    -> tests.ts
    -> components/
        -> Gloss/index.tsx
```

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

# Background word→domain classifier feeding the Stats fluency radar. The code
# default is OFF (keeps tests LLM-free), so opt in wherever the radar should
# populate; the shipped compose files set it for you.
CLASSIFY_WORKER=1
```

The app works without API keys — the local dictionary covers the top 2000 words. Claude API is only needed for uncommon words and phrase translation.

#### Cost controls ([#226](https://github.com/heuwels/lector/issues/226))

Synthesized audio is **cached** and repeat requests for the same (language, voice, rate, text) are served from the cache instead of re-billed — this also covers your own Google bill when self-hosting. On by default, storing under `DATA_DIR/tts-cache`:

- `TTS_CACHE=0` — disable caching entirely
- `TTS_CACHE_MAX_BYTES` — disk-cache size cap, least-recently-used entries evicted (default 1 GiB)
- `TTS_CACHE_S3_BUCKET` — store audio in S3-compatible object storage instead of disk (for cloud/multi-instance). Optional companions: `TTS_CACHE_S3_REGION`, `TTS_CACHE_S3_PREFIX` (default `tts-cache/`), `TTS_CACHE_S3_ENDPOINT` (R2/MinIO), with credentials from the standard `AWS_*`/`S3_*` env vars. No eviction is done in S3 — attach a bucket lifecycle rule instead.

The word→domain classifier runs through the provider's **Batch API at 50% of synchronous pricing** whenever the classification provider supports it (currently: Anthropic with API-key auth — the default setup). Providers without a batch endpoint (LM Studio, Ollama, OpenRouter) keep the synchronous path automatically. Batches turn around in minutes, so a fresh install's radar fills slightly slower in exchange for half-price classification:

- `CLASSIFY_BATCH=0` — force the synchronous path even when batching is available
- `CLASSIFY_BATCH_MAX_REQUESTS` — prompts per submitted batch, each carrying `CLASSIFY_BATCH_SIZE` words (default 40 × 30 = up to 1,200 words per batch)

#### Deployment mode

`LECTOR_MODE` selects the deployment shape: `selfhost` (the default — leave it unset, this is the app as it has always been: single user, no login) or `cloud` — real accounts and per-user data, powered by built-in [Better Auth](https://better-auth.com) sessions ([#218](https://github.com/heuwels/lector/issues/218)). The two modes share one codebase and one image ([#242](https://github.com/heuwels/lector/issues/242)); self-hosting stays free and BYO-everything. Cloud mode is also the **multi-user opt-in for self-hosters** — run it on your own box to give each household member their own library.

> **Switching an existing selfhost box to cloud mode?** Nothing is deleted, but your existing library becomes invisible to the account you sign up with until you explicitly adopt it — read [Adopting existing selfhost data](#adopting-existing-selfhost-data) _before_ you flip the switch.

Cloud mode env:

- `BETTER_AUTH_SECRET` (**required** — cloud refuses to boot without it; generate with `openssl rand -base64 32`)
- `BETTER_AUTH_URL` — the public origin auth links are minted against (e.g. `https://app.example.com`)
- `LECTOR_TRUSTED_ORIGINS` — comma-separated browser origins allowed to send credentialed cross-origin requests (only needed when the UI is served from a different origin than the API)
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — optional; enables "Sign in with GitHub"
- `OIDC_ISSUER` + `OIDC_CLIENT_ID` + `OIDC_CLIENT_SECRET` — optional (all three); **BYO OIDC**: "Continue with …" against any OpenID Connect provider — Authentik, Keycloak, Auth0, Entra, Pocket ID, … `OIDC_ISSUER` is the issuer origin (or a pasted discovery URL); allowlist `<origin>/api/auth/oauth2/callback/oidc` as the redirect URI on the IdP. Optional extras: `OIDC_PROVIDER_NAME` labels the login button (default "SSO"); `OIDC_SCOPES` overrides the requested scopes (default `openid profile email`). Made for multi-user self-hosting behind your own IdP as much as for cloud.
- `RESEND_API_KEY` (+ optional `EMAIL_FROM`) — verification and password-reset email delivery; without it, emails land in the server log (fine for trying it out on your own box)
- `EMAIL_FILE` — append outbound emails as JSON lines to this file instead of sending (a local outbox; the e2e suites read verification links from it — takes precedence over Resend)
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` — optional; puts [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) bot protection on sign-up, sign-in, and password-reset (set both or neither)

Signed-in cloud users can mint **personal API tokens** in Settings — the same scoped `Bearer` tokens self-host has, tenanted per account, for CLI/script access without a browser session ([#218](https://github.com/heuwels/lector/issues/218)).

The **cloud canary** exception is unchanged: `LECTOR_CLOUD_GATE=external` declares that an authenticating gateway (e.g. Cloudflare Access) fronts every request, letting cloud mode boot with app-level auth delegated to the gate (built-in accounts are not mounted). The full canary deployment (AWS CDK + Cloudflare Tunnel) lives in [`deploy/cloud/`](deploy/cloud/).

#### Adopting existing selfhost data ([#327](https://github.com/heuwels/lector/issues/327))

In selfhost mode every row belongs to the implicit `local` user. Switching the same database to `LECTOR_MODE=cloud` deletes nothing, but accounts only see rows they own — so the library, vocabulary, and stats you built up in selfhost are invisible to the account you sign up with until you adopt them. An empty library right after the switch is **not** data loss; don't start re-importing backups into the new account — adopt instead.

`adopt-local-data` reassigns everything owned by `local` to one account. It only adopts into a **fresh** account (one that owns no rows yet) and refuses otherwise, so it can never merge two users; it moves every tenant table in a single transaction; and it's idempotent — once adopted there is no `local` data left to move. Adoption merges nothing and rewrites only row ownership. The default run is a dry run: nothing is written until you pass `--commit`.

The procedure:

1. **Back up first**, with the app stopped: copy `DATA_DIR` (at minimum `lector.db`) somewhere safe — see [Backups](#backups). Keep the backup until well after you're satisfied.
2. Enable cloud mode (`LECTOR_MODE=cloud` plus the env above) and start the app.
3. Create the target account — sign up and verify it once in the browser.
4. Confirm the target account is registered:

   ```bash
   # source checkout
   cd api && bun run adopt-local-data -- --list

   # Docker (service name `lector` in deploy/docker-compose.yml)
   docker compose exec lector sh -c \
     'cd /app/api && DATA_DIR=/app/data bun run src/scripts/adopt-local-data.ts --list'
   ```

5. Dry-run the adoption (the default — no writes) and check the per-table counts it prints against what you expect your library to contain:

   ```bash
   # source checkout
   cd api && bun run adopt-local-data -- --to you@example.com

   # Docker
   docker compose exec lector sh -c \
     'cd /app/api && DATA_DIR=/app/data bun run src/scripts/adopt-local-data.ts --to you@example.com'
   ```

   (`--to-id <userId>` targets an account by raw id instead of email; `--help` shows everything.)

6. Re-run the same command with `--commit` appended to apply the reassignment.
7. Sign in and verify the library, vocabulary, and stats — then keep the backup anyway.

**Rollback:** stop the app, restore the backed-up `DATA_DIR`, and unset `LECTOR_MODE` — adoption only rewrites row ownership, so the pre-switch backup returns you exactly to selfhost state. (Or stay in cloud mode and redo the adoption against a fresh account.)

### Anki

Two integrations, by deployment shape ([#241](https://github.com/heuwels/lector/issues/241)):

**Self-host — AnkiConnect (browser-direct).** The app connects directly to AnkiConnect on `localhost:8765` from your browser. Install the [AnkiConnect add-on](https://ankiweb.net/shared/info/2055492159) in Anki Desktop, and in its config ensure your app origin is allowed:

```json
{
  "webCorsOriginList": ["http://localhost:3000"]
}
```

**The Lector Sync add-on (cloud, and any HTTPS/remote self-host).** A hosted HTTPS page can't call your machine's `localhost:8765` (Chrome's Local Network Access blocks it), so the alternative transport is [`anki-addon/`](anki-addon/): it runs inside Anki Desktop, pulls the cards you queue in Lector onto structured `Lector` note types (upserted by `LectorId` — no duplicates), and pushes your review states back so word states upgrade automatically. Point its `api_url` at whichever Lector you use — the hosted app or your own origin. Cloud always uses this transport; self-hosters switch to it under **Settings → Anki Integration → Connection** (setup instructions appear there).

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
      - '3400:3000' # UI
      - '3457:3457' # Hono API — the browser calls it directly, so it must be reachable
    environment:
      - NODE_ENV=production
      - API_URL=http://localhost:3457 # browser-facing API origin — set to http://<host>:3457 for remote access
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - CLASSIFY_WORKER=1 # word→domain classifier behind the fluency radar (off by default in code)
    volumes:
      - ./data:/app/data
```

Both ports must be published: the browser loads the UI from `:3400` and calls the Hono API **directly** on `:3457` (there is no Next.js API proxy). Set `API_URL` to the origin the browser uses to reach the API (e.g. `http://<host>:3457`) — it's injected into the page at container start (`/__env.js`). It defaults to `http://localhost:3457`, which only works when you browse from the same host.

Environment variables are injected at runtime — no secrets are baked into the Docker image.

See `deploy/` for a full docker-compose setup with health checks.

### Backups

Two supported paths ([#294](https://github.com/heuwels/lector/issues/294)):

- **In-app export** — Settings → Learning data → "Export all learning data" (`GET /api/data`): a portable JSON takeout of your library, vocabulary, SRS state, journal and stats that restores into any Lector instance via `POST /api/data`.
- **Volume-level** — copy `DATA_DIR`. With the app stopped, a plain copy is safe. Against a running app, checkpoint the SQLite WAL first so the copy isn't torn mid-write:

  ```bash
  sqlite3 "$DATA_DIR/lector.db" "PRAGMA wal_checkpoint(TRUNCATE)" && cp -a "$DATA_DIR" /path/to/backups/
  ```

The cloud deployment doesn't use either of these for durability — it streams every write to S3 via Litestream (see [`deploy/cloud/`](deploy/cloud/), [#270](https://github.com/heuwels/lector/issues/270)).

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
