import { Button } from '@/components/ui/button';
import { getDeckNames, isAnkiConnected, refreshAnkiUrl } from '@/lib/anki';
import { getSetting, setSetting } from '@/lib/data-layer';
import { useCallback, useEffect, useState } from 'react';
import { SETTINGS_KEYS } from '../../constants';

export default function AnkiSettings() {
  const [ankiClozeDeckName, setAnkiClozeDeckName] = useState('');
  const [ankiDeckName, setAnkiDeckName] = useState('');
  const [defaultCardType, setDefaultCardType] = useState('');
  const [ankiConnected, setAnkiConnected] = useState(false);
  const [ankiDecks, setAnkiDecks] = useState<string[]>([]);
  const [ankiLoading, setAnkiLoading] = useState(false);
  const [ankiError, setAnkiError] = useState<string | null>(null);
  const [ankiConnectUrl, setAnkiConnectUrl] = useState('http://localhost:8765');

  useEffect(() => {
    getSetting<string>('ankiConnectUrl').then((url) => {
      if (url) setAnkiConnectUrl(url);
    });
    setAnkiClozeDeckName(localStorage.getItem(SETTINGS_KEYS.ANKI_CLOZE_DECK_NAME) || '');
    setAnkiDeckName(localStorage.getItem(SETTINGS_KEYS.ANKI_DECK_NAME) || '');
    setDefaultCardType(localStorage.getItem(SETTINGS_KEYS.DEFAULT_CARD_TYPE) || '');
  }, []);

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
    checkAnkiConnection();
  }, [checkAnkiConnection]);

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
