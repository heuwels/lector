// Pure verification core for starter content (#316) — no fs, no sqlite, no
// language pack. The CLI (scripts/verify-starter-content.ts) tokenizes lessons
// with the app's own tokenizer and resolves lemmas against the on-device
// dictionary, then hands everything here; tests drive this with stubs.

export interface WordlistEntry {
  rank: number;
  lemma: string;
  band: number;
  zipf?: number;
}

export interface LessonTokens {
  title: string;
  /** Cumulative frequency-rank cap for this lesson (band discipline). */
  maxRank: number;
  /** Per-lesson whitelist (folded): proper nouns etc. exempt from all checks. */
  allow: Set<string>;
  /** Folded word tokens, in reading order (pure-digit tokens pre-filtered). */
  tokens: string[];
}

/** Resolve a folded token to its dictionary lemma, or null when the
 * dictionary cannot statically resolve it (exact + inflections only — the
 * reader's AI-cache fallthrough deliberately doesn't count for content). */
export type Resolver = (folded: string) => string | null;

export type ViolationKind =
  | 'unresolvable' // token has no dictionary resolution → a dead tap
  | 'off-list' // resolves, but the lemma is not a wordlist target at all
  | 'out-of-band' // wordlist lemma whose rank exceeds the lesson's cap
  | 'new-lemma-cap'; // lesson introduces more new target lemmas than allowed

export interface Violation {
  lessonIndex: number;
  lesson: string;
  kind: ViolationKind;
  token: string;
  lemma?: string;
  rank?: number;
  detail: string;
}

export interface LessonReport {
  title: string;
  maxRank: number;
  tokenCount: number;
  uniqueLemmas: number;
  newTargetLemmas: string[];
  violations: Violation[];
}

export interface VerifySummary {
  lessons: LessonReport[];
  violations: Violation[];
  /** Wordlist lemmas reachable under the final lesson's cap. */
  reachableTotal: number;
  coverage: {
    introduced: number;
    reachableTotal: number;
    pct: number;
    missing: string[];
  };
  /** Introduced target lemmas appearing fewer than minRecycles times. */
  underRecycled: { lemma: string; count: number }[];
}

export interface VerifyOptions {
  maxNewLemmasPerLesson: number;
  minRecycles: number;
  /** Global whitelist (folded), merged with each lesson's. */
  allow: Set<string>;
}

export const DEFAULT_OPTIONS: VerifyOptions = {
  maxNewLemmasPerLesson: 60,
  minRecycles: 3,
  allow: new Set(),
};

/**
 * Default cumulative rank caps when the manifest doesn't specify per-lesson
 * maxRank: lessons are split evenly into bands of `bandSize` lemmas — with 20
 * lessons over a 1000-lemma list (bandSize 250) that's 5 lessons per band and
 * caps of 250/500/750/1000.
 */
export function defaultLessonCaps(
  lessonCount: number,
  wordlistSize: number,
  bandSize: number,
): number[] {
  const bands = Math.max(1, Math.ceil(wordlistSize / bandSize));
  const lessonsPerBand = Math.max(1, Math.ceil(lessonCount / bands));
  return Array.from({ length: lessonCount }, (_, i) =>
    Math.min(wordlistSize, bandSize * (Math.floor(i / lessonsPerBand) + 1)),
  );
}

export function verify(
  lessons: LessonTokens[],
  wordlist: WordlistEntry[],
  resolve: Resolver,
  options: Partial<VerifyOptions> = {},
): VerifySummary {
  const opts: VerifyOptions = { ...DEFAULT_OPTIONS, ...options };
  const rankByLemma = new Map(wordlist.map((w) => [w.lemma, w.rank]));

  const lemmaCache = new Map<string, string | null>();
  const memoResolve: Resolver = (folded) => {
    if (!lemmaCache.has(folded)) lemmaCache.set(folded, resolve(folded));
    return lemmaCache.get(folded)!;
  };

  const introducedAt = new Map<string, number>(); // target lemma → lesson index
  const recycleCounts = new Map<string, number>(); // target lemma → occurrences
  const reports: LessonReport[] = [];

  lessons.forEach((lesson, lessonIndex) => {
    const violations: Violation[] = [];
    const seenTokens = new Set<string>();
    const lessonLemmas = new Set<string>();
    const newTargetLemmas: string[] = [];

    for (const token of lesson.tokens) {
      const allowed = opts.allow.has(token) || lesson.allow.has(token);
      const lemma = allowed ? null : memoResolve(token);

      // Recycle counts include every occurrence, not just first sightings.
      if (lemma !== null && rankByLemma.has(lemma)) {
        recycleCounts.set(lemma, (recycleCounts.get(lemma) ?? 0) + 1);
        lessonLemmas.add(lemma);
      }

      // Each distinct token is diagnosed once per lesson.
      if (seenTokens.has(token)) continue;
      seenTokens.add(token);
      if (allowed) continue;

      if (lemma === null) {
        violations.push({
          lessonIndex,
          lesson: lesson.title,
          kind: 'unresolvable',
          token,
          detail: `"${token}" has no dictionary entry or inflection — it would be a dead tap`,
        });
        continue;
      }

      const rank = rankByLemma.get(lemma);
      if (rank === undefined) {
        violations.push({
          lessonIndex,
          lesson: lesson.title,
          kind: 'off-list',
          token,
          lemma,
          detail: `"${token}" → ${lemma} is not in the target wordlist — swap it for a target word or whitelist it`,
        });
        continue;
      }

      if (rank > lesson.maxRank) {
        violations.push({
          lessonIndex,
          lesson: lesson.title,
          kind: 'out-of-band',
          token,
          lemma,
          rank,
          detail: `"${token}" → ${lemma} is rank ${rank}, beyond this lesson's cap of ${lesson.maxRank}`,
        });
        continue;
      }

      if (!introducedAt.has(lemma)) {
        introducedAt.set(lemma, lessonIndex);
        newTargetLemmas.push(lemma);
      }
    }

    if (newTargetLemmas.length > opts.maxNewLemmasPerLesson) {
      violations.push({
        lessonIndex,
        lesson: lesson.title,
        kind: 'new-lemma-cap',
        token: '',
        detail: `${newTargetLemmas.length} new target lemmas exceeds the per-lesson cap of ${opts.maxNewLemmasPerLesson}`,
      });
    }

    reports.push({
      title: lesson.title,
      maxRank: lesson.maxRank,
      tokenCount: lesson.tokens.length,
      uniqueLemmas: lessonLemmas.size,
      newTargetLemmas,
      violations,
    });
  });

  const finalCap = lessons.length ? Math.max(...lessons.map((l) => l.maxRank)) : 0;
  const reachable = wordlist.filter((w) => w.rank <= finalCap);
  const missing = reachable.filter((w) => !introducedAt.has(w.lemma)).map((w) => w.lemma);
  const introduced = reachable.length - missing.length;

  const underRecycled = [...introducedAt.keys()]
    .map((lemma) => ({ lemma, count: recycleCounts.get(lemma) ?? 0 }))
    .filter((r) => r.count < opts.minRecycles)
    .sort((a, b) => a.count - b.count || a.lemma.localeCompare(b.lemma));

  return {
    lessons: reports,
    violations: reports.flatMap((r) => r.violations),
    reachableTotal: reachable.length,
    coverage: {
      introduced,
      reachableTotal: reachable.length,
      pct: reachable.length ? Math.round((introduced / reachable.length) * 1000) / 10 : 100,
      missing,
    },
    underRecycled,
  };
}
