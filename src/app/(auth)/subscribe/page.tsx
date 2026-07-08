'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { initializePaddle, type Paddle } from '@paddle/paddle-js';
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

const PLAN_COPY: Record<BillingPrice['plan'], { name: string; blurb: string }> = {
  cloud: { name: 'Lector Cloud', blurb: 'Managed keys with a monthly usage allowance' },
  plus: { name: 'Cloud Plus', blurb: 'A larger managed allowance, premium models included' },
};

const CYCLE_COPY: Record<BillingPrice['cycle'], string> = {
  month: 'per month',
  year: 'per year — 2 months free',
};

type Phase = 'loading' | 'pick' | 'activating' | 'slow' | 'unavailable';

export default function SubscribePage() {
  const [status, setStatus] = useState<Extract<BillingStatus, { enforced: true }> | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState<string | null>(null);
  const paddleRef = useRef<Paddle | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => () => clearTimeout(pollTimer.current ?? undefined), []);

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

      // Real, tax-aware amounts from Paddle rather than copy that drifts.
      // Purely decorative — a preview failure just leaves the cards unpriced.
      try {
        const preview = await paddle.PricePreview({
          items: prices.map((p) => ({ priceId: p.id, quantity: 1 })),
        });
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const item of preview.data.details.lineItems) {
          next[item.price.id] = item.formattedTotals.total;
        }
        setAmounts(next);
      } catch {
        /* cards render without amounts */
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pollUntilActive]);

  function openCheckout(price: BillingPrice) {
    const paddle = paddleRef.current;
    if (!paddle || !status) return;
    setOpening(price.id);
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
    setOpening(null);
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
        status.checkout.prices.map((price) => (
          <button
            key={price.id}
            type="button"
            onClick={() => openCheckout(price)}
            disabled={opening !== null}
            className="w-full rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-primary"
            data-testid={`subscribe-price-${price.plan}-${price.cycle}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-foreground">{PLAN_COPY[price.plan].name}</span>
              {amounts[price.id] && (
                <span className="text-sm font-medium text-foreground">{amounts[price.id]}</span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {PLAN_COPY[price.plan].blurb} · {CYCLE_COPY[price.cycle]}
            </p>
          </button>
        ))}

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
