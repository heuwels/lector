/**
 * Process-local burst protection for managed translation and URL-extraction
 * work. The production deployment is currently single-instance. A future
 * multi-instance deployment should replace these with shared state; durable
 * translation entitlements remain the authoritative API-spend ceiling.
 */

export type TranslationBurstKind = 'gloss' | 'detail';

export interface TranslationBurstLimiter {
  tryConsume(userId: string, kind: TranslationBurstKind): boolean;
}

interface BurstEntry {
  count: number;
  expiresAt: number;
}

export interface TranslationBurstLimiterOptions {
  now?: () => number;
  windowMs?: number;
  maxKeys?: number;
  glossPerWindow?: number;
  detailPerWindow?: number;
}

export interface ExtractionBurstLimiter {
  tryConsume(userId: string, ip: string | null): boolean;
}

export interface ExtractionBurstLimiterOptions {
  now?: () => number;
  windowMs?: number;
  maxKeys?: number;
  userPerWindow?: number;
  ipPerWindow?: number;
}

/**
 * Fixed-window protection for URL fetch/extraction work. Authenticated users
 * and source IPs have separate ceilings: account rotation cannot bypass the
 * IP ceiling, while one busy account cannot consume another account's share.
 * Missing proxy IP metadata simply falls back to the authenticated-user cap.
 */
export class InMemoryExtractionBurstLimiter implements ExtractionBurstLimiter {
  private readonly entries = new Map<string, BurstEntry>();
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly userPerWindow: number;
  private readonly ipPerWindow: number;

  constructor(options: ExtractionBurstLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.windowMs = options.windowMs ?? 60_000;
    this.maxKeys = options.maxKeys ?? 20_000;
    this.userPerWindow = options.userPerWindow ?? 10;
    this.ipPerWindow = options.ipPerWindow ?? 60;
  }

  tryConsume(userId: string, ip: string | null): boolean {
    const now = this.now();
    this.evictExpired(now);

    const dimensions = [
      { key: `user:${userId}`, limit: this.userPerWindow },
      ...(ip ? [{ key: `ip:${ip}`, limit: this.ipPerWindow }] : []),
    ];

    // Check every dimension before incrementing any of them. A denied IP must
    // not silently burn the user's remaining account allowance (or vice versa).
    for (const { key, limit } of dimensions) {
      if (limit <= 0) return false;
      const entry = this.entries.get(key);
      if (entry && entry.count >= limit) return false;
    }

    const missing = dimensions.filter(({ key }) => !this.entries.has(key)).length;
    // Never evict an active identity to admit a rotating new one: that would
    // turn the memory bound itself into a rate-limit reset primitive.
    if (this.entries.size + missing > this.maxKeys) return false;

    for (const { key } of dimensions) {
      const entry = this.entries.get(key);
      if (entry) entry.count += 1;
      else this.entries.set(key, { count: 1, expiresAt: now + this.windowMs });
    }
    return true;
  }

  /** Visible only for deterministic unit tests. */
  sizeForTests(): number {
    return this.entries.size;
  }

  private evictExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

export class InMemoryTranslationBurstLimiter implements TranslationBurstLimiter {
  private readonly entries = new Map<string, BurstEntry>();
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly limits: Record<TranslationBurstKind, number>;

  constructor(options: TranslationBurstLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.windowMs = options.windowMs ?? 60_000;
    this.maxKeys = options.maxKeys ?? 20_000;
    this.limits = {
      gloss: options.glossPerWindow ?? 30,
      detail: options.detailPerWindow ?? 10,
    };
  }

  tryConsume(userId: string, kind: TranslationBurstKind): boolean {
    const now = this.now();
    this.evictExpired(now);

    const key = `${kind}:${userId}`;
    let entry = this.entries.get(key);
    if (!entry) {
      // Fail closed for previously unseen keys once the hard memory ceiling is
      // reached. Evicting an active key here would let an attacker rotate ids
      // to reset somebody else's burst allowance.
      if (this.entries.size >= this.maxKeys) return false;
      entry = { count: 0, expiresAt: now + this.windowMs };
      this.entries.set(key, entry);
    }

    if (entry.count >= this.limits[kind]) return false;
    entry.count += 1;
    return true;
  }

  /** Visible only for deterministic unit tests. */
  sizeForTests(): number {
    return this.entries.size;
  }

  private evictExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

export const translationBurstLimiter = new InMemoryTranslationBurstLimiter();
export const extractionBurstLimiter = new InMemoryExtractionBurstLimiter();
