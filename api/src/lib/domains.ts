// Single source of truth for the fluency-radar topic taxonomy and the
// per-domain "strength band" maths. Mirrored verbatim in src/lib/domains.ts
// (the Next side needs the same enum + maths for aggregation and the radar) —
// keep the two files identical.
//
// A learner's fluency is per-domain, not one global level. The radar plots a
// log-normalised "mastery" score per domain (0–100) and labels it with a
// neutral strength band (Novice→Expert). The real CEFR letter stays global,
// on the existing fluency card.

/**
 * The fixed radar axes. A fixed enum (not free-text LLM labels) keeps the axes
 * stable and comparable over time. `scope` doubles as the per-domain hint in
 * the classifier prompt. Capped at ~10 — radars get unreadable past that.
 */
export const DOMAINS = [
  { key: 'daily_life', label: 'Daily life & home', scope: 'routines, family, housing, clothing, shopping, everyday money matters' },
  { key: 'food', label: 'Food & cooking', scope: 'recipes, ingredients, cooking, restaurants, eating & drinking' },
  { key: 'health', label: 'Health & medicine', scope: 'body, illness, doctors, hospitals, fitness, mental & physical wellbeing' },
  { key: 'travel', label: 'Travel & places', scope: 'transport, directions, countries, cities, tourism, accommodation' },
  { key: 'work', label: 'Work & business', scope: 'jobs, workplace, careers, economy, commerce, finance' },
  { key: 'science_tech', label: 'Science & technology', scope: 'computing, internet, engineering, maths, scientific research' },
  { key: 'nature', label: 'Nature & environment', scope: 'animals, plants, landscapes, weather, climate, ecology' },
  { key: 'arts_culture', label: 'Arts & culture', scope: 'literature, music, film, art, history, religion, philosophy' },
  { key: 'sport_leisure', label: 'Sport & leisure', scope: 'sports, games, hobbies, exercise, entertainment, holidays' },
  { key: 'society', label: 'Society & politics', scope: 'news, government, law, media, education, social issues' },
] as const;

export type DomainKey = (typeof DOMAINS)[number]['key'];

/**
 * Topic-neutral / high-frequency / function & core words ("the", "very",
 * "think"). The classifier returns this for words that belong to no specific
 * topic. It is NOT a radar axis — it would dominate every domain — so it's
 * excluded from aggregation, but it IS a valid classifier output (vs. a word
 * left unclassified, which means "not swept yet").
 */
export const GENERAL = 'general' as const;

/** Every value the classifier is allowed to assign to a word. */
export type ClassifiedDomain = DomainKey | typeof GENERAL;

export const DOMAIN_KEYS: DomainKey[] = DOMAINS.map((d) => d.key);

export function isDomainKey(value: string): value is DomainKey {
  return DOMAIN_KEYS.includes(value as DomainKey);
}

export function isClassifiedDomain(value: string): value is ClassifiedDomain {
  return value === GENERAL || isDomainKey(value);
}

// --- strength-band maths --------------------------------------------------

/**
 * How much each word state counts toward a domain's mastery score — the user's
 * "fraction of a word" model: a `known` word is one full word; partially
 * learned words count as fractions; `new`/`ignored` count for nothing.
 *
 * Keys mirror `WordState` in src/types/index.ts; kept local so this module
 * stays self-contained (and byte-identical to the Next mirror).
 */
export const STATE_WEIGHT = {
  new: 0,
  level1: 0.05,
  level2: 0.15,
  level3: 0.3,
  level4: 0.5,
  known: 1,
  ignored: 0,
} as const;

export type WeightedState = keyof typeof STATE_WEIGHT;

/**
 * Words needed for a domain to read as "full" (axis 100 / Expert). A rough,
 * tunable guess — the single biggest knob on how full the radar reads, and the
 * #1 thing to calibrate against real data. Default kept generous (low) so new
 * learners see signal early rather than reading Novice everywhere; the user's
 * intuition was ~3000, which is harder to climb.
 */
export const DEFAULT_CEIL = 600;

export type DomainStateCounts = Partial<Record<WeightedState, number>>;

/** Weighted "effective known words" in a domain. */
export function masteryScore(counts: DomainStateCounts): number {
  let score = 0;
  for (const state of Object.keys(STATE_WEIGHT) as WeightedState[]) {
    score += (counts[state] ?? 0) * STATE_WEIGHT[state];
  }
  return score;
}

/**
 * Map a mastery score to a 0–100 axis value on a log scale, so a huge
 * common-word domain doesn't flatten a small specialised one. `mastery === ceil`
 * maps to 100; anything beyond is capped.
 */
export function axisValue(mastery: number, ceil: number = DEFAULT_CEIL): number {
  if (mastery <= 0) return 0;
  const value = (100 * Math.log(1 + mastery)) / Math.log(1 + ceil);
  return Math.min(100, Math.round(value));
}

export type Band = 'Novice' | 'Developing' | 'Strong' | 'Expert';

/** Neutral strength band for an axis value (0–100). */
export function bandFor(axis: number): Band {
  if (axis < 20) return 'Novice';
  if (axis < 45) return 'Developing';
  if (axis < 75) return 'Strong';
  return 'Expert';
}
