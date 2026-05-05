'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setSetting } from '@/lib/data-layer';
import { LANGUAGES, type LanguageCode } from '@/lib/languages';

const languageCards: { code: LanguageCode; flag: string; native: string; name: string }[] = [
  { code: 'af', flag: LANGUAGES.af.flag, native: LANGUAGES.af.native, name: LANGUAGES.af.name },
  { code: 'de', flag: LANGUAGES.de.flag, native: LANGUAGES.de.native, name: LANGUAGES.de.name },
  { code: 'es', flag: LANGUAGES.es.flag, native: LANGUAGES.es.native, name: LANGUAGES.es.name },
];

export default function SetupPage() {
  const router = useRouter();
  const [pending, setPending] = useState<LanguageCode | null>(null);

  async function handleSelect(code: LanguageCode) {
    if (pending) return;
    setPending(code);
    try {
      await setSetting('targetLanguage', code);
      localStorage.setItem('lector-target-language', code);
      router.replace('/');
    } catch {
      setPending(null);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="mb-12 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Welcome to Lector
        </h1>
        <p className="text-lg text-zinc-500 dark:text-zinc-400">
          Choose a language to start learning
        </p>
      </div>

      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-3">
        {languageCards.map((lang) => (
          <button
            key={lang.code}
            onClick={() => handleSelect(lang.code)}
            disabled={pending !== null}
            data-testid={`setup-language-${lang.code}`}
            className={`group flex flex-col items-center gap-3 rounded-2xl border-2 px-6 py-8 transition-all ${
              pending === lang.code
                ? 'border-zinc-400 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800'
                : pending !== null
                  ? 'cursor-not-allowed opacity-50 border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
                  : 'border-zinc-200 bg-white hover:border-zinc-400 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600'
            }`}
          >
            {pending === lang.code ? (
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
            ) : (
              <span className="text-5xl">{lang.flag}</span>
            )}
            <span className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {lang.native}
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {lang.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
