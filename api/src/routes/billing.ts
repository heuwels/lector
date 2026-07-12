import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCurrentUserId } from '../lib/user';
import {
  applyPaddleEvent,
  billingConfig,
  findBillingSubscriptions,
  findPaddleCustomerId,
  getUserEmail,
  isEntitledStatus,
  makePaddleTransactionCreator,
  resolveBillingStatus,
  verifyPaddleSignature,
  type BillingPrice,
  type BillingSubscriptionRecord,
  type CreateTransaction,
} from '../lib/billing';
import { isBillingExempt, isSuspended } from '../lib/account-flags';
import { entitlements, type EntitlementsEngine } from '../lib/entitlements';
import {
  makePaddleBillingOperations,
  PaddleBillingError,
  type PaddleBillingOperations,
  type ProrationBillingMode,
} from '../lib/paddle-billing';

const MAX_PADDLE_WEBHOOK_BODY_BYTES = 1024 * 1024;
const MAX_BILLING_ACTION_BODY_BYTES = 4 * 1024;

function accountManagementSubscription(
  rows: readonly BillingSubscriptionRecord[],
): BillingSubscriptionRecord | null {
  const entitled = rows.filter((row) => isEntitledStatus(row.status));
  return entitled.length === 1 ? entitled[0] : null;
}

function portalAccount(rows: readonly BillingSubscriptionRecord[]): {
  customerId: string;
  subscriptionIds: string[];
} | null {
  const preferred = rows.find((row) => isEntitledStatus(row.status)) ?? rows[0];
  if (!preferred) return null;
  return {
    customerId: preferred.paddleCustomerId,
    subscriptionIds: rows
      .filter((row) => row.paddleCustomerId === preferred.paddleCustomerId)
      .map((row) => row.paddleSubscriptionId),
  };
}

function prorationMode(current: BillingPrice, target: BillingPrice): ProrationBillingMode {
  if (current.cycle !== target.cycle) return 'prorated_immediately';
  if (current.plan === 'plus' && target.plan === 'cloud') {
    return 'prorated_next_billing_period';
  }
  return 'prorated_immediately';
}

/**
 * Route factory (mirrors makeSessionMiddleware/makePatMiddleware): the prod
 * export binds the env-resolved billingConfig; tests bind their own. The
 * Paddle transaction creator is a seam too, so /checkout route tests never
 * touch the network.
 */
export function makeBillingRoutes(
  cfg: typeof billingConfig,
  resolveEmail: (userId: string) => string | null = getUserEmail,
  createTransaction: CreateTransaction = makePaddleTransactionCreator(cfg),
  engine: EntitlementsEngine = entitlements,
  checkSuspended: (userId: string) => boolean = isSuspended,
  billingOperations: PaddleBillingOperations = makePaddleBillingOperations(cfg),
) {
  const app = new Hono();

  // GET /api/billing/entitlements — the client's read of the plan-limits
  // engine (#222): which plan, its limit values, and this month's usage.
  // Informational only — enforcement stays in the routes. Gate-exempt like
  // the rest of /api/billing; when Free is enabled an unsubscribed account
  // sees its derived Free limits.
  app.get('/entitlements', (c) => {
    const userId = getCurrentUserId(c);
    const resolved = engine.resolveEntitlements(userId);
    const periods = engine.currentPeriods();
    return c.json({
      plan: resolved.plan,
      byok: resolved.byok,
      limits: resolved.limits,
      usage: {
        journalWordsPerMonth: engine.getUsage(userId, 'journalWordsPerMonth', periods),
        llmRequestsPerMonth: engine.getUsage(userId, 'llmRequestsPerMonth', periods),
        ttsCharsPerMonth: engine.getUsage(userId, 'ttsCharsPerMonth', periods),
        wordGlossesPerMonth: engine.getUsage(userId, 'wordGlossesPerMonth', periods),
        phraseTranslationsPerDay: engine.getUsage(userId, 'phraseTranslationsPerDay', periods),
        contextTranslationsPerDay: engine.getUsage(userId, 'contextTranslationsPerDay', periods),
      },
      periods,
    });
  });

  // GET /api/billing/status — what the UI gates on (#224). Session-authed
  // like every /api route (and deliberately absent from the PAT SCOPE_MAP:
  // billing is a browser concern, a token has no business reading it).
  // Exempt from the billing gate itself, so a locked account can render
  // /subscribe: the screen needs the plan `prices` to render its tiers and
  // polls `subscriptionActive` afterwards until the webhook lands. Checkout no longer
  // opens here — POST /checkout creates it and the overlay opens on
  // lector.dev (app.lector.dev is not a Paddle-approved checkout domain).
  app.get('/status', (c) => {
    const userId = getCurrentUserId(c);
    const suspended = checkSuspended(userId);
    if (!cfg.enforced) {
      return c.json({
        enforced: false as const,
        accessAllowed: !suspended,
        subscriptionActive: false,
        freeTierEnabled: false,
        suspended,
        status: 'none',
        exempt: false,
        checkout: { prices: cfg.prices },
        management: { customerPortal: false, subscription: null },
      });
    }

    const email = resolveEmail(userId);
    const exempt =
      (email !== null && cfg.exemptEmails.has(email.toLowerCase())) || isBillingExempt(userId);
    const status = resolveBillingStatus(userId, email);
    const subscriptionActive = isEntitledStatus(status);
    const rows = findBillingSubscriptions(userId, email);
    const subscription = accountManagementSubscription(rows);
    const currentPrice = subscription
      ? cfg.prices.find((price) => price.id === subscription.priceId)
      : undefined;

    return c.json({
      enforced: true as const,
      accessAllowed: !suspended && (cfg.freeTierEnabled || subscriptionActive || exempt),
      subscriptionActive,
      freeTierEnabled: cfg.freeTierEnabled,
      suspended,
      exempt,
      status: status ?? 'none',
      checkout: { prices: cfg.prices },
      management: {
        customerPortal: rows.length > 0,
        subscription:
          subscription && currentPrice
            ? {
                plan: currentPrice.plan,
                cycle: currentPrice.cycle,
                canChange: subscription.status === 'active',
              }
            : null,
      },
    });
  });

  // POST /api/billing/checkout — start a subscription (#224). Session-authed
  // and gate-exempt (a locked account must be able to subscribe). Creates a
  // Paddle transaction stamped with this tenant in custom_data, then returns
  // its id; the browser redirects to lector.dev/checkout?_ptxn=<id>, where the
  // overlay opens on the approved domain. Grants nothing on its own —
  // activation still comes from the webhook. 404 when billing/apiKey are off,
  // mirroring the webhook (this deployment can't do checkout at all).
  app.post('/checkout', async (c) => {
    if (!cfg.enforced || !cfg.apiKey) {
      return c.json({ error: 'Billing is not enabled on this deployment' }, 404);
    }

    const userId = getCurrentUserId(c);

    let body: { priceId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON body' }, 400);
    }
    const priceId = typeof body.priceId === 'string' ? body.priceId : '';
    // Only a price this deployment actually offers — never forward an
    // arbitrary id to Paddle (nor let a client bill itself for some other
    // catalog price).
    if (!cfg.prices.some((p) => p.id === priceId)) {
      return c.json({ error: 'Unknown price' }, 400);
    }

    const email = resolveEmail(userId);
    if (isEntitledStatus(resolveBillingStatus(userId, email))) {
      return c.json({ error: 'subscription_already_active' }, 409);
    }
    try {
      const txn = await createTransaction({
        priceId,
        userId,
        customerId: findPaddleCustomerId(email),
      });
      return c.json({ txnId: txn.id });
    } catch (err) {
      // Paddle down / bad key / rejected price — the /subscribe screen turns a
      // non-2xx into its "try again" state; nothing is charged.
      console.error(`[billing] checkout create failed: ${(err as Error).message}`);
      return c.json({ error: 'checkout_unavailable' }, 502);
    }
  });

  // POST /api/billing/portal — mint a short-lived Paddle-hosted customer
  // portal link for invoices, payment methods, and cancellation. Customer and
  // subscription ids come only from the signed webhook mirror; the browser
  // supplies no redirect or Paddle identifier.
  app.post('/portal', async (c) => {
    if (!cfg.enforced || !cfg.apiKey) {
      return c.json({ error: 'Billing is not enabled on this deployment' }, 404);
    }
    const userId = getCurrentUserId(c);
    const account = portalAccount(findBillingSubscriptions(userId, resolveEmail(userId)));
    if (!account) return c.json({ error: 'billing_account_not_found' }, 409);
    try {
      const url = await billingOperations.createPortalSession(account);
      c.header('Cache-Control', 'no-store');
      return c.json({ url });
    } catch (error) {
      const code = error instanceof PaddleBillingError ? error.code : 'unknown';
      console.error(`[billing] portal session failed: ${code}`);
      return c.json({ error: 'customer_portal_unavailable' }, 502);
    }
  });

  function planChangeContext(
    userId: string,
    targetPriceId: string,
  ):
    | {
        subscription: BillingSubscriptionRecord;
        current: BillingPrice;
        target: BillingPrice;
        prorationBillingMode: ProrationBillingMode;
      }
    | { error: string; status: 400 | 409 } {
    const target = cfg.prices.find((price) => price.id === targetPriceId);
    if (!target) return { error: 'unknown_price', status: 400 };

    const rows = findBillingSubscriptions(userId, resolveEmail(userId));
    const entitled = rows.filter((row) => isEntitledStatus(row.status));
    if (entitled.length === 0) return { error: 'subscription_not_active', status: 409 };
    if (entitled.length !== 1) return { error: 'subscription_ambiguous', status: 409 };

    const subscription = entitled[0];
    if (subscription.status !== 'active') {
      return {
        error: subscription.status === 'past_due' ? 'subscription_past_due' : 'subscription_busy',
        status: 409,
      };
    }
    const current = cfg.prices.find((price) => price.id === subscription.priceId);
    if (!current) return { error: 'subscription_price_unmanaged', status: 409 };
    if (current.id === target.id) return { error: 'plan_already_current', status: 409 };

    return {
      subscription,
      current,
      target,
      prorationBillingMode: prorationMode(current, target),
    };
  }

  async function targetPriceId(c: Context) {
    const body = (await c.req.json().catch(() => ({}))) as { priceId?: unknown };
    return typeof body.priceId === 'string' ? body.priceId : '';
  }

  const actionBodyLimit = bodyLimit({
    maxSize: MAX_BILLING_ACTION_BODY_BYTES,
    onError: (c) => c.json({ error: 'Billing request is too large' }, 413),
  });

  // Preview and apply are deliberately separate. Paddle computes tax and
  // proration; the client confirms that preview, then this route recomputes
  // the complete item list before applying. The webhook remains the only
  // writer of local entitlement state.
  app.post('/change/preview', actionBodyLimit, async (c) => {
    if (!cfg.enforced || !cfg.apiKey) {
      return c.json({ error: 'Billing is not enabled on this deployment' }, 404);
    }
    const context = planChangeContext(getCurrentUserId(c), await targetPriceId(c));
    if ('error' in context) return c.json({ error: context.error }, context.status);
    try {
      const preview = await billingOperations.previewSubscriptionChange({
        subscriptionId: context.subscription.paddleSubscriptionId,
        targetPriceId: context.target.id,
        managedPriceIds: cfg.prices.map((price) => price.id),
        prorationBillingMode: context.prorationBillingMode,
      });
      return c.json({
        target: context.target,
        prorationBillingMode: context.prorationBillingMode,
        ...preview,
      });
    } catch (error) {
      if (error instanceof PaddleBillingError && error.code === 'already_current') {
        return c.json({ error: 'plan_already_current' }, 409);
      }
      const code = error instanceof PaddleBillingError ? error.code : 'unknown';
      console.error(`[billing] subscription preview failed: ${code}`);
      return c.json({ error: 'subscription_change_unavailable' }, 502);
    }
  });

  app.post('/change', actionBodyLimit, async (c) => {
    if (!cfg.enforced || !cfg.apiKey) {
      return c.json({ error: 'Billing is not enabled on this deployment' }, 404);
    }
    const context = planChangeContext(getCurrentUserId(c), await targetPriceId(c));
    if ('error' in context) return c.json({ error: context.error }, context.status);
    try {
      await billingOperations.applySubscriptionChange({
        subscriptionId: context.subscription.paddleSubscriptionId,
        targetPriceId: context.target.id,
        managedPriceIds: cfg.prices.map((price) => price.id),
        prorationBillingMode: context.prorationBillingMode,
      });
      return c.json({ accepted: true, target: context.target }, 202);
    } catch (error) {
      if (error instanceof PaddleBillingError && error.code === 'already_current') {
        return c.json({ error: 'plan_already_current' }, 409);
      }
      const code = error instanceof PaddleBillingError ? error.code : 'unknown';
      console.error(`[billing] subscription change failed: ${code}`);
      return c.json({ error: 'subscription_change_unavailable' }, 502);
    }
  });

  // POST /api/billing/webhook — Paddle's notification destination. Reachable
  // without a session (carved out in lib/session.ts): the HMAC signature
  // over the raw body IS the credential. Paddle treats any non-2xx as
  // retryable, so: bad signature → 401 (a misconfiguration — retries keep
  // failing and surface in Paddle's delivery log), unparseable body → 400,
  // applied/stale/irrelevant → 200 (nothing to retry).
  app.post(
    '/webhook',
    bodyLimit({
      maxSize: MAX_PADDLE_WEBHOOK_BODY_BYTES,
      onError: (c) => c.json({ error: 'Webhook payload is too large' }, 413),
    }),
    async (c) => {
      const secret = cfg.webhookSecret;
      if (!cfg.enforced || !secret) {
        return c.json({ error: 'Billing is not enabled on this deployment' }, 404);
      }

      // bodyLimit either leaves the original Request intact (Content-Length)
      // or reconstructs it byte-for-byte after streaming. Reading text here
      // therefore preserves Paddle's raw-body signature contract.
      const rawBody = await c.req.text();
      if (!verifyPaddleSignature(rawBody, c.req.header('Paddle-Signature'), secret)) {
        return c.json({ error: 'Invalid signature' }, 401);
      }

      let event: unknown;
      try {
        event = JSON.parse(rawBody);
      } catch {
        return c.json({ error: 'Malformed JSON body' }, 400);
      }

      const applied = applyPaddleEvent(event as Parameters<typeof applyPaddleEvent>[0]);
      const type = (event as { event_type?: string }).event_type ?? 'unknown';
      console.log(`[billing] webhook ${type}: ${applied}`);
      return c.json({ ok: true, applied });
    },
  );

  return app;
}

/** The prod routes, bound to the resolved billing config. */
export default makeBillingRoutes(billingConfig);
