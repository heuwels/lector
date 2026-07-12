import { describe, expect, test } from 'bun:test';
import { InMemoryExtractionBurstLimiter, InMemoryTranslationBurstLimiter } from './rate-limit';

describe('InMemoryExtractionBurstLimiter', () => {
  test('enforces per-user limits without coupling accounts on the same IP', () => {
    const limiter = new InMemoryExtractionBurstLimiter({
      userPerWindow: 2,
      ipPerWindow: 10,
    });

    expect(limiter.tryConsume('alice', '203.0.113.7')).toBe(true);
    expect(limiter.tryConsume('alice', '203.0.113.7')).toBe(true);
    expect(limiter.tryConsume('alice', '203.0.113.7')).toBe(false);
    expect(limiter.tryConsume('bob', '203.0.113.7')).toBe(true);
  });

  test('enforces an IP ceiling across rotating accounts without partial consumption', () => {
    const limiter = new InMemoryExtractionBurstLimiter({
      userPerWindow: 2,
      ipPerWindow: 2,
    });

    expect(limiter.tryConsume('alice', '203.0.113.7')).toBe(true);
    expect(limiter.tryConsume('bob', '203.0.113.7')).toBe(true);
    expect(limiter.tryConsume('carol', '203.0.113.7')).toBe(false);

    // The denied IP dimension did not burn Carol's user allowance.
    expect(limiter.tryConsume('carol', '203.0.113.8')).toBe(true);
    expect(limiter.tryConsume('carol', '203.0.113.8')).toBe(true);
    expect(limiter.tryConsume('carol', '203.0.113.8')).toBe(false);
  });

  test('falls back to the user key when proxy IP metadata is unavailable', () => {
    const limiter = new InMemoryExtractionBurstLimiter({ userPerWindow: 1 });
    expect(limiter.tryConsume('alice', null)).toBe(true);
    expect(limiter.tryConsume('alice', null)).toBe(false);
    expect(limiter.tryConsume('bob', null)).toBe(true);
  });

  test('a zero allowance fails closed without allocating identity keys', () => {
    const limiter = new InMemoryExtractionBurstLimiter({ userPerWindow: 0 });
    expect(limiter.tryConsume('alice', '203.0.113.7')).toBe(false);
    expect(limiter.sizeForTests()).toBe(0);
  });

  test('bounds active keys, fails closed, and admits new identities after expiry', () => {
    let now = 0;
    const limiter = new InMemoryExtractionBurstLimiter({
      now: () => now,
      windowMs: 10,
      maxKeys: 2,
    });

    // One user + one IP consumes both bounded key slots.
    expect(limiter.tryConsume('alice', '203.0.113.7')).toBe(true);
    expect(limiter.sizeForTests()).toBe(2);
    expect(limiter.tryConsume('bob', null)).toBe(false);
    expect(limiter.sizeForTests()).toBe(2);

    now = 10;
    expect(limiter.tryConsume('bob', null)).toBe(true);
    expect(limiter.sizeForTests()).toBe(1);
  });
});

describe('InMemoryTranslationBurstLimiter', () => {
  test('enforces independent gloss and detail bursts and resets after the window', () => {
    let now = 1_000;
    const limiter = new InMemoryTranslationBurstLimiter({
      now: () => now,
      windowMs: 60_000,
      glossPerWindow: 2,
      detailPerWindow: 1,
    });

    expect(limiter.tryConsume('a', 'gloss')).toBe(true);
    expect(limiter.tryConsume('a', 'gloss')).toBe(true);
    expect(limiter.tryConsume('a', 'gloss')).toBe(false);
    expect(limiter.tryConsume('a', 'detail')).toBe(true);
    expect(limiter.tryConsume('a', 'detail')).toBe(false);

    now += 60_000;
    expect(limiter.tryConsume('a', 'gloss')).toBe(true);
    expect(limiter.tryConsume('a', 'detail')).toBe(true);
  });

  test('evicts expired account keys', () => {
    let now = 0;
    const limiter = new InMemoryTranslationBurstLimiter({
      now: () => now,
      windowMs: 10,
      maxKeys: 2,
    });

    expect(limiter.tryConsume('a', 'gloss')).toBe(true);
    expect(limiter.tryConsume('b', 'gloss')).toBe(true);
    expect(limiter.sizeForTests()).toBe(2);

    now = 10;
    expect(limiter.tryConsume('c', 'gloss')).toBe(true);
    expect(limiter.sizeForTests()).toBe(1);
  });

  test('fails closed for new keys at the hard memory ceiling', () => {
    const limiter = new InMemoryTranslationBurstLimiter({ maxKeys: 1 });
    expect(limiter.tryConsume('a', 'gloss')).toBe(true);
    expect(limiter.tryConsume('b', 'gloss')).toBe(false);
    expect(limiter.sizeForTests()).toBe(1);
  });
});
