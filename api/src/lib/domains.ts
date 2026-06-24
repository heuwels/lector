// Single source of truth for the fluency-radar topic taxonomy and the
// per-domain "strength band" maths. Lives api-side only: the Hono API owns the
// DB and does all fluency aggregation (deriveDomainFluency below), so the Next
// client just renders the computed `byDomain` array from the /stats/fluency
// response and never needs this module.
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
  {
    key: 'daily_life',
    label: 'Daily life & home',
    scope: 'routines, family, housing, clothing, shopping, everyday money matters',
  },
  {
    key: 'food',
    label: 'Food & cooking',
    scope: 'recipes, ingredients, cooking, restaurants, eating & drinking',
  },
  {
    key: 'health',
    label: 'Health & medicine',
    scope: 'body, illness, doctors, hospitals, fitness, mental & physical wellbeing',
  },
  {
    key: 'travel',
    label: 'Travel & places',
    scope: 'transport, directions, countries, cities, tourism, accommodation',
  },
  {
    key: 'work',
    label: 'Work & business',
    scope: 'jobs, workplace, careers, economy, commerce, finance',
  },
  {
    key: 'science_tech',
    label: 'Science & technology',
    scope: 'computing, internet, engineering, maths, scientific research',
  },
  {
    key: 'nature',
    label: 'Nature & environment',
    scope: 'animals, plants, landscapes, weather, climate, ecology',
  },
  {
    key: 'arts_culture',
    label: 'Arts & culture',
    scope: 'literature, music, film, art, history, religion, philosophy',
  },
  {
    key: 'sport_leisure',
    label: 'Sport & leisure',
    scope: 'sports, games, hobbies, exercise, entertainment, holidays',
  },
  {
    key: 'society',
    label: 'Society & politics',
    scope: 'news, government, law, media, education, social issues',
  },
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
 * Word states that count toward the radar — everything with a positive
 * STATE_WEIGHT (i.e. excluding `new` and `ignored`). Single source of truth:
 * the classifier worker's candidate query and the radar's `pending` count both
 * key off this list, so keep it here rather than re-listing the states inline.
 */
export const MASTERY_STATES = ['level1', 'level2', 'level3', 'level4', 'known'] as const;

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

// --- radar aggregation ----------------------------------------------------

/** One fluency-radar axis — a topic domain's strength. */
export interface DomainAxis {
  domain: DomainKey;
  label: string;
  knownCount: number;
  masteryScore: number;
  /** 0–100, log-normalised; what the radar polygon plots. */
  axisValue: number;
  band: Band;
}

export interface DomainFluency {
  byDomain: DomainAxis[];
  /** Mastery-state words the classifier worker hasn't tagged yet (drains to 0). */
  pending: number;
}

/** A `SELECT domain, state, COUNT(*) … GROUP BY domain, state` row from knownWords. */
export interface DomainStateRow {
  domain: string | null;
  state: string;
  count: number;
}

/**
 * Fold grouped `knownWords` rows into the radar payload. Pure (no DB) so it unit
 * tests directly: the caller runs the GROUP BY, this does the maths.
 *
 * Aggregated from knownWords — one row per unique word/language — so the radar
 * reconciles with the global known count by construction (NOT from vocab, which
 * holds many rows per word and would double-count). Invariant:
 * Σ(domain known) + (general known) + (known still pending) === global known.
 *
 * `general` is a real classifier output but never a radar axis (it would
 * dominate every domain), so it's folded into neither byDomain nor `pending`.
 * `pending` counts only mastery-state words still awaiting classification
 * (domain IS NULL), surfacing a fresh import as "in progress" rather than wrong.
 */
export function deriveDomainFluency(rows: DomainStateRow[]): DomainFluency {
  const masterySet: ReadonlySet<string> = new Set(MASTERY_STATES);
  const countsByDomain: Record<string, DomainStateCounts> = {};
  let pending = 0;
  for (const row of rows) {
    if (row.domain === null) {
      if (masterySet.has(row.state)) pending += row.count;
      continue; // 'general' words have a (non-null) domain → classified, just not an axis
    }
    (countsByDomain[row.domain] ||= {})[row.state as WeightedState] = row.count;
  }

  // One entry per fixed axis (stable radar shape); 'general' is intentionally
  // absent. axisValue/band come from the shared pure helpers above.
  const byDomain: DomainAxis[] = DOMAINS.map((d) => {
    const counts = countsByDomain[d.key] || {};
    const mastery = masteryScore(counts);
    const axis = axisValue(mastery);
    return {
      domain: d.key,
      label: d.label,
      knownCount: counts.known || 0,
      masteryScore: Math.round(mastery * 100) / 100,
      axisValue: axis,
      band: bandFor(axis),
    };
  });

  return { byDomain, pending };
}
