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
  upgrade: 'plus' | 'byok' | null;
}

const LIMIT_COPY: Record<string, { title: string; body: (p: PlanLimitPayload) => string }> = {
  phraseSelectionWords: {
    title: 'Phrase too long for your plan',
    body: (p) => `Phrase lookups are limited to ${p.limit} words on your plan.`,
  },
  journalWordsPerMonth: {
    title: 'Monthly journal limit reached',
    body: (p) => `You've written ${p.used.toLocaleString()} of ${p.limit.toLocaleString()} journal words this month.`,
  },
  llmRequestsPerMonth: {
    title: 'Monthly AI allowance used',
    body: (p) => `You've used this month's ${p.limit.toLocaleString()} AI lookups.`,
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
  const upgradeLine =
    payload.upgrade === 'plus'
      ? 'Plus lifts this limit.'
      : payload.upgrade === 'byok'
        ? 'Adding your own API key lifts this limit.'
        : '';

  toast.warning(copy.title, {
    description: `${copy.body(payload)} ${upgradeLine}`.trim(),
    action: payload.upgrade
      ? {
          label: 'See plans',
          onClick: () => {
            window.location.href = '/subscribe';
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
      if (
        body &&
        typeof body === 'object' &&
        (body as { error?: string }).error === 'plan_limit'
      ) {
        showPlanLimitToast(body as PlanLimitPayload);
      }
    })
    .catch(() => {
      /* non-JSON 429 — not ours */
    });
}
