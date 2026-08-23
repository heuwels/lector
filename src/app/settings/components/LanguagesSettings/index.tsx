'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { setSetting } from '@/lib/data-layer';
import {
  availableLanguages,
  LANGUAGES,
  normalizeEnabledLanguages,
  withLanguageDisabled,
  withLanguageEnabled,
} from '@/lib/languages';
import type { LanguageCode } from '@/types/language';
import { useActiveLanguage, useEnabledLanguages } from '@/utils/hooks';
import { notifyLanguageListChanged } from '@/utils/storage';

export default function LanguagesSettings() {
  const activeLang = useActiveLanguage();
  const enabledCodes = useEnabledLanguages();
  const [pending, setPending] = useState(false);
  const [adding, setAdding] = useState<LanguageCode | ''>('');

  const listed = normalizeEnabledLanguages([...enabledCodes, activeLang.code]);
  const addable = availableLanguages(listed);

  async function save(next: LanguageCode[], message: string) {
    setPending(true);
    try {
      await setSetting('enabledLanguages', next);
      notifyLanguageListChanged();
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save your languages');
    } finally {
      setPending(false);
    }
  }

  async function add() {
    if (!adding) return;
    const code = adding;
    setAdding('');
    await save(withLanguageEnabled(listed, code), `${LANGUAGES[code].native} added`);
  }

  async function remove(code: LanguageCode) {
    await save(withLanguageDisabled(listed, code), `${LANGUAGES[code].native} removed`);
  }

  return (
    <section className="panel p-6" data-testid="languages-settings">
      <h2 className="mb-1 text-lg font-semibold text-foreground">Languages</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        The language picker lists these languages. Remove a language to shorten the list. Your
        words, texts and cards in it stay on the server.
      </p>

      <ul className="mb-4 divide-y divide-border">
        {listed.map((code) => (
          <li
            key={code}
            data-testid={`enabled-language-${code}`}
            className="flex items-center gap-3 py-2"
          >
            <span className="text-lg">{LANGUAGES[code].flag}</span>
            <span className="flex-1 text-sm text-foreground">{LANGUAGES[code].native}</span>
            {code === activeLang.code ? (
              <span className="text-xs text-muted-foreground">In use</span>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={pending}
                aria-label={`Remove ${LANGUAGES[code].native}`}
                data-testid={`remove-language-${code}`}
                onClick={() => remove(code)}
              >
                <X />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {addable.length > 0 && (
        <div className="flex gap-2">
          <select
            value={adding}
            data-testid="add-language-select"
            onChange={(event) => setAdding(event.target.value as LanguageCode | '')}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
          >
            <option value="">Add a language…</option>
            {addable.map((code) => (
              <option key={code} value={code}>
                {LANGUAGES[code].native}
              </option>
            ))}
          </select>
          <Button disabled={pending || !adding} data-testid="add-language" onClick={add}>
            <Plus />
            Add
          </Button>
        </div>
      )}
    </section>
  );
}
