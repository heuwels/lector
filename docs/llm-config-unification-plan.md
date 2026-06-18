# LLM Config Unification Plan

**Goal:** Collapse the three HTTP-based local/self-hosted providers — **Ollama**, **Apfel**, and **LM Studio** — into a single **OpenAI-compatible** provider configured by just three things: **HTTP endpoint**, **optional API key**, and **model name** (fetched from the server when possible, free-text otherwise). **Anthropic stays exactly as-is** (it has OAuth, the Agent SDK path, and per-task models — none of which fit the OpenAI shape).

This is a *simplification*, not a rename. The win is deleting code paths, settings keys, env vars, UI branches, and tests — not relabelling them.

---

## Implementation status — built & verified (2026-06-18)

Implemented on a clean clone at `~/personal/Sites/lector-llm-config`, branch `feat/unify-llm-config`, cut from released `master` (PR #155 merged) and fully isolated from the concurrent `feat/domain-fluency` work in `~/personal/Sites/lector`.

**Verified locally:**
- `cd api && bun test` → **52/52 pass** (incl. the merged `openai-compatible.test.ts`, the trimmed `chat.test.ts`, and a new `db-llm-migration.test.ts` covering the upgrade path).
- api `tsc --noEmit` → clean for every touched file (remaining errors are pre-existing, in untouched files, from `@types/bun@latest` drift in the bun-run api).
- frontend `tsc --noEmit` → **0 errors** (validates the LLMSettings rewrite + Next-side migration).
- `npm run lint` → **0 errors** (4 pre-existing warnings, all in untouched files).

**Deferred to CI** (environment limits, not code): the e2e suite — the new `e2e/llm-settings.spec.ts` plus the existing specs — runs in CI; locally, Playwright/Next can't boot because `better-sqlite3@12` won't compile native bindings against this machine's Node v26. `prettier --check` flags the whole repo here (tailwind-plugin version drift), so formatting is left to CI.

**Left out of scope** (optional cleanup, separate PR): the dead `translation_evaluations` table + `EvalProvider` type, and the triplicated `SENSITIVE_KEYS`.

---

## TL;DR of decisions

1. **One provider class** `OpenAICompatibleProvider({ baseUrl, model, apiKey? })` replaces `OllamaProvider`, `ApfelProvider`, `LMStudioProvider`.
2. **One config shape**: endpoint + optional key + model, with a "Fetch models" button (via `/v1/models`) that falls back to a free-text field.
3. **Three working features get dropped** (all are provider-specific and outside the requested config shape) — see [Decisions for you](#decisions-for-you). Defaulting to drop; easy to keep any one if you say so.
4. **"Presets" are pure UI sugar** — a dropdown that autofills the endpoint (`:11434` for Ollama, `:1234` for LM Studio) and nothing else. **Zero backend branching on preset.**
5. **Migration is first-class** — an idempotent step in `api/src/db.ts` init maps old settings → new on existing installs.

---

## Resolved technical gate (was the main risk)

The single-`/v1`-path design hinged on one unknown: *does Ollama's OpenAI-compatible endpoint honor JSON mode?* The app's `translate`, `explain`, and `journal-correct` routes parse JSON out of `complete()`, so losing structured output would break them.

**Verified (Ollama docs + source):** `POST /v1/chat/completions` accepts `response_format` (the `ChatCompletionRequest` Go struct has `ResponseFormat`, and the OpenAI-compat docs list JSON mode). It also accepts `Authorization: Bearer <key>` and exposes `/v1/models`. So **all three providers can share one `/v1` code path.**

Native-only Ollama features left behind by moving off `/api/*`:
- **Auto-pull** (`/api/pull`) — downloads a missing model on first use. → casualty (see decisions).
- `num_ctx` / `keep_alive` request options — **not used by lector**, no loss.

---

## Current state (what exists today)

### Providers (`api/src/lib/llm/`)
| Provider | Chat endpoint | JSON mode | Health/models | Extras |
|---|---|---|---|---|
| `ollama.ts` | native `/api/chat` | `format: 'json'` (always) | `/api/tags` | **auto-pull** via `/api/pull` |
| `apfel.ts` | `/v1/chat/completions` | `response_format: json_object` (always) | `/v1/models` | — |
| `lmstudio.ts` | `/v1/chat/completions` | **none** | `/v1/models` | **API key**, `listModels()`, **`loadModel()`** (`/api/v1/models/load`), **`chatStateful()`** (`/api/v1/chat` + `response_id` threading) |
| `anthropic.ts` | SDK / Agent SDK | n/a | trivial completion | OAuth, per-task models — **untouched** |

Note the JSON inconsistency: Ollama and Apfel **force** JSON on every call (so chat-via-Ollama currently forces JSON — a latent bug), LM Studio forces nothing.

### Factory (`api/src/lib/llm/index.ts`)
- `getProvider()` — `switch` over `llmProvider` setting; per-provider settings read + cache key.
- `getAllProviders()` — instantiates all four for "parallel comparison". **Dead code** (no consumers).
- `resetProvider()` — clears cache after settings change.

### Consumers of `getProvider()`
- `routes/translate.ts` — `.complete()` (word + phrase, uses `task`)
- `routes/explain.ts` — `.complete()`
- `routes/journal-correct.ts` — `.complete()`
- `routes/chat.ts` — **branches on `instanceof LMStudioProvider`** for stateful chat; else `.complete()`
- `routes/llm-status.ts` — `.healthCheck()`, `.complete()` (test), `resetProvider()`

### Settings keys (plain key-value `settings` table, JSON values)
`llmProvider`, `ollamaModel`, `apfelUrl`, `apfelModel`, `lmstudioUrl`, `lmstudioModel`, `lmstudioApiKey`, plus Anthropic's `anthropicApiKey` / `claudeOauthToken` / `anthropicAuthMode`.

Secrets aren't encrypted — they're **redacted to `true`** at the GET layer by a `SENSITIVE_KEYS` set **duplicated in 3 files**: `api/src/routes/settings.ts`, `src/app/api/settings/route.ts`, `src/app/api/settings/[key]/route.ts`.

### UI (`src/app/settings/components/LLMSettings/index.tsx`)
~780 lines, four conditional blocks (one per provider). Ollama = hardcoded model dropdown (`constants.ts`); Apfel = URL+model text; LM Studio = endpoint + API key + fetchable model dropdown + Load button; Anthropic = key/OAuth.

### Next.js → Hono proxy
`src/app/api/llm/lmstudio/models/route.ts` and `.../load/route.ts` forward to the backend so the browser never holds the key cross-origin.

---

## Target design

### 1. `OpenAICompatibleProvider`
One class, replacing the three. Constructor `{ baseUrl, model, apiKey? }`.

```ts
class OpenAICompatibleProvider implements LLMProvider {
  name = 'openai';
  // complete(): POST {baseUrl}/v1/chat/completions
  //   body: { model, messages, max_tokens, ...(json ? { response_format: { type: 'json_object' } } : {}) }
  //   headers: Authorization: Bearer <apiKey> when set
  // healthCheck(): GET {baseUrl}/v1/models
  // listModels(): GET {baseUrl}/v1/models -> string[] (ids), [] on failure
}
```

Carry over from `lmstudio.ts`: the `fetchWithTimeout` + `headers()` helpers (they're the most complete). Drop everything LM-Studio-specific (`chatStateful`, `loadModel`, the `response_id` types) unless a decision below keeps it.

### 2. Explicit JSON mode (fixes the latent bug)
Add to `CompletionOptions`:
```ts
responseFormat?: 'json' | 'text'; // default 'text'
```
- `translate.ts`, `explain.ts`, `journal-correct.ts` → pass `responseFormat: 'json'`.
- `chat.ts` → `'text'` (prose).
- Provider only sends `response_format` when `'json'`.

This both unifies the three divergent behaviors **and** stops chat-via-Ollama from being forced into JSON.

### 3. Provider taxonomy
`llmProvider` setting collapses to two real backends: `'anthropic'` and `'openai'`. The factory `switch` loses three cases and gains one.

### 4. Unified settings panel
Replaces the three local-provider UI blocks with one:
- **Preset** (optional convenience): `Custom` / `Ollama` / `LM Studio` → on select, autofills **endpoint only** (`http://localhost:11434` / `:1234`). Stored as `openaiPreset` purely so the dropdown remembers the choice; **never read by the backend.**
- **Endpoint** — text input (`openaiUrl`).
- **API key (optional)** — password input, redacted (`openaiApiKey`); reuse the existing "Configured / Replace / Clear" pattern.
- **Model** — "Fetch models" button hits `/v1/models`; populates a dropdown; on empty/failure, the same control accepts free-text. Stored as `openaiModel`.

Reuse the LM Studio block's existing fetch/redaction UX wholesale — it already implements exactly the requested behavior; it just becomes the *only* block instead of one of four.

---

## Decisions for you

> **DECIDED (2026-06-18): drop all three.** Implementation proceeds on this basis — chat always sends full history via `complete()`, no `loadModel()`, no Ollama auto-pull.

All three are **working features that fall outside the requested "endpoint + key + model" shape**. Each deletes real code + tests.

| Feature | What it does | Cost to keep | Cost to drop |
|---|---|---|---|
| **LM Studio stateful chat** | `chat.ts` threads `response_id` to LM Studio's `/api/v1/chat` so context lives server-side; falls back to stateless on expiry | Keeps an `instanceof`/capability branch + `chatStateful` + fallback + `lmstudio-chat.spec.ts` | Chat always sends full history via `complete()` (already the path for Ollama/Apfel/Anthropic). Deletes a whole branch + spec. Minor: LM Studio re-processes history each turn. |
| **LM Studio "Load model"** | Button POSTs `/api/v1/models/load` to warm a model | Keep `loadModel()` + proxy route + UI button + part of `lmstudio-settings.spec.ts` | Rely on LM Studio's JIT auto-load (its default) or the user pre-loading. Deletes a route + button. |
| **Ollama auto-pull** | First call to a missing model triggers `/api/pull` to download it | Requires a native-`/api`-path branch — **reintroduces exactly the provider-specific branching this refactor removes** | User pulls models themselves (`ollama pull <model>`), same as picking a model in LM Studio. Health check just reports the model isn't present. |

**Recommendation:** drop all three. Auto-pull especially — keeping it defeats the purpose, since it forces a second non-`/v1` code path back into the unified provider.

---

## Settings schema + migration

### New keys
`openaiUrl`, `openaiModel`, `openaiApiKey` (sensitive), `openaiPreset` (UI-only). `llmProvider` ∈ `{ 'anthropic', 'openai' }`.

### Migration (idempotent, in `api/src/db.ts` `getDb()` init)
Runs once on existing DBs; safe to re-run.

```
read old llmProvider
if it's 'ollama' | 'apfel' | 'lmstudio' and openaiUrl not yet set:
  ollama   -> openaiUrl = OLLAMA default (http://localhost:11434), openaiModel = ollamaModel,  preset 'ollama'
  apfel    -> openaiUrl = apfelUrl,    openaiModel = apfelModel,    preset 'custom'
  lmstudio -> openaiUrl = lmstudioUrl, openaiModel = lmstudioModel, openaiApiKey = lmstudioApiKey, preset 'lmstudio'
  set llmProvider = 'openai'
leave anthropic + its keys untouched
(leave old keys in place — harmless; optionally delete in a later cleanup)
```

Handle the secret carefully: `lmstudioApiKey` → `openaiApiKey` is a value copy within the DB (never round-trips through the browser).

### SENSITIVE_KEYS
Add `openaiApiKey` to **all three** lists (`api/src/routes/settings.ts`, `src/app/api/settings/route.ts`, `src/app/api/settings/[key]/route.ts`). `lmstudioApiKey` can stay listed during the transition.

---

## Env / Docker

- New vars: `OPENAI_COMPAT_URL`, `OPENAI_COMPAT_MODEL`, `OPENAI_COMPAT_API_KEY`; `LLM_PROVIDER=openai`.
- **Back-compat:** the provider constructor still reads `OLLAMA_URL/OLLAMA_MODEL`, `APFEL_URL/APFEL_MODEL`, `LMSTUDIO_URL/LMSTUDIO_MODEL/LMSTUDIO_API_KEY` as fallbacks so existing deployments don't break. Mark them deprecated in `.env.example`.
- Update `.env.example`, `docker-compose.yml`, `deploy/docker-compose.yml`, `deploy/.env.example` (currently reference `OLLAMA_*` / `LLM_PROVIDER`).

---

## Phased implementation

1. **Backend provider** — add `openai-compatible.ts` (`OpenAICompatibleProvider`); add `responseFormat` to `CompletionOptions`; wire the three structured-output callers to pass `'json'`. Keep old provider files temporarily.
2. **Factory** — `getProvider()` switch → `{ anthropic, openai }`; read new keys with env fallbacks. Remove dead `getAllProviders()` (see cleanup).
3. **Routes** — `chat.ts`: drop the `instanceof LMStudioProvider` branch (per decision) so all non-Anthropic go through `complete()`. `llm-status.ts`: fix the `model` field, which currently hardcodes `process.env.OLLAMA_MODEL || ... || 'default'` and lies for most providers — report the resolved model. Rename `llm/lmstudio/{models,load}` proxy + backend routes to `llm/openai/models` (drop `load` if that decision lands).
4. **Settings persistence** — migration in `db.ts`; update `SENSITIVE_KEYS` ×3.
5. **UI** — rewrite `LLMSettings/index.tsx` to the single unified panel; update `types.ts` (`LLMProvider = 'anthropic' | 'openai'`); delete `constants.ts` hardcoded Ollama model list.
6. **Delete** old `ollama.ts`, `apfel.ts`, `lmstudio.ts` once nothing imports them.
7. **Tests + docs** — below.

---

## Testing (per repo policy: unit + e2e for touched surface)

- **Unit:** merge `apfel.test.ts` + `lmstudio.test.ts` → `openai-compatible.test.ts` (defaults, trailing-slash strip, Bearer header present/absent, `complete()` with/without `response_format`, `listModels()`, error paths). Keep `anthropic.test.ts`. Update `chat.test.ts` to drop the stateful branch (or keep, per decision).
- **E2E:** retarget `lmstudio-settings.spec.ts` → `llm-settings.spec.ts` against the new panel + `data-testid`s; update `settings-credentials.spec.ts` to assert `openaiApiKey` redaction; **delete `lmstudio-chat.spec.ts`** if stateful chat is dropped.
- **Migration test:** seed a DB with old `lmstudio*` keys, run init, assert new keys populated and provider resolves.

---

## Optional cleanup (separate PR — keep out of core scope)

- Delete dead `getAllProviders()`, the `translation_evaluations` table + `EvalProvider` type + `TranslationEvaluationRow` (no consumers; a `CREATE TABLE IF NOT EXISTS` left in place is harmless if you'd rather not migrate it out).
- De-duplicate the triplicated `SENSITIVE_KEYS` into one shared module imported by all three.

---

## Risks

- **Migration on a live SQLite DB** is the real operational risk — idempotent, transactional, and covered by a test. Leaving old keys in place (rather than deleting) makes it reversible.
- **JSON mode behavior change for the LM Studio path** — it sent no `response_format` before; structured routes will now request `json_object`. Verify against a real LM Studio that the configured model honors it (most do; if a model refuses, the prompt-level JSON instruction still applies).
- **`/v1/models` shape variance** — already handled: the UI falls back to free-text when the list is empty or the call fails.
