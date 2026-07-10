import fs from 'fs';
import path from 'path';
import type { LanguageCode } from './languages';

/**
 * Starter content (#315): a language pack may ship a default "first 1,000
 * words" collection at `languages/<code>/content/starter/` — a manifest.json
 * plus one markdown file per lesson. It's read from disk server-side only
 * (the seed route copies it into the user's own collections/lessons rows),
 * so the client bundles nothing. The API image ships the whole `languages/`
 * dir (Dockerfile `COPY languages ./languages`), so the same relative root
 * resolves in dev, tests, and the container.
 *
 * STARTER_CONTENT_ROOT overrides the root directory — used by unit tests and
 * the e2e suite to inject fixture packs without shipping placeholder content
 * in real packs.
 */

interface StarterManifestLesson {
  /** Markdown filename, relative to the starter dir (e.g. "01-hola.md"). */
  file: string;
  title: string;
}

interface StarterManifest {
  title: string;
  author?: string;
  lessons: StarterManifestLesson[];
}

export interface StarterLesson {
  title: string;
  markdown: string;
}

export interface StarterContent {
  title: string;
  author: string;
  lessons: StarterLesson[];
}

// Read per call (not at module load) so tests can point the root at fixtures.
function starterDir(language: LanguageCode): string {
  const root =
    process.env.STARTER_CONTENT_ROOT || path.resolve(import.meta.dir, '../../../languages');
  return path.join(root, language, 'content', 'starter');
}

export function hasStarterContent(language: LanguageCode): boolean {
  return fs.existsSync(path.join(starterDir(language), 'manifest.json'));
}

/**
 * Load a pack's starter content. Returns null when the pack ships none (the
 * normal case until a language's series lands). Throws on a malformed
 * manifest — that's a packaging bug that should surface as a 500 (and hit
 * Sentry via the app-level onError), not silently read as "no content".
 */
export function loadStarterContent(language: LanguageCode): StarterContent | null {
  const dir = starterDir(language);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as StarterManifest;
  if (!manifest.title || !Array.isArray(manifest.lessons) || manifest.lessons.length === 0) {
    throw new Error(
      `Starter manifest for '${language}' is malformed: title and a non-empty lessons array are required`,
    );
  }

  const lessons = manifest.lessons.map((lesson) => {
    if (!lesson.file || !lesson.title) {
      throw new Error(`Starter manifest for '${language}' has a lesson missing file or title`);
    }
    // Manifests are repo-shipped, but keep lesson files contained to the
    // starter dir anyway — a manifest must never read outside its pack.
    const filePath = path.resolve(dir, lesson.file);
    if (!filePath.startsWith(path.resolve(dir) + path.sep)) {
      throw new Error(`Starter lesson path escapes the pack: ${lesson.file}`);
    }
    return { title: lesson.title, markdown: fs.readFileSync(filePath, 'utf8') };
  });

  return { title: manifest.title, author: manifest.author || 'Lector', lessons };
}
