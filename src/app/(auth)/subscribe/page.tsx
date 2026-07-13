'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { apiUrl, checkoutUrl } from '@/lib/api-base';
import { authClient } from '@/lib/auth-client';
import { paidPlanFromSearch, type PaidPlan } from '@/lib/auth-return';
import {
  fetchBillingStatus,
  startCheckout,
  type BillingPrice,
  type BillingStatus,
} from '@/lib/billing';

/**
 * The Free upgrade / paid-only recovery screen (#224): pick a plan → the API creates a Paddle
 * transaction → redirect to lector.dev/checkout, where the overlay opens on
 * Paddle's approved domain (app.lector.dev is not approved) → Paddle bounces
 * back here with ?checkout=success → poll /api/billing/status until the webhook
 * marks the subscription active → into the app. Also the #216 lapse contract's
 * other half: a Free or locked account can always export its data or sign out here.
 *
 * Lives in the (auth) route group for the chrome-free shell and the selfhost
 * bounce, but unlike its siblings it REQUIRES a session (AuthGuard treats it
 * as a normal route) — checkout needs to know who it's activating.
 */

/**
 * Plan copy mirrored from lector-site's /pricing tiers (its `tiers` array) —
 * static on purpose: what the tier costs must render even when Paddle is
 * unreachable, and the two surfaces should read identically. If the site
 * copy changes, change this with it. The Paddle `pri_…` ids stay env-config
 * (PADDLE_PRICE_*, api/src/lib/billing.ts) — a tier renders its buy buttons
 * only for the cycles that have one configured.
 */
const TIERS: Array<{
  plan: BillingPrice['plan'];
  name: string;
  monthlyPrice: string;
  annualPrice: string;
  badge?: string;
  tagline: string;
  features: string[];
  featured: boolean;
}> = [
  {
    plan: 'cloud',
    name: 'Cloud',
    monthlyPrice: '$5',
    annualPrice: '$50',
    badge: 'Beta',
    tagline: "We host it for you — no Docker, no setup. For when you'd rather just read.",
    features: [
      'Fully managed — nothing to install or maintain',
      'Larger managed translation allowance and rich AI entries',
      'Managed high-quality voices, with browser voice fallback',
      'More room for texts, vocabulary, and journal writing',
      'Automatic backups and updates',
      'Email support',
    ],
    featured: true,
  },
  {
    plan: 'plus',
    name: 'Cloud Plus',
    monthlyPrice: '$12',
    annualPrice: '$120',
    tagline: 'For heavy readers who want the whole thing handled.',
    features: [
      'Everything in Cloud',
      'A much larger managed AI and voice allowance',
      'Priority support',
      'Early access to new language packs',
    ],
    featured: false,
  },
];

const FREE_FEATURES = [
  'Read starter lessons and texts you import yourself',
  'Save vocabulary, practise it, and sync with Anki',
  'Up to 10 collections, 200 lessons, and 1,000 journal words each month',
  'Unlimited on-device dictionary lookups',
  '1,000 managed dictionary-miss glosses each month',
  '10 simple phrase translations (up to 6 words) each day',
  '10 concise in-context translations each day',
  'Free browser voices for reading and dictation',
  'Bring your own AI key when you want more',
  'Export your learner data at any time',
];

type Phase = 'loading' | 'pick' | 'activating' | 'slow' | 'unavailable' | 'suspended';

export default function SubscribePage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [opening, setOpening] = useState<string | null>(null);
  const [requestedPlan, setRequestedPlan] = useState<PaidPlan | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // One-shot activation poll: the webhook usually lands within seconds of
  // checkout completing; give it 90 before suggesting patience.
  const pollUntilActive = useCallback(() => {
    function tick(attempt: number) {
      pollTimer.current = setTimeout(async () => {
        const s = await fetchBillingStatus();
        if (s?.subscriptionActive) {
          // Hard navigation on purpose — every guard and cache re-evaluates.
          window.location.replace('/');
          return;
        }
        if (attempt >= 45) {
          setPhase('slow');
          return;
        }
        tick(attempt + 1);
      }, 2000);
    }
    tick(0);
  }, []);

  useEffect(() => () => clearTimeout(pollTimer.current ?? undefined), []);

  useEffect(() => {
    let cancelled = false;
    const requested = paidPlanFromSearch(window.location.search);

    fetchBillingStatus().then((s) => {
      if (cancelled) return;

      setRequestedPlan(requested);

      // Billing off, already paid/exempt, or status unreachable → this page
      // has no business rendering; the rest of the app knows better than us.
      // Free access alone is not a reason to redirect: /subscribe doubles as
      // its opt-in upgrade surface.
      if (s === null || !s.enforced) {
        window.location.replace('/');
        return;
      }

      setStatus(s);

      // Suspension is an abuse/security lock, not a billing state. It wins
      // over Free and paid activation so the page cannot offer a misleading
      // "Continue" loop while the API is correctly denying app access.
      if (s.suspended) {
        setPhase('suspended');
        return;
      }

      if (s.subscriptionActive || s.exempt) {
        window.location.replace('/');
        return;
      }

      // Returning from the lector.dev overlay (Paddle's successUrl bounces
      // here): the webhook may not have landed yet, so show activation and
      // poll rather than the tiles the user just used.
      if (new URLSearchParams(window.location.search).get('checkout') === 'success') {
        setPhase('activating');
        pollUntilActive();
        return;
      }

      // Nothing to sell, or nowhere approved to check out → graceful fallback
      // (dev and the e2e billing server run without prices / CHECKOUT_URL).
      if (s.checkout.prices.length === 0 || checkoutUrl() === '') {
        setPhase('unavailable');
        return;
      }

      setPhase('pick');
    });

    return () => {
      cancelled = true;
    };
  }, [pollUntilActive]);

  async function openCheckout(price: BillingPrice) {
    if (opening !== null) return;
    setOpening(price.id);
    const txnId = await startCheckout(price.id);
    if (txnId === null) {
      setOpening(null);
      toast.error("Checkout couldn't be started. Please try again in a moment.");
      return;
    }
    // Hard navigate to the approved-domain checkout page; Paddle opens the
    // overlay for this transaction there and bounces back to ?checkout=success.
    // Pass the current theme so the overlay matches the app; the tenant rides
    // the transaction (custom_data), never the URL.
    const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    window.location.assign(`${checkoutUrl()}?_ptxn=${encodeURIComponent(txnId)}&theme=${theme}`);
  }

  async function signOut() {
    await authClient.signOut();
    window.location.replace('/login');
  }

  const lapsed = status !== null && status.status !== 'none';
  const showFree = status?.freeTierEnabled === true && !status.suspended;
  const paidTiers = requestedPlan
    ? [...TIERS].sort((a, b) => Number(b.plan === requestedPlan) - Number(a.plan === requestedPlan))
    : TIERS;

  return (
    <div className="space-y-4" data-testid="subscribe-panel">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          {status?.suspended
            ? 'Your account is suspended'
            : lapsed
              ? showFree
                ? 'You’re on Lector Free now'
                : 'Your subscription has ended'
              : showFree
                ? 'Choose how you want to learn'
                : 'Subscribe to Lector Cloud'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {status?.suspended
            ? 'App access is paused. You can still export your learner data or sign out below.'
            : lapsed
              ? showFree
                ? 'Your texts, vocabulary, Anki links, and learning history are intact. Keep using the bounded Free plan, or renew for larger managed allowances and voices.'
                : 'Everything you built is safe and exactly as you left it — renew to pick up where you were.'
              : showFree
                ? 'Free is a complete, bounded reading loop. Upgrade when you want more managed AI, richer translations, and managed voices.'
                : 'Lector Cloud is a paid service. Prefer free? Lector is open source and self-hostable.'}
        </p>
      </div>

      {phase === 'loading' && (
        <div className="flex justify-center py-8">
          <Spinner size="lg" label="Loading subscription plans" className="text-primary" />
        </div>
      )}

      {phase === 'unavailable' && (
        <p className="rounded-lg border border-border bg-[var(--primary-soft)] p-3 text-sm text-foreground">
          Checkout isn&apos;t available right now — please try again in a little while. Your account
          and data are unaffected.
        </p>
      )}

      {phase === 'suspended' && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
          If you believe this is a mistake, contact support. No learner data has been deleted.
        </p>
      )}

      {(phase === 'activating' || phase === 'slow') && (
        <div
          className="rounded-lg border border-border bg-[var(--primary-soft)] p-3 text-sm text-foreground"
          data-testid="subscribe-activating"
        >
          {phase === 'activating' ? (
            <p>Payment received — activating your account…</p>
          ) : (
            <p>
              Payment received. Activation is taking longer than usual — this page keeps checking,
              or come back in a few minutes.
            </p>
          )}
        </div>
      )}

      {showFree && phase !== 'loading' && phase !== 'activating' && phase !== 'slow' && (
        <div
          className="rounded-xl border border-border bg-card p-4"
          data-testid="subscribe-tier-free"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-foreground">Free</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Current plan
            </span>
          </div>
          <p className="mt-1">
            <span className="text-2xl font-bold text-foreground">$0</span>
            <span className="text-sm text-muted-foreground"> forever</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Read, look words up, save what you learn, and take your data with you.
          </p>
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {FREE_FEATURES.map((feature) => (
              <li key={feature} className="flex gap-2">
                <span aria-hidden="true" className="text-primary">
                  ✓
                </span>
                {feature}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            className="mt-4 w-full cursor-pointer"
            onClick={() => window.location.replace('/')}
            data-testid="subscribe-continue-free"
          >
            Continue with Free
          </Button>
        </div>
      )}

      {phase === 'pick' &&
        status !== null &&
        paidTiers.map((tier) => {
          const monthly = status.checkout.prices.find(
            (p) => p.plan === tier.plan && p.cycle === 'month',
          );
          const annual = status.checkout.prices.find(
            (p) => p.plan === tier.plan && p.cycle === 'year',
          );
          if (!monthly && !annual) return null;
          const requested = tier.plan === requestedPlan;
          // Annual is the recommended/default action when both cycles exist:
          // pay for ten months and get twelve. An explicit marketing plan
          // intent still selects/sorts the requested tier; it does not make
          // monthly billing the hidden default inside that tier.
          const primary = annual ?? monthly!;
          const secondary = primary.cycle === 'year' ? monthly : annual;
          const primaryCopy =
            primary.cycle === 'year'
              ? requested
                ? `Continue to checkout — ${tier.annualPrice}/year`
                : `Subscribe annually — ${tier.annualPrice}/year`
              : requested
                ? `Continue to checkout — ${tier.monthlyPrice}/month`
                : `Subscribe — ${tier.monthlyPrice}/month`;
          const secondaryCopy =
            secondary?.cycle === 'month'
              ? `or ${tier.monthlyPrice}/month`
              : `or ${tier.annualPrice}/year — two months free`;
          return (
            <div
              key={tier.plan}
              className={`rounded-xl border p-4 ${
                tier.featured || requested ? 'border-primary' : 'border-border'
              }`}
              data-testid={`subscribe-tier-${tier.plan}`}
              data-requested={requested || undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{tier.name}</span>
                <span className="flex items-center gap-1.5">
                  {requested && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                      Selected
                    </span>
                  )}
                  {tier.badge && (
                    <span className="rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-xs font-medium text-primary">
                      {tier.badge}
                    </span>
                  )}
                </span>
              </div>
              <p className="mt-1">
                <span className="text-2xl font-bold text-foreground">{tier.monthlyPrice}</span>
                <span className="text-sm text-muted-foreground">/month</span>
              </p>
              {annual && (
                <p className="mt-1 text-xs font-medium text-primary">
                  {tier.annualPrice}/year — two months free
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{tier.tagline}</p>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden="true" className="text-primary">
                      ✓
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                className="mt-4 w-full cursor-pointer"
                disabled={opening !== null}
                onClick={() => openCheckout(primary)}
                data-testid={`subscribe-price-${primary.plan}-${primary.cycle}`}
              >
                {opening === primary.id ? (
                  <>
                    <Spinner
                      label="Opening checkout"
                      className="text-background"
                      data-testid="subscribe-price-opening"
                    />
                    Opening checkout…
                  </>
                ) : (
                  primaryCopy
                )}
              </Button>
              {secondary && (
                <button
                  type="button"
                  className="mt-2 w-full cursor-pointer text-center text-xs font-medium text-primary hover:underline disabled:cursor-default disabled:opacity-70"
                  disabled={opening !== null}
                  onClick={() => openCheckout(secondary)}
                  data-testid={`subscribe-price-${secondary.plan}-${secondary.cycle}`}
                >
                  {opening === secondary.id ? 'Opening checkout…' : secondaryCopy}
                </button>
              )}
            </div>
          );
        })}

      <div className="flex items-center justify-between border-t border-border pt-4 text-sm">
        <a
          href={apiUrl('/api/data')}
          className="text-primary hover:underline"
          data-testid="subscribe-export"
        >
          Export my data
        </a>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={signOut}
          data-testid="subscribe-signout"
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
