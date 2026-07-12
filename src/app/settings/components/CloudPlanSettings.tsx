'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  applyPlanChange,
  createCustomerPortalSession,
  fetchBillingStatus,
  previewPlanChange,
  type BillingMoney,
  type BillingPrice,
  type BillingStatus,
  type PlanChangePreview,
} from '@/lib/billing';
import {
  getEntitlements,
  invalidateEntitlementsCache,
  type ClientEntitlements,
} from '@/lib/data-layer';

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

function priceLabel(price: BillingPrice): string {
  return `${PLAN_LABELS[price.plan]} — ${price.cycle === 'year' ? 'annual' : 'monthly'}`;
}

function formatMoney(money: BillingMoney | null): string | null {
  if (!money) return null;
  const amount = Number(money.amount);
  if (!Number.isFinite(amount)) return null;
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: money.currencyCode,
    });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amount / 10 ** digits);
  } catch {
    return `${money.amount} ${money.currencyCode}`;
  }
}

function billingError(error: string): string {
  if (error === 'subscription_past_due') {
    return 'Update your payment method in Paddle before changing plans.';
  }
  if (error === 'subscription_ambiguous') {
    return 'Paddle found more than one active subscription. Open billing management to resolve it.';
  }
  if (error === 'plan_already_current') return 'That is already your current plan.';
  return 'Paddle could not complete that billing action. Please try again.';
}

export default function CloudPlanSettings() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [entitlements, setEntitlements] = useState<ClientEntitlements | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [selectedPriceId, setSelectedPriceId] = useState('');
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<BillingPrice | null>(null);

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

  const currentSubscription = billing?.management?.subscription ?? null;
  const changes = (billing?.checkout.prices ?? [])
    .filter(
      (price) =>
        !currentSubscription ||
        price.plan !== currentSubscription.plan ||
        price.cycle !== currentSubscription.cycle,
    )
    .sort((a, b) => {
      if (currentSubscription) {
        const aSamePlan = a.plan === currentSubscription.plan ? 0 : 1;
        const bSamePlan = b.plan === currentSubscription.plan ? 0 : 1;
        if (aSamePlan !== bSamePlan) return aSamePlan - bSamePlan;
      }
      if (a.cycle !== b.cycle) return a.cycle === 'year' ? -1 : 1;
      return a.plan.localeCompare(b.plan);
    });
  const effectiveSelectedPriceId = changes.some((price) => price.id === selectedPriceId)
    ? selectedPriceId
    : (changes[0]?.id ?? '');
  const activePreview =
    preview && changes.some((price) => price.id === preview.target.id) ? preview : null;

  useEffect(() => {
    if (!pendingTarget) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (attempt: number) => {
      const nextBilling = await fetchBillingStatus();
      if (cancelled) return;
      if (nextBilling) setBilling(nextBilling);
      const next = nextBilling?.management?.subscription;
      if (next?.plan === pendingTarget.plan && next.cycle === pendingTarget.cycle) {
        invalidateEntitlementsCache();
        const nextEntitlements = await getEntitlements();
        if (cancelled) return;
        if (nextEntitlements) setEntitlements(nextEntitlements);
        setPendingTarget(null);
        toast.success('Your Paddle subscription has been updated');
        return;
      }
      if (attempt < 30) timer = setTimeout(() => void poll(attempt + 1), 2_000);
    };

    timer = setTimeout(() => void poll(1), 2_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pendingTarget]);

  async function openPortal() {
    if (openingPortal) return;
    setOpeningPortal(true);
    const result = await createCustomerPortalSession();
    if (!result.ok) {
      setOpeningPortal(false);
      toast.error(billingError(result.error));
      return;
    }
    window.location.assign(result.value.url);
  }

  async function reviewChange() {
    if (!effectiveSelectedPriceId || previewing) return;
    setPreviewing(true);
    const result = await previewPlanChange(effectiveSelectedPriceId);
    setPreviewing(false);
    if (!result.ok) {
      toast.error(billingError(result.error));
      return;
    }
    setPreview(result.value);
  }

  async function confirmChange() {
    if (!activePreview || applying) return;
    setApplying(true);
    const result = await applyPlanChange(activePreview.target.id);
    setApplying(false);
    if (!result.ok) {
      toast.error(billingError(result.error));
      return;
    }
    setPreview(null);
    setPendingTarget(result.value.target);
    toast.success('Paddle accepted the change. Updating your plan…');
  }

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
            {billing?.management?.customerPortal && (
              <Button type="button" variant="ghost" onClick={openPortal} disabled={openingPortal}>
                {openingPortal ? 'Opening Paddle…' : 'Billing history'}
              </Button>
            )}
          </div>
        </div>
      )}

      {plan && plan !== 'free' && (
        <div className="mt-4 space-y-4 text-sm text-muted-foreground">
          <p>
            Your plan includes larger managed AI allowances and managed voices. Browser voices and
            data export remain available as fallbacks.
          </p>

          {pendingTarget && (
            <p className="rounded-lg border border-border bg-[var(--primary-soft)] p-3 text-foreground">
              Paddle accepted your change to {priceLabel(pendingTarget)}. This page will update as
              soon as the signed webhook arrives.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {billing?.management?.customerPortal && (
              <Button type="button" onClick={openPortal} disabled={openingPortal}>
                {openingPortal ? 'Opening Paddle…' : 'Manage billing'}
              </Button>
            )}
            <span className="text-xs">
              Paddle handles payment methods, invoices, and cancellation securely.
            </span>
          </div>

          {currentSubscription?.canChange && changes.length > 0 && !pendingTarget && (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div>
                <h3 className="font-medium text-foreground">Change plan</h3>
                <p className="mt-1 text-xs">
                  Review Paddle&apos;s tax and proration calculation before confirming.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={effectiveSelectedPriceId}
                  onChange={(event) => {
                    setSelectedPriceId(event.target.value);
                    setPreview(null);
                  }}
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  data-testid="billing-change-price"
                >
                  {changes.map((price) => (
                    <option key={price.id} value={price.id}>
                      {priceLabel(price)}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={reviewChange}
                  disabled={!effectiveSelectedPriceId || previewing}
                  data-testid="billing-change-review"
                >
                  {previewing ? 'Calculating…' : 'Review change'}
                </Button>
              </div>

              {activePreview && (
                <div
                  className="space-y-3 rounded-md bg-muted/40 p-3"
                  data-testid="billing-change-preview"
                >
                  <p className="font-medium text-foreground">
                    Change to {priceLabel(activePreview.target)}
                  </p>
                  <p className="text-xs">
                    {activePreview.prorationBillingMode === 'prorated_immediately'
                      ? 'The plan changes immediately and Paddle applies the prorated charge or credit now.'
                      : 'The plan changes immediately and Paddle applies the prorated adjustment to your next invoice.'}
                  </p>
                  <dl className="grid gap-1 text-xs sm:grid-cols-2">
                    <dt>Due now</dt>
                    <dd className="font-medium text-foreground sm:text-right">
                      {formatMoney(activePreview.immediateCharge) ?? 'No immediate charge'}
                    </dd>
                    <dt>Next invoice</dt>
                    <dd className="font-medium text-foreground sm:text-right">
                      {formatMoney(activePreview.nextCharge) ?? 'Calculated at renewal'}
                    </dd>
                    <dt>Regular renewal</dt>
                    <dd className="font-medium text-foreground sm:text-right">
                      {formatMoney(activePreview.recurringCharge) ?? 'Unavailable'}
                    </dd>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={confirmChange}
                      disabled={applying}
                      data-testid="billing-change-confirm"
                    >
                      {applying ? 'Applying…' : 'Confirm with Paddle'}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setPreview(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentSubscription && !currentSubscription.canChange && (
            <p className="text-xs">
              Plan changes are unavailable while Paddle is processing this subscription. Use billing
              management to update your payment method or review its status.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
