/**
 * Impersonation status (#320) — the one endpoint the client reads to render the
 * "Impersonating <email> — Exit" banner and to pick its effective tenant.
 *
 * Deliberately NOT under requireAdmin: it's mounted at /api/impersonation/*,
 * which the identity-swap middleware treats as a control plane (never swapped),
 * so `getCurrentUserId` here is the operator's REAL id — the actor a grant is
 * keyed by. Non-admins simply have no grant and get { active: false }, so the
 * client can probe it for everyone without provoking 403s.
 *
 * Starting/stopping impersonation lives on the admin router (requireAdmin); this
 * is read-only state.
 */
import { Hono } from 'hono';
import { getCurrentUserId } from '../lib/user';
import { activeImpersonation } from '../lib/impersonation';

const app = new Hono();

// GET /api/impersonation/status — the caller's active grant, or inactive.
app.get('/status', (c) => {
  const actorUserId = getCurrentUserId(c);
  const grant = activeImpersonation(actorUserId);
  if (!grant) return c.json({ active: false });
  return c.json({
    active: true,
    targetUserId: grant.targetUserId,
    targetEmail: grant.targetEmail,
    expiresAt: grant.expiresAt,
  });
});

export default app;
