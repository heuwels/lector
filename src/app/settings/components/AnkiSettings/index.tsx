import { Button } from '@/components/ui/button';
import { getDeckNames, isAnkiConnected, refreshAnkiUrl } from '@/lib/anki';
import { apiBase } from '@/lib/api-base';
import { getSetting, setSetting } from '@/lib/data-layer';
import { useLectorMode } from '@/lib/use-env';
import { useCallback, useEffect, useState } from 'react';
import { SETTINGS_KEYS } from '../../constants';

/**
 * Cloud mode (#241): a hosted page can't reach AnkiConnect on the user's
 * localhost — Chrome's Local Network Access permission-gates public HTTPS →
 * loopback, so the old panel's connection check fired a doomed fetch and
 * mis-diagnosed it as "Anki isn't running". Live sync in cloud goes through
 * the Lector Anki addon instead (it calls out to this API from inside Anki),
 * so the panel becomes setup instructions for it.
 */
function AnkiAddonSettings() {
  return (
    <section className="panel space-y-4 p-6" data-testid="anki-addon-panel">
      <h2 className="text-lg font-semibold text-foreground">Anki Integration</h2>
      <p className="text-sm text-muted-foreground">
        A hosted app can&apos;t talk to Anki on your computer from the browser, so Lector syncs
        through its Anki add-on instead: words you queue here become cards the next time Anki
        opens, and your review results flow back automatically.
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
          <code className="rounded bg-muted px-1 py-0.5 text-xs">api_url</code> to the address
          below and <code className="rounded bg-muted px-1 py-0.5 text-xs">api_token</code> to
          your token.
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
    </section>
  );
}

export default function AnkiSettings() {
  const mode = useLectorMode();
  const [ankiClozeDeckName, setAnkiClozeDeckName] = useState('');
  const [ankiDeckName, setAnkiDeckName] = useState('');
  const [defaultCardType, setDefaultCardType] = useState('');
  const [ankiConnected, setAnkiConnected] = useState(false);
  const [ankiDecks, setAnkiDecks] = useState<string[]>([]);
  const [ankiLoading, setAnkiLoading] = useState(false);
  const [ankiError, setAnkiError] = useState<string | null>(null);
  const [ankiConnectUrl, setAnkiConnectUrl] = useState('http://localhost:8765');

  useEffect(() => {
    if (mode !== 'selfhost') return;
    getSetting<string>('ankiConnectUrl').then((url) => {
      if (url) setAnkiConnectUrl(url);
    });
    setAnkiClozeDeckName(localStorage.getItem(SETTINGS_KEYS.ANKI_CLOZE_DECK_NAME) || '');
    setAnkiDeckName(localStorage.getItem(SETTINGS_KEYS.ANKI_DECK_NAME) || '');
    setDefaultCardType(localStorage.getItem(SETTINGS_KEYS.DEFAULT_CARD_TYPE) || '');
  }, [mode]);

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
    // Selfhost only: in cloud the browser-direct probe is blocked by Local
    // Network Access and would only produce console errors + wrong copy.
    if (mode !== 'selfhost') return;
    checkAnkiConnection();
  }, [mode, checkAnkiConnection]);

  if (mode === 'cloud') return <AnkiAddonSettings />;

  return (
    <section className="panel space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Anki Integration</h2>
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
      </div>

      {ankiError && (
        <div className="rounded-md bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] p-3 text-sm text-destructive ">
          {ankiError}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-foreground">
          AnkiConnect URL
        </label>
        <p className="mb-2 text-xs text-muted-foreground">
          Hint: Use Tailscale IP for remote Anki (e.g., http://100.x.x.x:8765)
        </p>
        <input
          type="text"
          value={ankiConnectUrl}
          onChange={(e) => {
            setAnkiConnectUrl(e.target.value);
            setSetting('ankiConnectUrl', e.target.value);
            // Invalidate the anki.ts URL cache so the next request
            // (e.g. the connection check below) uses the new value.
            refreshAnkiUrl();
          }}
          placeholder="http://localhost:8765"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground">
          Vocab Deck
        </label>
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
        <label className="block text-sm font-medium text-foreground">
          Cloze Practice Deck
        </label>
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
        <label className="block text-sm font-medium text-foreground">
          Default Card Type
        </label>
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
    </section>
  );
}
