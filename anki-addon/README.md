# Lector Sync — Anki addon

The dedicated Lector ↔ Anki integration ([#241](https://github.com/heuwels/lector/issues/241)).
It replaces the browser → AnkiConnect path (which hosted deployments can't
use: Chrome's Local Network Access blocks a public HTTPS page from calling
`localhost:8765`) by reversing the direction — the addon runs inside Anki
Desktop on your machine and talks **out** to the Lector API:

- **Pull**: words you queued in Lector (reader, vocab page, practice) become
  real notes on the structured **Lector** / **Lector Cloze** note types, filed
  per language (`Lector::Afrikaans`, …). Notes are upserted by their
  `LectorId` field — re-queuing a word updates its note, never duplicates it.
- **Push**: every Lector card's review state (`type` + `interval`, straight
  from Anki's scheduler) flows back and upgrades word states in Lector —
  learning → `level1`, relearning → `level2`, young → `level4`, mature →
  `known`. Upgrade-only: Lector never demotes a word because a card lapsed,
  and `ignored` words stay ignored. Cards you create yourself on the Lector
  note types are imported as new vocab. Daily review counts feed the
  activity heatmap.
- **When**: on profile open (configurable), via **Tools → Lector: Sync now**,
  and answered-card states are flushed when the profile closes.

Anki must still be open for a sync to happen, and AnkiDroid / AnkiMobile
can't run add-ons — sync on desktop and let AnkiWeb carry the results to
your devices.

## Install

1. Copy the `lector/` folder into your Anki addons directory
   (**Tools → Add-ons → View Files**, e.g.
   `~/Library/Application Support/Anki2/addons21/` on macOS), or zip the
   *contents* of `lector/` as `lector.ankiaddon` and double-click it.
   Requires Anki 2.1.50+.
2. In Lector, open **Settings → API Tokens** and mint a token with the
   **anki** scope.
3. In Anki, **Tools → Add-ons → Lector Sync → Config**: set `api_url`
   (hosted: `https://app.lector.dev`; self-hosted: your API origin, e.g.
   `http://localhost:3457`) and paste the token into `api_token`.
4. Restart Anki (or hit **Tools → Lector: Sync now**).

## Self-hosting note

Self-hosted Lector keeps the direct browser → AnkiConnect integration too —
this addon is optional there. It becomes the better choice when your Lector
is served over HTTPS, lives on another machine, or you want review states to
flow back without pressing "Sync with Anki".

## Endpoints used

| Call | Purpose |
|---|---|
| `GET /api/anki/pending` | queued cards, render-ready fields |
| `POST /api/anki/ack` | confirm created/updated notes (flips `pushedToAnki`) |
| `POST /api/anki/reviews` | structured review states + per-day counts |

All requests carry `Authorization: Bearer <token>` and are scoped to the
token's account.
