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
    <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Anki Integration</h2>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              ankiConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {ankiConnected ? 'Connected' : 'Not connected'}
          </span>
          <Button variant="link" onClick={checkAnkiConnection} disabled={ankiLoading}>
            {ankiLoading ? 'Checking...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {ankiError && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {ankiError}
        </div>
      )}

      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          AnkiConnect URL
        </label>
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
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          Hint: Use Tailscale IP for remote Anki (e.g., http://100.x.x.x:8765)
        </p>
      </div>

      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Vocab Deck
        </label>
        {ankiConnected && ankiDecks.length > 0 ? (
          <select
            value={ankiDeckName}
            onChange={(e) => localStorage.setItem(SETTINGS_KEYS.ANKI_DECK_NAME, e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
        )}
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          Deck for basic cards from reader vocabulary
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Cloze Practice Deck
        </label>
        {ankiConnected && ankiDecks.length > 0 ? (
          <select
            value={ankiClozeDeckName}
            onChange={(e) =>
              localStorage.setItem(SETTINGS_KEYS.ANKI_CLOZE_DECK_NAME, e.target.value)
            }
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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
            onChange={(e) =>
              localStorage.setItem(SETTINGS_KEYS.ANKI_CLOZE_DECK_NAME, e.target.value)
            }
            placeholder="Cloze deck name"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
        )}
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          Deck for cloze cards from practice mode
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Default Card Type
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => localStorage.setItem(SETTINGS_KEYS.DEFAULT_CARD_TYPE, 'basic')}
            className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              defaultCardType === 'basic'
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
            }`}
          >
            Basic
          </button>
          <button
            onClick={() => localStorage.setItem(SETTINGS_KEYS.DEFAULT_CARD_TYPE, 'cloze')}
            className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              defaultCardType === 'cloze'
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
            }`}
          >
            Cloze
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          Basic shows front/back, Cloze creates fill-in-the-blank cards
        </p>
      </div>
    </section>
  );
}
