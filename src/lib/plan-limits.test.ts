import { describe, expect, it } from 'vitest';
import {
  phraseSelectionLimitPayload,
  planLimitAction,
  planLimitUpgradeLine,
  recommendedUpgrade,
} from './plan-limits';

describe('plan-limit upgrade routing', () => {
  it('routes Free to Cloud and lets Plus use BYOK', () => {
    expect(recommendedUpgrade('free')).toBe('cloud');
    expect(recommendedUpgrade('cloud')).toBe('plus');
    expect(recommendedUpgrade('plus')).toBe('byok');
    expect(recommendedUpgrade('unlimited')).toBeNull();
  });

  it('does not upsell an account already paying with its own key', () => {
    expect(recommendedUpgrade('free', true)).toBeNull();
    expect(recommendedUpgrade('cloud', true)).toBeNull();
  });

  it('only exposes safe navigation targets', () => {
    expect(planLimitAction('cloud')).toEqual({
      label: 'Upgrade to Cloud',
      href: '/subscribe',
    });
    expect(planLimitAction('byok')).toEqual({
      label: 'Add API key',
      href: '/settings#byok',
    });
    expect(planLimitAction('plus')).toBeNull();
    expect(planLimitAction(null)).toBeNull();
  });

  it('offers BYOK only for AI-backed limits', () => {
    expect(planLimitUpgradeLine('wordGlossesPerMonth', 'cloud')).toContain('own AI key');
    expect(planLimitUpgradeLine('ttsCharsPerMonth', 'cloud')).toBe('Cloud lifts this limit.');
    expect(planLimitUpgradeLine('maxCollections', 'cloud')).toBe('Cloud lifts this limit.');
    expect(planLimitUpgradeLine('ttsCharsPerMonth', 'byok')).toBe('');
    expect(planLimitAction('byok', 'ttsCharsPerMonth')).toBeNull();
  });

  it('preflights the Free six-word phrase boundary before a provider call', () => {
    const entitlements = {
      plan: 'free',
      byok: false,
      limits: { phraseSelectionWords: 6 },
    };

    expect(phraseSelectionLimitPayload(entitlements, 6)).toBeNull();
    expect(phraseSelectionLimitPayload(entitlements, 7)).toMatchObject({
      error: 'plan_limit',
      metric: 'phraseSelectionWords',
      limit: 6,
      requested: 7,
      plan: 'free',
      upgrade: 'cloud',
    });
  });
});
