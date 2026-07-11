'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchBillingStatus, type BillingStatus } from '@/lib/billing';
import { getEntitlements, type ClientEntitlements } from '@/lib/data-layer';

const PLAN_LABELS: Record<ClientEntitlements['plan'], string> = {
  free: 'Free',
  cloud: 'Cloud',
  plus: 'Cloud Plus',
  unlimited: 'Unlimited',
};

function limitLabel(value: number | null | undefined, fallback: string): string {
  if (value === null) return 'unlimited';
  if (typeof value === 'number') return value.toLocaleString();
  return fallback;
}

export default function CloudPlanSettings() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [entitlements, setEntitlements] = useState<ClientEntitlements | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchBillingStatus(), getEntitlements()]).then(
      ([nextBilling, nextEntitlements]) => {
        if (cancelled) return;
        setBilling(nextBilling);
        setEntitlements(nextEntitlements);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const plan = entitlements?.plan;
  const lapsed =
    plan === 'free' && billing !== null && !billing.subscriptionActive && billing.status !== 'none';

  return (
    <section id="plan" className="panel p-6" data-testid="cloud-plan-settings">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Lector plan</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {plan ? `${PLAN_LABELS[plan]} is active for this account.` : 'Loading your plan…'}
          </p>
        </div>
        {plan && (
          <div className="flex flex-wrap justify-end gap-2">
            <span className="rounded-full bg-[var(--primary-soft)] px-3 py-1 text-xs font-semibold text-primary">
              {PLAN_LABELS[plan]}
            </span>
            {entitlements.byok && (
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                Own AI key
              </span>
            )}
          </div>
        )}
      </div>

      {entitlements && plan === 'free' && (
        <div className="mt-4 space-y-3 text-sm text-muted-foreground">
          {lapsed && (
            <p className="rounded-lg border border-border bg-[var(--primary-soft)] p-3 text-foreground">
              Your paid subscription ended, so the account moved to Free. Your texts, saved
              vocabulary, Anki links, history, and exports are all still here.
            </p>
          )}
          <p>
            Free keeps the whole learning loop: starter and imported texts, phrase-aware lookups,
            saved vocabulary, practice, Anki sync, and portable data.
          </p>
          <p className="text-xs">
            Library allowance: {limitLabel(entitlements.limits.maxCollections, '10')} collections,{' '}
            {limitLabel(entitlements.limits.maxLessons, '200')} lessons, and{' '}
            {limitLabel(entitlements.limits.journalWordsPerMonth, '1,000')} journal words each
            month. Existing data is never deleted when a paid plan ends.
          </p>
          <p className="text-xs">
            Generous fair-use safeguards apply to unusually large individual texts and bulk
            saved-data growth. They do not remove existing learner data or block exports.
          </p>
          {entitlements.byok ? (
            <p className="text-xs">
              Your own AI key is active, so translations and rich AI actions use your provider
              instead of Lector&apos;s managed allowance. Free library and journal limits still
              apply, and audio stays on your browser voice.
            </p>
          ) : (
            <p className="text-xs">
              Managed allowance: {limitLabel(entitlements.limits.wordGlossesPerMonth, '1,000')}{' '}
              dictionary-miss glosses each month,{' '}
              {limitLabel(entitlements.limits.phraseTranslationsPerDay, '10')} simple phrases and{' '}
              {limitLabel(entitlements.limits.contextTranslationsPerDay, '10')} in-context
              translations each day. On-device dictionary lookups and browser voices remain free.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="button" onClick={() => (window.location.href = '/subscribe')}>
              Compare paid plans
            </Button>
            <a href="#byok" className="text-sm font-medium text-primary hover:underline">
              Or bring your own AI key
            </a>
          </div>
        </div>
      )}

      {plan && plan !== 'free' && (
        <p className="mt-4 text-sm text-muted-foreground">
          Your plan includes larger managed AI allowances and managed voices. Browser voices and
          data export remain available as fallbacks.
        </p>
      )}
    </section>
  );
}
