import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCurrentUserId } from '../lib/user';
import {
  applyPaddleEvent,
  billingConfig,
  findPaddleCustomerId,
  getUserEmail,
  isEntitledStatus,
  makePaddleTransactionCreator,
  resolveBillingStatus,
  verifyPaddleSignature,
  type CreateTransaction,
} from '../lib/billing';
import { isBillingExempt, isSuspended } from '../lib/account-flags';
import { entitlements, type EntitlementsEngine } from '../lib/entitlements';

const MAX_PADDLE_WEBHOOK_BODY_BYTES = 1024 * 1024;

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
      });
    }

    const email = resolveEmail(userId);
    const exempt =
      (email !== null && cfg.exemptEmails.has(email.toLowerCase())) || isBillingExempt(userId);
    const status = resolveBillingStatus(userId, email);
    const subscriptionActive = isEntitledStatus(status);

    return c.json({
      enforced: true as const,
      accessAllowed: !suspended && (cfg.freeTierEnabled || subscriptionActive || exempt),
      subscriptionActive,
      freeTierEnabled: cfg.freeTierEnabled,
      suspended,
      exempt,
      status: status ?? 'none',
      checkout: { prices: cfg.prices },
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
