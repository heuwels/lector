'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { initializePaddle, type Paddle } from '@paddle/paddle-js';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiUrl } from '@/lib/api-base';
import { authClient } from '@/lib/auth-client';
import { fetchBillingStatus, type BillingPrice, type BillingStatus } from '@/lib/billing';

/**
 * The locked-account screen (#224): pick a plan → Paddle overlay checkout →
 * poll /api/billing/status until the webhook flips the account active → back
 * into the app. Also the #216 lapse contract's other half: a locked account
 * can always export its data or sign out from here.
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
  price: string;
  badge?: string;
  tagline: string;
  features: string[];
  annualNote: string;
  featured: boolean;
}> = [
  {
    plan: 'cloud',
    name: 'Cloud',
    price: '$5',
    badge: 'Beta',
    tagline: "We host it for you — no Docker, no setup. For when you'd rather just read.",
    features: [
      'Fully managed — nothing to install or maintain',
      'Managed translation with a monthly allowance',
      'Automatic backups and updates',
      'Bring-your-own-key toggle lifts caps at the same price',
      'Email support',
    ],
    annualNote: 'or $50/year — two months free',
    featured: true,
  },
  {
    plan: 'plus',
    name: 'Cloud Plus',
    price: '$12',
    tagline: 'For heavy readers who want the whole thing handled.',
    features: [
      'Everything in Cloud',
      'A much larger monthly translation allowance',
      'Priority support',
      'Early access to new language packs',
    ],
    annualNote: 'or ~$120/year — two months free',
    featured: false,
  },
];

type Phase = 'loading' | 'pick' | 'activating' | 'slow' | 'unavailable';

export default function SubscribePage() {
  const [status, setStatus] = useState<Extract<BillingStatus, { enforced: true }> | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [opening, setOpening] = useState<string | null>(null);
  const paddleRef = useRef<Paddle | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Paddle's overlay loads from its CDN, so there's a visible gap between the
  // click and anything appearing — the clicked tile spins until Paddle
  // reports loaded/closed/error (eventCallback below) or this deadline says
  // it never will (e.g. the domain isn't checkout-approved).
  const clearOpening = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
    setOpening(null);
  }, []);

  // One-shot activation poll: the webhook usually lands within seconds of
  // checkout completing; give it 90 before suggesting patience.
  const pollUntilActive = useCallback(() => {
    function tick(attempt: number) {
      pollTimer.current = setTimeout(async () => {
        const s = await fetchBillingStatus();
        if (s?.active) {
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

  useEffect(
    () => () => {
      clearTimeout(pollTimer.current ?? undefined);
      clearTimeout(openTimer.current ?? undefined);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    fetchBillingStatus().then(async (s) => {
      if (cancelled) return;

      // Billing off, already active, or status unreachable → this page has
      // no business rendering; the rest of the app knows better than us.
      if (s === null || !s.enforced || s.active) {
        window.location.replace('/');
        return;
      }

      setStatus(s);
      const { clientToken, environment, prices } = s.checkout;
      if (!clientToken || prices.length === 0) {
        setPhase('unavailable');
        return;
      }

      const paddle = await initializePaddle({
        token: clientToken,
        environment,
        eventCallback: (event) => {
          // Whatever the overlay did — appeared, was dismissed, or failed —
          // the clicked tile's pending spinner is done.
          if (
            event.name === 'checkout.loaded' ||
            event.name === 'checkout.closed' ||
            event.name === 'checkout.error'
          ) {
            clearOpening();
          }
          if (event.name === 'checkout.completed') {
            setPhase('activating');
            pollUntilActive();
          }
        },
      });
      if (cancelled || !paddle) {
        if (!cancelled) setPhase('unavailable');
        return;
      }
      paddleRef.current = paddle;
      setPhase('pick');
    });

    return () => {
      cancelled = true;
    };
  }, [pollUntilActive, clearOpening]);

  function openCheckout(price: BillingPrice) {
    const paddle = paddleRef.current;
    if (!paddle || !status || opening !== null) return;
    setOpening(price.id);
    openTimer.current = setTimeout(() => {
      setOpening(null);
      toast.error("Checkout didn't open. Please try again in a moment.");
    }, 12000);
    paddle.Checkout.open({
      items: [{ priceId: price.id, quantity: 1 }],
      // The webhook matches this account by custom_data first, email second
      // (api/src/lib/billing.ts) — locking the checkout email keeps the
      // fallback aligned too.
      customData: { lectorUserId: status.checkout.userId },
      ...(status.checkout.email
        ? { customer: { email: status.checkout.email } }
        : {}),
      settings: {
        displayMode: 'overlay',
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        ...(status.checkout.email ? { allowLogout: false } : {}),
      },
    });
  }

  async function signOut() {
    await authClient.signOut();
    window.location.replace('/login');
  }

  const lapsed = status !== null && status.status !== 'none';

  return (
    <div className="space-y-4" data-testid="subscribe-panel">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          {lapsed ? 'Your subscription has ended' : 'Subscribe to Lector Cloud'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {lapsed
            ? 'Everything you built is safe and exactly as you left it — renew to pick up where you were.'
            : 'Lector Cloud is a paid service with no free tier. Prefer free? Lector is open source and self-hostable.'}
        </p>
      </div>

      {phase === 'loading' && (
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
        </div>
      )}

      {phase === 'unavailable' && (
        <p className="rounded-lg border border-border bg-[var(--primary-soft)] p-3 text-sm text-foreground">
          Checkout isn&apos;t available right now — please try again in a little while. Your
          account and data are unaffected.
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

      {phase === 'pick' &&
        status !== null &&
        TIERS.map((tier) => {
          const monthly = status.checkout.prices.find(
            (p) => p.plan === tier.plan && p.cycle === 'month',
          );
          const annual = status.checkout.prices.find(
            (p) => p.plan === tier.plan && p.cycle === 'year',
          );
          if (!monthly && !annual) return null;
          const primary = monthly ?? annual!;
          return (
            <div
              key={tier.plan}
              className={`rounded-xl border p-4 ${
                tier.featured ? 'border-primary' : 'border-border'
              }`}
              data-testid={`subscribe-tier-${tier.plan}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{tier.name}</span>
                {tier.badge && (
                  <span className="rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-xs font-medium text-primary">
                    {tier.badge}
                  </span>
                )}
              </div>
              <p className="mt-1">
                <span className="text-2xl font-bold text-foreground">{tier.price}</span>
                <span className="text-sm text-muted-foreground">/month</span>
              </p>
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
                    <span
                      className="h-4 w-4 animate-spin rounded-full border-2 border-background/40 border-t-background"
                      role="status"
                      aria-label="Opening checkout"
                      data-testid="subscribe-price-opening"
                    />
                    Opening checkout…
                  </>
                ) : (
                  `Subscribe — ${tier.price}/month`
                )}
              </Button>
              {annual && monthly && (
                <button
                  type="button"
                  className="mt-2 w-full cursor-pointer text-center text-xs font-medium text-primary hover:underline disabled:cursor-default disabled:opacity-70"
                  disabled={opening !== null}
                  onClick={() => openCheckout(annual)}
                  data-testid={`subscribe-price-${annual.plan}-${annual.cycle}`}
                >
                  {opening === annual.id ? 'Opening checkout…' : tier.annualNote}
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
        <Button type="button" variant="ghost" size="sm" onClick={signOut} data-testid="subscribe-signout">
          Sign out
        </Button>
      </div>
    </div>
  );
}
