import { Button } from '@/components/ui/button';
import { getDeckNames, isAnkiConnected, refreshAnkiUrl } from '@/lib/anki';
import { type AnkiTransport, useAnkiTransport } from '@/lib/anki-transport';
import { apiBase } from '@/lib/api-base';
import { getSetting, setSetting } from '@/lib/data-layer';
import { useLectorMode } from '@/lib/use-env';
import { useCallback, useEffect, useState } from 'react';
import { SETTINGS_KEYS } from '../../constants';

/**
 * Two transports (#241), chosen by the user — not inferred from deployment:
 *
 *   - AnkiConnect: browser→localhost, the selfhost default (today's app).
 *   - Lector Sync add-on: server-side queue, pulled from inside Anki. The
 *     only transport that works from a hosted page (Chrome's Local Network
 *     Access blocks public HTTPS → loopback), so cloud locks to it; a
 *     self-hoster can opt in when their Lector is HTTPS or on another box —
 *     the same browser constraints bite there.
 */

/** Setup instructions for the Lector Sync addon — shared by both modes. */
function AnkiAddonBody() {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        The add-on syncs from inside Anki itself, so it works no matter where this Lector runs:
        words you queue become cards the next time Anki opens, and your review results flow back
        automatically.
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
        <li>
          Create an API token in <span className="font-medium">API Tokens</span> below, scoped to{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">anki</code>.
        </li>
        <li>
          Install the add-on from{' '}
          <a
            className="text-primary underline underline-offset-2"
            href="https://github.com/heuwels/lector/tree/master/anki-addon"
            target="_blank"
            rel="noreferrer"
          >
            anki-addon in the Lector repository
          </a>{' '}
          (Anki Desktop 2.1.50+).
        </li>
        <li>
          In Anki, open Tools → Add-ons → Lector Sync → Config and set{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">api_url</code> to the address below
          and <code className="rounded bg-muted px-1 py-0.5 text-xs">api_token</code> to your token.
        </li>
      </ol>
      <div>
        <label className="block text-sm font-medium text-foreground">API URL</label>
        <input
          type="text"
          readOnly
          value={apiBase()}
          data-testid="anki-addon-api-url"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        AnkiDroid and AnkiMobile can&apos;t run add-ons — sync on desktop and AnkiWeb carries the
        results to your devices.
      </p>
    </>
  );
}

export default function AnkiSettings() {
  const mode = useLectorMode();
  const resolvedTransport = useAnkiTransport();
  // The saved choice loads async; a click wins immediately over it.
  const [transportOverride, setTransportOverride] = useState<AnkiTransport | null>(null);
  const transport = transportOverride ?? resolvedTransport;

  const [ankiClozeDeckName, setAnkiClozeDeckName] = useState('');
  const [ankiDeckName, setAnkiDeckName] = useState('');
  const [defaultCardType, setDefaultCardType] = useState('');
  const [ankiConnected, setAnkiConnected] = useState(false);
  const [ankiDecks, setAnkiDecks] = useState<string[]>([]);
  const [ankiLoading, setAnkiLoading] = useState(false);
  const [ankiError, setAnkiError] = useState<string | null>(null);
  const [ankiConnectUrl, setAnkiConnectUrl] = useState('http://localhost:8765');

  const chooseTransport = (next: AnkiTransport) => {
    const previous = transport === 'addon' || transport === 'ankiconnect' ? transport : null;
    setTransportOverride(next);
    void setSetting('ankiTransport', next).catch((error) => {
      setTransportOverride(previous);
      setAnkiError(error instanceof Error ? error.message : 'Failed to save Anki transport');
    });
  };

  useEffect(() => {
    if (transport !== 'ankiconnect') return;
    getSetting<string>('ankiConnectUrl').then((url) => {
      if (url) setAnkiConnectUrl(url);
    });
    setAnkiClozeDeckName(localStorage.getItem(SETTINGS_KEYS.ANKI_CLOZE_DECK_NAME) || '');
    setAnkiDeckName(localStorage.getItem(SETTINGS_KEYS.ANKI_DECK_NAME) || '');
    setDefaultCardType(localStorage.getItem(SETTINGS_KEYS.DEFAULT_CARD_TYPE) || '');
  }, [transport]);

  const checkAnkiConnection = useCallback(async () => {
    setAnkiLoading(true);
    setAnkiError(null);
    try {
      const connected = await isAnkiConnected();
      setAnkiConnected(connected);
      if (connected) {
        const decks = await getDeckNames();
        setAnkiDecks(decks);
      }
    } catch {
      setAnkiError(
        'Failed to connect to Anki. Make sure Anki is running with AnkiConnect installed.',
      );
      setAnkiConnected(false);
    } finally {
      setAnkiLoading(false);
    }
  }, []);

  useEffect(() => {
    // Probe only on the browser-direct transport: on 'addon' (and while the
    // choice is still resolving) the fetch is pointless — and from a hosted
    // page it's blocked by Local Network Access and mis-reads as "Anki isn't
    // running".
    if (transport !== 'ankiconnect') return;
    checkAnkiConnection();
  }, [transport, checkAnkiConnection]);

  // Cloud: the add-on is the only transport that can work — no picker.
  if (mode === 'cloud') {
    return (
      <section
        id="anki-integration"
        className="panel scroll-mt-6 space-y-4 p-6"
        data-testid="anki-addon-panel"
      >
        <h2 className="text-lg font-semibold text-foreground">Anki Integration</h2>
        <AnkiAddonBody />
      </section>
    );
  }

  return (
    <section
      id="anki-integration"
      className="panel scroll-mt-6 space-y-4 p-6"
      data-testid={transport === 'addon' ? 'anki-addon-panel' : undefined}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Anki Integration</h2>
        {transport === 'ankiconnect' && (
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                ankiConnected ? 'bg-primary' : 'bg-destructive'
              }`}
            />
            <span className="text-sm text-muted-foreground">
              {ankiConnected ? 'Connected' : 'Not connected'}
            </span>
            <Button variant="link" onClick={checkAnkiConnection} disabled={ankiLoading}>
              {ankiLoading ? 'Checking...' : 'Refresh'}
            </Button>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground">Connection</label>
        <p className="mb-2 text-xs text-muted-foreground">
          AnkiConnect reaches Anki on this computer from the browser. The add-on syncs from inside
          Anki instead — use it when Lector is served over HTTPS or runs on another machine.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            data-testid="anki-transport-ankiconnect"
            onClick={() => chooseTransport('ankiconnect')}
            variant={transport === 'ankiconnect' ? 'default' : 'secondary'}
          >
            AnkiConnect (browser)
          </Button>
          <Button
            data-testid="anki-transport-addon"
            onClick={() => chooseTransport('addon')}
            variant={transport === 'addon' ? 'default' : 'secondary'}
          >
            Lector Sync add-on
          </Button>
        </div>
      </div>

      {transport === 'addon' ? (
        <AnkiAddonBody />
      ) : (
        <>
          {ankiError && (
            <div className="rounded-md bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] p-3 text-sm text-destructive">
              {ankiError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground">AnkiConnect URL</label>
            <p className="mb-2 text-xs text-muted-foreground">
              Hint: Use Tailscale IP for remote Anki (e.g., http://100.x.x.x:8765)
            </p>
            <input
              type="text"
              value={ankiConnectUrl}
              onChange={(e) => {
                setAnkiConnectUrl(e.target.value);
                void setSetting('ankiConnectUrl', e.target.value).catch((error) => {
                  setAnkiError(error instanceof Error ? error.message : 'Failed to save Anki URL');
                });
                // Invalidate the anki.ts URL cache so the next request
                // (e.g. the connection check below) uses the new value.
                refreshAnkiUrl();
              }}
              placeholder="http://localhost:8765"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground">Vocab Deck</label>
            <p className="mb-1 text-xs text-muted-foreground">
              Deck for basic cards from reader vocabulary
            </p>
            {ankiConnected && ankiDecks.length > 0 ? (
              <select
                value={ankiDeckName}
                onChange={(e) => localStorage.setItem(SETTINGS_KEYS.ANKI_DECK_NAME, e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
              >
                {ankiDecks.map((deck) => (
                  <option key={deck} value={deck}>
                    {deck}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={ankiDeckName}
                onChange={(e) => localStorage.setItem(SETTINGS_KEYS.ANKI_DECK_NAME, e.target.value)}
                placeholder="Deck name"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground">Cloze Practice Deck</label>
            <p className="mb-2 text-xs text-muted-foreground">
              Deck for cloze cards from practice mode
            </p>
            {ankiConnected && ankiDecks.length > 0 ? (
              <select
                value={ankiClozeDeckName}
                onChange={(e) =>
                  localStorage.setItem(SETTINGS_KEYS.ANKI_CLOZE_DECK_NAME, e.target.value)
                }
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
              >
                {ankiDecks.map((deck) => (
                  <option key={deck} value={deck}>
                    {deck}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={ankiClozeDeckName}
                onChange={(e) => {
                  const newVal = e.target.value;

                  localStorage.setItem(SETTINGS_KEYS.ANKI_CLOZE_DECK_NAME, newVal);
                  setAnkiClozeDeckName(newVal);
                }}
                placeholder="Cloze deck name"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground">Default Card Type</label>
            <p className="mb-2 text-xs text-muted-foreground">
              Basic shows front/back, Cloze creates fill-in-the-blank cards
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={(e) => {
                  localStorage.setItem(SETTINGS_KEYS.ANKI_CLOZE_DECK_NAME, 'basic');
                  setDefaultCardType('basic');
                }}
                variant={defaultCardType === 'basic' ? 'default' : 'secondary'}
              >
                Basic
              </Button>
              <Button
                onClick={(e) => {
                  localStorage.setItem(SETTINGS_KEYS.ANKI_CLOZE_DECK_NAME, 'cloze');
                  setDefaultCardType('cloze');
                }}
                variant={defaultCardType === 'cloze' ? 'default' : 'secondary'}
              >
                Cloze
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
