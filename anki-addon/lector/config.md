### Lector Sync configuration

- **api_url** — where your Lector lives. The hosted app is
  `https://app.lector.dev`; a self-hosted install is your API origin, e.g.
  `http://localhost:3457`.
- **api_token** — a personal API token minted in Lector under
  **Settings → API Tokens**. Give it the **anki** scope only: the token sits
  in this config file, so it should grant Anki sync and nothing else.
- **deck** — deck for new cards. `{lang}` becomes the language name, so the
  default `Lector::{lang}` files Afrikaans cards under `Lector::Afrikaans`.
- **sync_on_profile_open** — pull queued cards and push review states each
  time you open this profile (default `true`). You can always sync manually
  via **Tools → Lector: Sync now**.

Hand-made cards: create them on the **Lector** / **Lector Cloze** note types
and add the `lector` tag — the next sync imports them into your Lector vocab.
Notes without the tag (and without a LectorId) are never touched or uploaded.
