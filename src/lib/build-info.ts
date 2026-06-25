// Build / version metadata for the Settings → About panel.
//
// The values are injected at build time via `env` in next.config.ts (which
// sources them from build args in Docker/CI, or from `git` locally) and inlined
// into the bundle. Read them as direct `process.env.NEXT_PUBLIC_*` member
// accesses so Next replaces them statically in the client bundle — do not
// destructure `process.env`, or the replacement won't fire.

/** The GitHub repo these builds are cut from, used to link commits. */
export const REPO_SLUG = 'heuwels/lector';

export interface BuildInfo {
  /** `git describe --tags --always --dirty`, e.g. "v1.34.0" or "v1.34.0-3-gabc1234". */
  version: string;
  /** Full commit SHA, or "unknown" when it couldn't be determined. */
  commit: string;
  /** Branch the build was cut from, or "unknown". */
  branch: string;
  /** ISO-8601 build timestamp, or "" when unavailable. */
  buildTime: string;
}

export const buildInfo: BuildInfo = {
  version: process.env.NEXT_PUBLIC_APP_VERSION || 'unknown',
  commit: process.env.NEXT_PUBLIC_GIT_COMMIT || 'unknown',
  branch: process.env.NEXT_PUBLIC_GIT_BRANCH || 'unknown',
  buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || '',
};

/** True when a value was actually resolved (not the "unknown"/empty fallback). */
export function isKnown(value: string): boolean {
  return value !== '' && value !== 'unknown';
}

/** Abbreviate a commit SHA to 7 chars; passes through "unknown"/empty unchanged. */
export function commitShort(commit: string): string {
  return isKnown(commit) ? commit.slice(0, 7) : commit;
}

/**
 * GitHub URL for a commit, or `null` when the commit isn't a real SHA (so the
 * UI can render plain text instead of a dead link).
 */
export function commitUrl(commit: string, repo: string = REPO_SLUG): string | null {
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) return null;
  return `https://github.com/${repo}/commit/${commit}`;
}

/**
 * Human-readable absolute build time in UTC, e.g. "25 Jun 2026, 18:10 UTC".
 * Returns "" for empty or unparseable input. Fixed locale + UTC keeps it
 * deterministic regardless of where it renders.
 */
export function formatBuildTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const formatted = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
  return `${formatted} UTC`;
}

/**
 * Relative build age, e.g. "2 hours ago". `nowMs` is injected so the function
 * stays pure and testable. Returns "" for empty or unparseable input.
 */
export function relativeBuildAge(iso: string, nowMs: number): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const diffSec = Math.round((then - nowMs) / 1000);
  const absSec = Math.abs(diffSec);

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, secs] of units) {
    if (absSec >= secs) return rtf.format(Math.round(diffSec / secs), unit);
  }
  return rtf.format(diffSec, 'second');
}
