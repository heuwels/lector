/**
 * Install a pinned dictionary into DICT_DIR at runtime (#438).
 *
 * The published image no longer bakes the databases. It ships `dict.env` and
 * downloads what the box actually needs. This module owns one download.
 * `dict-worker.ts` decides which languages to ask for.
 *
 * Three rules hold this together:
 *
 * 1. **Write atomically.** `dictionary-db.ts` opens the file with `immutable=1`,
 *    which promises SQLite that the bytes never change. So the download goes to
 *    a temporary name in the same directory, and `rename` puts it in place. A
 *    partial file is never visible under the real name.
 * 2. **Verify before the rename.** The SHA-256 comes from the pin manifest
 *    inside the image, so a swapped release asset cannot get installed.
 * 3. **Invalidate the caches.** `getDb` caches a `null` for a missing language
 *    forever. Without the invalidation the new file stays invisible until a
 *    restart.
 */
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { dictAssetUrl, dictPins, type DictPin } from './dict-pins';
import { dictionaryDir, invalidateDictionaryCache } from './dictionary-db';

/** What DICT_DIR holds, keyed by language code. */
export interface InstalledEntry {
  version: string;
  sha256: string;
  /** ISO-8601, for the Settings panel and for support questions. */
  installedAt: string;
}

export type InstalledManifest = Record<string, InstalledEntry>;

const MANIFEST_NAME = 'installed.json';

export function manifestPath(dir = dictionaryDir()): string {
  return path.join(dir, MANIFEST_NAME);
}

export function readInstalledManifest(dir = dictionaryDir()): InstalledManifest {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath(dir), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: InstalledManifest = {};
    for (const [code, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const { version, sha256, installedAt } = entry as Record<string, unknown>;
      if (typeof version !== 'string' || typeof sha256 !== 'string') continue;
      out[code] = {
        version,
        sha256: sha256.toLowerCase(),
        installedAt: typeof installedAt === 'string' ? installedAt : '',
      };
    }
    return out;
  } catch {
    // No manifest yet, or an unreadable one. Both mean "nothing recorded".
    return {};
  }
}

function writeInstalledManifest(manifest: InstalledManifest, dir = dictionaryDir()): void {
  const tmp = `${manifestPath(dir)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(tmp, manifestPath(dir));
}

/**
 * Is this language already installed at the pinned version?
 *
 * The manifest is the fast answer. A file with no manifest entry counts as
 * installed at an unknown version, because a `:full` image bakes the databases
 * and writes no manifest. Re-downloading those would defeat the whole point of
 * the offline tag, so an unrecorded file is left alone.
 */
export function isInstalled(
  language: string,
  pin: DictPin,
  manifest: InstalledManifest,
  dir = dictionaryDir(),
): boolean {
  const onDisk = fs.existsSync(path.join(dir, `dictionary-${language}.db`));
  if (!onDisk) return false;
  const entry = manifest[language];
  if (!entry) return true;
  return entry.version === pin.version && entry.sha256 === pin.sha256;
}

export class DictInstallError extends Error {}

/**
 * Download, verify, and install one language. Returns the manifest entry it
 * wrote. Throws `DictInstallError` when the language has no pin, the download
 * fails, or the hash does not match.
 *
 * `signal` cancels an in-flight download at shutdown.
 */
export async function installDictionary(
  language: string,
  options: { dir?: string; signal?: AbortSignal } = {},
): Promise<InstalledEntry> {
  const dir = options.dir ?? dictionaryDir();
  const pin = dictPins().pins[language];
  if (!pin) {
    throw new DictInstallError(`no pin in dict.env for language "${language}"`);
  }

  fs.mkdirSync(dir, { recursive: true });

  const url = dictAssetUrl(language, pin);
  const target = path.join(dir, `dictionary-${language}.db`);
  // Same directory as the target, so the rename stays on one filesystem and is
  // therefore atomic. The pid keeps two processes on one volume apart.
  const tmp = path.join(dir, `.dictionary-${language}.db.${process.pid}.part`);

  try {
    const res = await fetch(url, { signal: options.signal });
    if (!res.ok || !res.body) {
      throw new DictInstallError(`GET ${url} returned ${res.status}`);
    }

    // Hash while the bytes stream to disk. A dictionary runs to 300 MB, so it
    // never goes through memory and it is never read back a second time.
    const hash = createHash('sha256');
    await pipeline(
      Readable.fromWeb(res.body as never),
      async function* (source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          hash.update(chunk);
          yield chunk;
        }
      },
      fs.createWriteStream(tmp),
    );

    const actual = hash.digest('hex');
    if (actual !== pin.sha256) {
      throw new DictInstallError(
        `sha256 mismatch for ${language}: pinned ${pin.sha256}, downloaded ${actual}`,
      );
    }

    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // The partial file is best-effort cleanup. A failed unlink must not mask
      // the real error below.
    }
    throw err instanceof DictInstallError ? err : new DictInstallError(String(err));
  }

  const entry: InstalledEntry = {
    version: pin.version,
    sha256: pin.sha256,
    installedAt: new Date().toISOString(),
  };
  const manifest = readInstalledManifest(dir);
  manifest[language] = entry;
  writeInstalledManifest(manifest, dir);

  // The file exists now, so drop the cached "no dictionary here".
  invalidateDictionaryCache(language);
  return entry;
}
