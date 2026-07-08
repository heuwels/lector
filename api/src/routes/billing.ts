import { Hono } from 'hono';
import { getCurrentUserId } from '../lib/user';
import {
  applyPaddleEvent,
  billingConfig,
  getUserEmail,
  isEntitledStatus,
  resolveBillingStatus,
  verifyPaddleSignature,
} from '../lib/billing';

/**
 * Route factory (mirrors makeSessionMiddleware/makePatMiddleware): the prod
 * export binds the env-resolved billingConfig; tests bind their own.
 */
export function makeBillingRoutes(
  cfg: typeof billingConfig,
  resolveEmail: (userId: string) => string | null = getUserEmail,
) {
  const app = new Hono();

  // GET /api/billing/status — what the UI gates on (#224). Session-authed
  // like every /api route (and deliberately absent from the PAT SCOPE_MAP:
  // billing is a browser concern, a token has no business reading it).
  // Exempt from the billing gate itself, so a locked account can render
  // /subscribe: the screen needs `checkout` (Paddle client token + price ids
  // + who to bill) to open the overlay, and polls `active` afterwards until
  // the webhook lands.
  app.get('/status', (c) => {
    if (!cfg.enforced) {
      return c.json({ enforced: false as const, active: true });
    }

    const userId = getCurrentUserId(c);
    const email = resolveEmail(userId);
    const exempt = email !== null && cfg.exemptEmails.has(email.toLowerCase());
    const status = resolveBillingStatus(userId, email);

    return c.json({
      enforced: true as const,
      active: exempt || isEntitledStatus(status),
      exempt,
      status: status ?? 'none',
      checkout: {
        clientToken: cfg.clientToken ?? null,
        environment: cfg.environment,
        prices: cfg.prices,
        email,
        userId,
      },
    });
  });

  // POST /api/billing/webhook — Paddle's notification destination. Reachable
  // without a session (carved out in lib/session.ts): the HMAC signature
  // over the raw body IS the credential. Paddle treats any non-2xx as
  // retryable, so: bad signature → 401 (a misconfiguration — retries keep
  // failing and surface in Paddle's delivery log), unparseable body → 400,
  // applied/stale/irrelevant → 200 (nothing to retry).
  app.post('/webhook', async (c) => {
    const secret = cfg.webhookSecret;
    if (!cfg.enforced || !secret) {
      return c.json({ error: 'Billing is not enabled on this deployment' }, 404);
    }

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
  });

  return app;
}

/** The prod routes, bound to the resolved billing config. */
export default makeBillingRoutes(billingConfig);
