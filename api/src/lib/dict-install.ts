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
 * A version that means "somebody else owns this file — never replace it".
 * The Dockerfile writes it for a DICT_URL override, which is a deliberate
 * substitution of a custom database.
 */
export const UNMANAGED_VERSION = 'unmanaged';

/**
 * Is this language already installed at the pinned version?
 *
 * A file with no manifest entry is NOT treated as current. It used to be, so
 * that a `:full` image did not re-download 2.6 GB on first boot, but that also
 * froze those files: a later pin change could never replace them. The bake
 * stage writes the manifest now, and `adoptUnrecorded` below records anything
 * else it finds, so by the time this runs an entry exists either way.
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
  if (!entry) return false;
  if (entry.version === UNMANAGED_VERSION) return true;
  return entry.version === pin.version && entry.sha256 === pin.sha256;
}

/**
 * Record any dictionary that is on disk but not in the manifest.
 *
 * A file can arrive without an entry: an image built before the bake stage
 * wrote one, or a file dropped into the volume by hand. Leaving it unrecorded
 * used to mean it was never updated again. Claiming the CURRENT pin for it
 * keeps the file (no 2.6 GB re-download) and still lets the NEXT pin change
 * replace it.
 *
 * Use the `:full` tag with DICT_FETCH=0, or an `unmanaged` entry, for a file
 * that must never be touched.
 */
export function adoptUnrecorded(
  pins: Record<string, DictPin>,
  dir = dictionaryDir(),
): string[] {
  const manifest = readInstalledManifest(dir);
  const adopted: string[] = [];
  for (const [language, pin] of Object.entries(pins)) {
    if (manifest[language]) continue;
    if (!fs.existsSync(path.join(dir, `dictionary-${language}.db`))) continue;
    manifest[language] = {
      version: pin.version,
      sha256: pin.sha256,
      installedAt: new Date().toISOString(),
    };
    adopted.push(language);
  }
  if (adopted.length > 0) {
    writeInstalledManifest(manifest, dir);
    console.log(`[dict] adopted existing dictionaries: ${adopted.join(', ')}`);
  }
  return adopted;
}

export class DictInstallError extends Error {}

/**
 * Give up on a download that stops making progress.
 *
 * The reconcile loop runs one language at a time and skips a tick while one is
 * still in flight. A socket that hangs open therefore stops every other
 * language for the life of the process, and a cloud box with `DICT_LANGS=all`
 * would serve 19 languages from the AI path forever. The timeout is the thing
 * that stops that, so it covers the whole transfer, not just the response head.
 *
 * A dictionary reaches 300 MB, so the ceiling is generous. Adjust it with
 * DICT_TIMEOUT_MS on a slow link.
 */
export function downloadTimeoutMs(): number {
  const raw = parseInt(process.env.DICT_TIMEOUT_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 30 * 60 * 1000;
}

/** The caller's signal, aborted as well when the timeout fires. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  // AbortSignal.any keeps whichever fires first, and drops both listeners when
  // the request settles.
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Remove leftover part files before a reconcile.
 *
 * The temp name carries the pid, and the cleanup in `installDictionary` runs
 * only in the process that started the download. A container that is killed
 * mid-download (`docker compose up -d` recreates, so every update does this)
 * leaves its part file behind, and the next boot picks a new pid. A few killed
 * 300 MB downloads fill a volume that way.
 */
export function sweepPartFiles(dir = dictionaryDir()): number {
  let removed = 0;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0; // No directory yet. Nothing to sweep.
  }
  for (const name of names) {
    if (!name.startsWith('.dictionary-') || !name.endsWith('.part')) continue;
    try {
      fs.rmSync(path.join(dir, name), { force: true });
      removed += 1;
    } catch {
      // A part file this process cannot remove is not worth failing over.
    }
  }
  if (removed > 0) console.log(`[dict] removed ${removed} leftover download file(s)`);
  return removed;
}

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

  // One deadline for the whole transfer, so a stalled socket cannot hold the
  // reconcile loop open forever.
  const signal = withTimeout(options.signal, downloadTimeoutMs());

  try {
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) {
      throw new DictInstallError(`GET ${url} returned ${res.status}`);
    }

    // Hash while the bytes stream to disk. A dictionary runs to 300 MB, so it
    // never goes through memory and it is never read back a second time. The
    // signal is passed here too: aborting the fetch alone leaves the body
    // stream to drain on its own.
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
      { signal },
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
