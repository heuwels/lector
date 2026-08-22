'use client';

/**
 * Which Anki transport this browser should use (#241) — a user choice, not a
 * deployment-mode inference:
 *
 *   - 'ankiconnect' — browser→localhost AnkiConnect (src/lib/anki.ts), the
 *     legacy path. Still the selfhost default, so existing installs keep
 *     working. Lector retires this path later.
 *   - 'addon'       — server-side queue + the Lector Sync addon
 *     (src/lib/anki-queue.ts), published on AnkiWeb as add-on 1098736891.
 *     This is the recommended transport. Forced in cloud, where Chrome's
 *     Local Network Access blocks a public HTTPS origin from reaching
 *     loopback. Opt-in for self-hosters (Settings → Anki Integration) who
 *     serve Lector over HTTPS or from another machine, where the same
 *     constraints apply.
 *
 * Selfhost reads the `ankiTransport` setting, failing safe to 'ankiconnect'
 * so existing installs behave exactly as before (plan 010's invariant).
 * 'unknown' while the mode hydrates / the setting loads — callers must not
 * fire AnkiConnect probes until this resolves to 'ankiconnect'.
 */

import { useEffect, useState } from 'react';
import { getSetting } from './data-layer';
import { useLectorMode } from './use-env';

export type AnkiTransport = 'ankiconnect' | 'addon';

export function useAnkiTransport(): AnkiTransport | 'unknown' {
  const mode = useLectorMode();
  const [selfhostChoice, setSelfhostChoice] = useState<AnkiTransport | 'unknown'>('unknown');

  useEffect(() => {
    if (mode !== 'selfhost') return;
    let cancelled = false;
    getSetting<string>('ankiTransport')
      .then((value) => {
        if (!cancelled) setSelfhostChoice(value === 'addon' ? 'addon' : 'ankiconnect');
      })
      .catch(() => {
        if (!cancelled) setSelfhostChoice('ankiconnect');
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  if (mode === 'cloud') return 'addon';
  if (mode === 'unknown') return 'unknown';
  return selfhostChoice;
}
