# Lector

A self-hosted language reader. Import the text that you want to read. Tap a word for a translation. Save it. Practise it. Send it to Anki.

[Try the hosted app](https://app.lector.dev) · [Docs](https://lector.dev) · [Discord](https://discord.gg/XBEnx2ZWd5)

[![License](https://img.shields.io/badge/license-AGPL%20v3-blue?style=flat-square)](LICENSE)
[![Self-hosted](https://img.shields.io/badge/self--hosted-yes-orange?style=flat-square)](https://lector.dev)
[![Release](https://img.shields.io/github/v/release/heuwels/lector?style=flat-square)](https://github.com/heuwels/lector/releases)

![The Lector reader with colour-coded word states](https://lector.dev/images/reader.png)

One Docker Compose file starts the app.

A local dictionary covers common words with no API key.

Optional local models run through the bundled Ollama service.

Optional cloud models cover rare words and the tutor.

## Quick start

You need Docker and Docker Compose.

```bash
git clone https://github.com/heuwels/lector.git
cd lector
docker compose up -d
```

Open [http://localhost:3400](http://localhost:3400).

The UI listens on port 3400. The API listens on port 3457. The browser calls the API directly, so both ports must be reachable.

If the browser is not on the server, set `API_URL` to the origin that the browser uses for the API. Example: `http://192.168.1.10:3457`.

```bash
# optional: cloud translation for rare words
export ANTHROPIC_API_KEY=sk-ant-...
docker compose up -d
```

The image is `ghcr.io/heuwels/lector:latest`. A production Compose file with health checks lives in [`deploy/`](deploy/). Full environment notes live in [`deploy/README.md`](deploy/README.md).

If you do not want to run a server, use the hosted app at [app.lector.dev](https://app.lector.dev). Paid plans start at $5 per month.

## Features

- **Reader.** Import a file or a stream. Each word has a state: new, learning, or known. Tap a word for a translation. The reader accepts:

  - an EPUB file
  - a Markdown file
  - a web article
  - pasted text
  - a YouTube transcript
  - a podcast

- **Cloze practice.** Frequency-ordered sentences. Choose an answer from a list, or type the missing word. Spaced repetition (SRS) with mastery levels.
- **Vocabulary.** Save words as you read. Track known and learning states. Save phrases as well as single words.
- **Anki.** The self-host can push cards to AnkiConnect on the computer that runs Anki. Cloud mode and a remote HTTPS self-host use the [Lector Sync add-on](https://ankiweb.net/shared/info/1098736891) on AnkiWeb. The add-on code is `1098736891`. Reviews in Anki can update mastery in Lector.
- **Tutor and journal.** Ask grammar questions in plain language. Write in the target language. The tutor returns corrections. Use the Claude API or a local model.
- **Listen.** Optional text-to-speech (TTS). YouTube captions stay timestamped. A podcast upload can become a transcript and a listen-along lesson.
- **Data.** SQLite on your server. Export and restore from Settings. The self-host does not need a cloud account.

## Languages

Language packs ship for:

- Afrikaans
- Czech
- Dutch
- Esperanto
- French
- German
- Italian
- Koine Greek
- Mandarin Chinese
- Polish
- Portuguese
- Russian
- Spanish
- Turkish
- Ukrainian

A pack includes a dictionary, frequency data, and cloze sentences. The reader still works for a language with no pack. Depth is lower without a pack.

Afrikaans was the first pack. It remains the most complete reference set. It is not the product. The product is the reader for any language that you study.

See [lector.dev/docs/languages](https://lector.dev/docs/languages/) for pack status.

## Anki

Two transports exist. Open Settings, then Anki Integration, then Connection.

**AnkiConnect for a local self-host.** The browser talks to AnkiConnect on `localhost:8765`. Install the [AnkiConnect add-on](https://ankiweb.net/shared/info/2055492159). Allow your app origin:

```json
{
  "webCorsOriginList": ["http://localhost:3400", "http://localhost:3456"]
}
```

**Lector Sync add-on for cloud mode or a remote HTTPS self-host.** A page on HTTPS cannot call `localhost` on the computer that runs Anki. The add-on runs inside Anki Desktop. It pulls queued cards onto `Lector` note types. It writes review states back to Lector. Point `api_url` at your Lector origin.

## Configuration

If you want a file, copy `.env.example` to `.env`. Compose also reads the process environment.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Cloud translation and tutor. Optional. The local dictionary covers common words. |
| `API_URL` | Browser-facing API origin. Required when the browser is not on the server. |
| `LECTOR_MODE` | `selfhost` (default, one user, no login) or `cloud` (accounts). |
| `LLM_PROVIDER` | `anthropic` (default) or an OpenAI-compatible backend. |
| `OPENAI_COMPAT_URL` | Local model endpoint. The bundled Ollama service is `http://ollama:11434`. |
| `CLASSIFY_WORKER` | Set to `1` to fill the fluency radar. Compose sets this for you. |
| `TRANSCRIBE_WORKER` | Set to `1` to transcribe podcast uploads. Needs a Whisper endpoint. See [`deploy/README.md`](deploy/README.md). |

The app runs with no API keys. Claude is only required for rare words, phrase translation, and the tutor.

The app caches TTS audio under `DATA_DIR/tts-cache`. Classification can use a provider batch API at half the synchronous price. Details live in [`deploy/README.md`](deploy/README.md).

### Cloud mode

`LECTOR_MODE=cloud` enables accounts. The self-host stays free. Cloud mode is also the multi-user option on your server.

Required:

- `BETTER_AUTH_SECRET`: generate with `openssl rand -base64 32`. Cloud mode does not start without it.
- `BETTER_AUTH_URL`: public origin for auth links, for example `https://app.example.com`.

Optional:

- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`: Sign in with GitHub.
- To sign in with an identity provider, set the OpenID Connect (OIDC) values `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`.
- `RESEND_API_KEY`: verification mail. Without it, mail lands in the server log.
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`: bot protection on sign-up.

**CAUTION:** Do not change `LECTOR_MODE` before you read [Move self-host data to an account](#move-self-host-data-to-an-account). If you switch an existing self-host database to cloud mode, the old library stays in the database. The new account does not see it until you move it.

`LECTOR_CLOUD_GATE=external` sends login to a gateway such as Cloudflare Access. The AWS path lives in [`deploy/cloud/`](deploy/cloud/).

### Move self-host data to an account

In self-host mode every row belongs to the implicit `local` user. Cloud mode shows only rows that the signed-in account owns. An empty library after the switch is not data loss.

`adopt-local-data` moves every row from `local` to one fresh account. If the target account already owns rows, the script refuses. The default run does not write data.

1. Stop the app.
2. Copy `DATA_DIR` to a backup. Include `lector.db`. See [Backups](#backups).
3. Set `LECTOR_MODE=cloud`.
4. Set the auth variables.
5. Start the app.
6. Create the target account in the browser.
7. Check the mail link.
8. List accounts:

   ```bash
   docker compose exec lector sh -c \
     'cd /app/api && DATA_DIR=/app/data bun run src/scripts/adopt-local-data.ts --list'
   ```

9. Run the move with no write. The command prints per-table counts:

   ```bash
   docker compose exec lector sh -c \
     'cd /app/api && DATA_DIR=/app/data bun run src/scripts/adopt-local-data.ts --to you@example.com'
   ```

10. Run the same command with `--commit` to apply it.
11. Sign in.
12. Confirm the library, the vocabulary, and the stats.
13. Keep the backup.

To roll back:

1. Stop the app.
2. Restore `DATA_DIR`.
3. Unset `LECTOR_MODE`.

## Backups

- **In-app export.** Open Settings, then Learning data, then Export all learning data. This is a JSON export of the library, vocabulary, SRS state, journal, and stats. Restore it with the matching import.
- **Volume copy.** If the app is stopped, copy `DATA_DIR`. If the app still runs, create a SQLite checkpoint first:

  ```bash
  sqlite3 "$DATA_DIR/lector.db" "PRAGMA wal_checkpoint(TRUNCATE)" && cp -a "$DATA_DIR" /path/to/backups/
  ```

The hosted app streams writes to object storage with Litestream. See [`deploy/cloud/`](deploy/cloud/).

## Development

To run from source, read [CONTRIBUTING.md](CONTRIBUTING.md). That file also holds the folder styleguide and the OpenAPI rules.

```bash
npm install
npm run dev:api   # Hono API on :3457
npm run dev       # Next.js UI on :3456
```

Open [http://localhost:3456](http://localhost:3456).

## Data attribution

- **Sentence banks.** [Tatoeba](https://tatoeba.org), [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/).
- **Dictionaries and frequency lists.** Wiktionary extracts through [kaikki.org](https://kaikki.org), Wikipedia dumps, and OpenSubtitles, plus pack-specific sources listed on [lector.dev](https://lector.dev/reference-data/).

## License

Copyright © 2026 Luke Boyle.

Licensed under the **GNU Affero General Public License v3.0** (AGPLv3). See [LICENSE](LICENSE). You may use, self-host, study, modify, and redistribute Lector. If you run a modified version as a network service, you must offer the matching source to its users. See AGPL section 13.
