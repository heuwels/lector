/**
 * Read the dictionary pin manifest (#438).
 *
 * `dict.env` is the single source of truth for which dictionary release each
 * language sits on, and for the SHA-256 of that release asset. The Dockerfile
 * and the CI workflows already source it as a shell file. The image now also
 * ships it to the runtime, because the boot fetch downloads the same assets and
 * verifies them against the same hashes.
 *
 * The pins travel inside the image, so a compromised release asset cannot
 * inject a different database. That is the same integrity guarantee the
 * build-time fetch has.
 */
import fs from 'fs';
import path from 'path';

export interface DictPin {
  /** Release tag that holds `dictionary-<lang>.db`. */
  version: string;
  /** SHA-256 of that asset, lower case hex. */
  sha256: string;
}

export interface DictPins {
  /** Every language the project publishes a dictionary for. */
  published: string[];
  /** Pin per language. A published language always has one. */
  pins: Record<string, DictPin>;
}

/**
 * `api/src/lib/` → the repository root. The image copies `dict.env` beside the
 * `api/` directory (`/app/dict.env`), so one relative path serves the image and
 * a local `cd api && bun run src/index.ts`.
 */
const DEFAULT_DICT_ENV = path.resolve(import.meta.dir, '../../../dict.env');

export function dictEnvPath(): string {
  return process.env.DICT_ENV_PATH || DEFAULT_DICT_ENV;
}

/**
 * Parse the `KEY=value` lines this file is allowed to hold. It is a shell file,
 * but a shell parser is not needed and not wanted: the release script writes
 * plain assignments, and anything else must not silently become a download URL.
 */
export function parseDictEnv(text: string): DictPins {
  const values: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  const published = (values.DICT_LANGS || '')
    .split(/\s+/)
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);

  const pins: Record<string, DictPin> = {};
  for (const code of published) {
    const upper = code.toUpperCase();
    const version = values[`DICT_VERSION_${upper}`];
    const sha256 = values[`DICT_SHA256_${upper}`];
    if (!version || !sha256) continue;
    pins[code] = { version, sha256: sha256.toLowerCase() };
  }

  return { published: published.filter((code) => pins[code]), pins };
}

let cached: DictPins | null = null;

/**
 * The parsed manifest. The file ships inside the image and cannot change under
 * a running process, so one read is enough. `reloadDictPins` exists for tests.
 */
export function dictPins(): DictPins {
  if (!cached) {
    try {
      cached = parseDictEnv(fs.readFileSync(dictEnvPath(), 'utf8'));
    } catch (err) {
      // A missing manifest disables the boot fetch. It must not stop the API:
      // dictionaries are optional at runtime and lookups fall back to AI.
      console.warn(`[dict] no pin manifest at ${dictEnvPath()} — runtime fetch disabled:`, err);
      cached = { published: [], pins: {} };
    }
  }
  return cached;
}

export function reloadDictPins(): DictPins {
  cached = null;
  return dictPins();
}

/** Release asset URL for one pinned language. */
export function dictAssetUrl(language: string, pin: DictPin): string {
  const base = (process.env.DICT_RELEASE_BASE || 'https://github.com/heuwels/lector/releases/download')
    .replace(/\/+$/, '');
  return `${base}/${pin.version}/dictionary-${language}.db`;
}
