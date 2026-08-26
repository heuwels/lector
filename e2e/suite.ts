// Specs that need the extra Hono servers or fixture packs. The Docker pass
// skips them (E2E_EXTERNAL_SERVER). e2e-tests runs only this list.
export const CLOUD_ONLY_SPECS = [
  'account-deletion-cloud.spec.ts',
  'admin-cloud.spec.ts',
  'auth-cloud.spec.ts',
  'billing-cloud.spec.ts',
  'free-tier-cloud.spec.ts',
  'onboarding.spec.ts',
  'plan-limits-cloud.spec.ts',
  'starter-content.spec.ts',
  'two-factor.spec.ts',
  'two-user-isolation.spec.ts',
  'youtube-transcript.spec.ts',
] as const;

export const isCloudSuite = process.env.E2E_SUITE === 'cloud';

export function e2eSuite(): 'cloud' | 'selfhost' | 'all' {
  if (isCloudSuite) return 'cloud';
  if (process.env.E2E_EXTERNAL_SERVER) return 'selfhost';
  return 'all';
}
