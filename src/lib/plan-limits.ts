/**
 * Client half of the plan-limits engine (#222): turn the API's 429
 * `plan_limit` responses into a soft upsell prompt instead of an error wall,
 * and let surfaces reflect limits before calling the API. Enforcement is
 * server-side only — everything here is UX.
 */
import { toast } from 'sonner';

export interface PlanLimitPayload {
  error: 'plan_limit';
  metric: string;
  limit: number;
  used: number;
  requested: number;
  plan: string;
  upgrade: PlanUpgradeTarget;
}

export type PlanUpgradeTarget = 'cloud' | 'plus' | 'byok' | null;

export function recommendedUpgrade(plan: string, byok = false): PlanUpgradeTarget {
  if (byok) return null;
  if (plan === 'free') return 'cloud';
  if (plan === 'cloud') return 'plus';
  if (plan === 'plus') return 'byok';
  return null;
}

export function phraseSelectionLimitPayload(
  entitlements: {
    plan: string;
    byok: boolean;
    limits: Record<string, number | null>;
  },
  requestedWords: number,
): PlanLimitPayload | null {
  const limit = entitlements.limits.phraseSelectionWords;
  if (typeof limit !== 'number' || requestedWords <= limit) return null;
  return {
    error: 'plan_limit',
    metric: 'phraseSelectionWords',
    limit,
    used: 0,
    requested: requestedWords,
    plan: entitlements.plan,
    upgrade: recommendedUpgrade(entitlements.plan, entitlements.byok),
  };
}

export function planLimitAction(
  upgrade: PlanUpgradeTarget,
  metric?: string,
): { label: string; href: string } | null {
  if (upgrade === 'cloud') return { label: 'Upgrade to Cloud', href: '/subscribe' };
  if (upgrade === 'byok' && (!metric || BYOK_AI_METRICS.has(metric))) {
    return { label: 'Add API key', href: '/settings#byok' };
  }

  // Safe Cloud → Plus subscription mutation is not implemented yet. Keep the
  // recommendation in the copy, but never start a second subscription from a
  // limit toast.
  return null;
}

const BYOK_AI_METRICS = new Set([
  'phraseSelectionWords',
  'llmRequestsPerMonth',
  'wordGlossesPerMonth',
  'phraseTranslationsPerDay',
  'contextTranslationsPerDay',
]);

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString()} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toLocaleString()} KiB`;
  return `${bytes.toLocaleString()} bytes`;
}

export function planLimitUpgradeLine(metric: string, upgrade: PlanUpgradeTarget): string {
  if (upgrade === 'cloud') {
    return BYOK_AI_METRICS.has(metric)
      ? 'Cloud lifts this limit, or you can add your own AI key in Settings.'
      : 'Cloud lifts this limit.';
  }
  if (upgrade === 'plus') return 'Plus lifts this limit.';
  if (upgrade === 'byok' && BYOK_AI_METRICS.has(metric)) {
    return 'Adding your own API key lifts this limit.';
  }
  return '';
}

const LIMIT_COPY: Record<string, { title: string; body: (p: PlanLimitPayload) => string }> = {
  phraseSelectionWords: {
    title: 'Phrase too long for your plan',
    body: (p) => `Phrase lookups are limited to ${p.limit} words on your plan.`,
  },
  journalWordsPerMonth: {
    title: 'Monthly journal limit reached',
    body: (p) =>
      `You've written ${p.used.toLocaleString()} of ${p.limit.toLocaleString()} journal words this month.`,
  },
  llmRequestsPerMonth: {
    title: 'Monthly AI allowance used',
    body: (p) =>
      p.limit === 0
        ? 'Rich AI explanations use Cloud or your own API key.'
        : `You've used this month's ${p.limit.toLocaleString()} AI lookups.`,
  },
  wordGlossesPerMonth: {
    title: 'Monthly managed gloss allowance used',
    body: (p) =>
      `You've used this month's ${p.limit.toLocaleString()} managed dictionary-miss glosses. On-device dictionary lookups still work.`,
  },
  phraseTranslationsPerDay: {
    title: 'Daily phrase allowance used',
    body: (p) =>
      `You've used today's ${p.limit.toLocaleString()} managed phrase translations. It resets at midnight UTC.`,
  },
  contextTranslationsPerDay: {
    title: 'Daily context allowance used',
    body: (p) =>
      `You've used today's ${p.limit.toLocaleString()} in-context translations. It resets at midnight UTC.`,
  },
  ttsCharsPerMonth: {
    title: 'Monthly audio allowance used',
    body: () => 'Text-to-speech falls back to your browser voice for the rest of the month.',
  },
  maxCollections: {
    title: 'Library limit reached',
    body: (p) => `Your plan holds up to ${p.limit.toLocaleString()} collections.`,
  },
  maxLessons: {
    title: 'Library limit reached',
    body: (p) => `Your plan holds up to ${p.limit.toLocaleString()} lessons.`,
  },
  maxCollectionGroups: {
    title: 'Library organisation limit reached',
    body: (p) => `Free includes a fair-use ceiling of ${p.limit.toLocaleString()} groups.`,
  },
  maxVocabEntries: {
    title: 'Saved vocabulary fair-use limit reached',
    body: (p) => `Free holds up to ${p.limit.toLocaleString()} vocabulary entries.`,
  },
  maxKnownWords: {
    title: 'Word-state fair-use limit reached',
    body: (p) => `Free holds up to ${p.limit.toLocaleString()} word states.`,
  },
  maxClozeSentences: {
    title: 'Practice-data fair-use limit reached',
    body: (p) => `Free holds up to ${p.limit.toLocaleString()} practice sentences.`,
  },
  maxAcceptedDictionaryEntries: {
    title: 'Saved gloss fair-use limit reached',
    body: (p) => `Free holds up to ${p.limit.toLocaleString()} accepted dictionary entries.`,
  },
  maxLessonTextBytes: {
    title: 'This lesson is unusually large',
    body: (p) => `A Free lesson can contain up to ${formatBytes(p.limit)} of text.`,
  },
  maxVocabEntryBytes: {
    title: 'This vocabulary entry is unusually large',
    body: (p) => `A Free vocabulary entry can contain up to ${formatBytes(p.limit)} of text.`,
  },
  maxKnownWordBytes: {
    title: 'This word key is unusually large',
    body: (p) => `A Free word key can contain up to ${formatBytes(p.limit)}.`,
  },
  maxClozeEntryBytes: {
    title: 'This practice sentence is unusually large',
    body: (p) => `A Free practice row can contain up to ${formatBytes(p.limit)} of text.`,
  },
  maxGroupNameBytes: {
    title: 'This group name is unusually large',
    body: (p) => `A Free group name can contain up to ${formatBytes(p.limit)}.`,
  },
  maxCollectionMetadataBytes: {
    title: 'This collection metadata is unusually large',
    body: (p) => `Free collection metadata can contain up to ${formatBytes(p.limit)}.`,
  },
  maxJournalEntryBytes: {
    title: 'This journal entry is unusually large',
    body: (p) => `A Free journal entry can contain up to ${formatBytes(p.limit)}.`,
  },
  maxWriteBatchBytes: {
    title: 'This bulk save is unusually large',
    body: (p) => `A Free bulk save can add up to ${formatBytes(p.limit)} at once.`,
  },
  maxLessonTextBytesTotal: {
    title: 'Lesson-text fair-use limit reached',
    body: (p) => `Free stores up to ${formatBytes(p.limit)} of lesson text.`,
  },
  maxVocabTextBytesTotal: {
    title: 'Vocabulary fair-use limit reached',
    body: (p) => `Free stores up to ${formatBytes(p.limit)} of vocabulary text.`,
  },
  maxKnownWordsTextBytesTotal: {
    title: 'Word-state fair-use limit reached',
    body: (p) => `Free stores up to ${formatBytes(p.limit)} of word keys.`,
  },
  maxClozeTextBytesTotal: {
    title: 'Practice-data fair-use limit reached',
    body: (p) => `Free stores up to ${formatBytes(p.limit)} of practice text.`,
  },
  maxAcceptedDictionaryBytesTotal: {
    title: 'Saved gloss fair-use limit reached',
    body: (p) => `Free stores up to ${formatBytes(p.limit)} of accepted dictionary data.`,
  },
  maxJournalTextBytesTotal: {
    title: 'Journal fair-use limit reached',
    body: (p) => `Free stores up to ${formatBytes(p.limit)} of journal text.`,
  },
};

// One prompt per few seconds, app-wide: a burst of limited calls (e.g. a
// failing import loop) must not stack toasts.
let lastToastAt = 0;

export function showPlanLimitToast(payload: PlanLimitPayload): void {
  const now = Date.now();
  if (now - lastToastAt < 5000) return;
  lastToastAt = now;

  const copy = LIMIT_COPY[payload.metric] ?? {
    title: 'Plan limit reached',
    body: () => 'This action is over your plan’s allowance.',
  };
  const upgradeLine = planLimitUpgradeLine(payload.metric, payload.upgrade);
  const action = planLimitAction(payload.upgrade, payload.metric);

  toast.warning(copy.title, {
    description: `${copy.body(payload)} ${upgradeLine}`.trim(),
    action: action
      ? {
          label: action.label,
          onClick: () => {
            window.location.href = action.href;
          },
        }
      : undefined,
    duration: 8000,
  });
}

/**
 * Inspect a 429 response; when it is a plan_limit, show the upsell prompt.
 * Reads a clone so callers can still consume the body. Fire-and-forget.
 */
export function interceptPlanLimit(res: Response): void {
  if (res.status !== 429) return;
  res
    .clone()
    .json()
    .then((body: unknown) => {
      if (body && typeof body === 'object' && (body as { error?: string }).error === 'plan_limit') {
        showPlanLimitToast(body as PlanLimitPayload);
      }
    })
    .catch(() => {
      /* non-JSON 429 — not ours */
    });
}
