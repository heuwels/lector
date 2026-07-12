import '../test-guard';
import { describe, test, expect } from 'bun:test';
import {
  ANKI_PROTOCOL_CURRENT,
  AnkiProtocolStep,
  ankiProtocolVerdict,
  downgradeAnkiResponse,
  parseAnkiProtocol,
  upgradeAnkiRequest,
} from './anki-protocol';

// The handshake mechanics (#241 follow-up): header parsing, the 426 verdict
// for below-minimum addons, and transformer folding order. The step registry
// is empty while protocol 1 is current, so folding is exercised with a fake
// registry the way a future protocol bump would populate it.

describe('parseAnkiProtocol', () => {
  test('missing or blank header is the pre-handshake 1.0 addon → protocol 1', () => {
    expect(parseAnkiProtocol(undefined)).toBe(1);
    expect(parseAnkiProtocol(null)).toBe(1);
    expect(parseAnkiProtocol('')).toBe(1);
    expect(parseAnkiProtocol('  ')).toBe(1);
  });

  test('garbage and sub-1 values fall back to protocol 1', () => {
    expect(parseAnkiProtocol('abc')).toBe(1);
    expect(parseAnkiProtocol('0')).toBe(1);
    expect(parseAnkiProtocol('-2')).toBe(1);
  });

  test('numeric versions parse', () => {
    expect(parseAnkiProtocol('1')).toBe(1);
    expect(parseAnkiProtocol('3')).toBe(3);
  });
});

describe('ankiProtocolVerdict', () => {
  test('current protocol passes with the default constants', () => {
    expect(ankiProtocolVerdict(ANKI_PROTOCOL_CURRENT)).toEqual({ ok: true });
  });

  test('below-minimum protocol gets a self-contained 426', () => {
    const verdict = ankiProtocolVerdict(1, 2, 3);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.status).toBe(426);
    expect(verdict.body.code).toBe('addon_outdated');
    expect(verdict.body.minProtocol).toBe(2);
    expect(verdict.body.currentProtocol).toBe(3);
    expect(verdict.body.error).toContain('update');
  });

  test('a supported-but-old protocol still passes', () => {
    expect(ankiProtocolVerdict(2, 2, 3)).toEqual({ ok: true });
  });
});

describe('transformer folding', () => {
  // v1→v2 renames `results` to `items`; v2→v3 wraps them in an envelope.
  const steps: Record<number, AnkiProtocolStep> = {
    1: {
      request: (_path, body) => ({ items: (body as { results: unknown }).results }),
      response: (_path, body) => ({ acked: (body as { count: number }).count }),
    },
    2: {
      request: (_path, body) => ({ envelope: body }),
      response: (_path, body) => ({ count: (body as { modern: number }).modern }),
    },
  };

  test('upgradeAnkiRequest lifts oldest→current in order', () => {
    const lifted = upgradeAnkiRequest(1, '/ack', { results: [1, 2] }, steps, 3);
    expect(lifted).toEqual({ envelope: { items: [1, 2] } });
  });

  test('downgradeAnkiResponse lowers current→addon in reverse order', () => {
    // The generic tracks the current shape; older wire shapes differ by design.
    const lowered = downgradeAnkiResponse(1, '/ack', { modern: 5 } as unknown, steps, 3);
    expect(lowered).toEqual({ acked: 5 });
  });

  test('a same-version addon is identity in both directions', () => {
    const body = { results: [1] };
    expect(upgradeAnkiRequest(3, '/ack', body, steps, 3)).toBe(body);
    const response = { modern: 5 };
    expect(downgradeAnkiResponse(3, '/ack', response, steps, 3)).toBe(response);
  });

  test('gaps in the registry are identity steps', () => {
    expect(upgradeAnkiRequest(1, '/ack', { a: 1 }, {}, 3)).toEqual({ a: 1 });
    expect(downgradeAnkiResponse(1, '/ack', { b: 2 }, {}, 3)).toEqual({ b: 2 });
  });
});
