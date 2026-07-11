// Anki-addon wire-protocol handshake (#241 follow-up). The addon states its
// protocol in the X-Lector-Anki-Protocol request header; requests without the
// header are the pre-handshake 1.0 addon and count as protocol 1. Older-but-
// supported protocols are bridged by per-step transformers so shipped addons
// keep working across wire-shape changes; when a change is too big to bridge,
// raise ANKI_PROTOCOL_MIN and old addons get a 426 whose message they surface
// verbatim. Mirrored by PROTOCOL in anki-addon/lector/api.py — bump together.

export const ANKI_PROTOCOL_CURRENT = 1;
export const ANKI_PROTOCOL_MIN = 1;
export const ANKI_PROTOCOL_HEADER = 'x-lector-anki-protocol';
export const ANKI_PROTOCOL_CURRENT_HEADER = 'x-lector-anki-protocol-current';

declare module 'hono' {
  interface ContextVariableMap {
    ankiProtocol: number;
  }
}

// One entry per protocol step, keyed by the OLDER version: `request` lifts a
// v-shaped request body to v+1, `response` lowers a (v+1)-shaped response body
// back to v. Missing entries are identity. Empty today — protocol 1 is
// current; when protocol 2 changes a shape, add `1: { … }` here instead of
// breaking shipped addons.
export interface AnkiProtocolStep {
  request?: (path: string, body: unknown) => unknown;
  response?: (path: string, body: unknown) => unknown;
}

export const ANKI_PROTOCOL_STEPS: Record<number, AnkiProtocolStep> = {};

export function parseAnkiProtocol(header: string | undefined | null): number {
  if (header === undefined || header === null || header.trim() === '') return 1;
  const version = Number.parseInt(header, 10);
  return Number.isFinite(version) && version >= 1 ? version : 1;
}

export function ankiProtocolVerdict(
  version: number,
  min: number = ANKI_PROTOCOL_MIN,
  current: number = ANKI_PROTOCOL_CURRENT,
):
  | { ok: true }
  | {
      ok: false;
      status: 426;
      body: { error: string; code: string; minProtocol: number; currentProtocol: number };
    } {
  if (version >= min) return { ok: true };
  return {
    ok: false,
    status: 426,
    body: {
      // The addon shows this text to the user — keep it self-contained.
      error:
        'This Lector add-on is too old for this server — update it in Anki (Tools → Add-ons), or reinstall it from the latest Lector release.',
      code: 'addon_outdated',
      minProtocol: min,
      currentProtocol: current,
    },
  };
}

export function upgradeAnkiRequest(
  from: number,
  path: string,
  body: unknown,
  steps: Record<number, AnkiProtocolStep> = ANKI_PROTOCOL_STEPS,
  current: number = ANKI_PROTOCOL_CURRENT,
): unknown {
  let result = body;
  for (let v = from; v < current; v++) {
    const step = steps[v]?.request;
    if (step) result = step(path, result);
  }
  return result;
}

export function downgradeAnkiResponse<T>(
  to: number,
  path: string,
  body: T,
  steps: Record<number, AnkiProtocolStep> = ANKI_PROTOCOL_STEPS,
  current: number = ANKI_PROTOCOL_CURRENT,
): T {
  let result: unknown = body;
  for (let v = current - 1; v >= to; v--) {
    const step = steps[v]?.response;
    if (step) result = step(path, result);
  }
  return result as T;
}
