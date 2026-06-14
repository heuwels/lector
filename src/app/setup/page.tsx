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
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-12 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-foreground">
          Welcome to Lector
        </h1>
        <p className="text-lg text-muted-foreground">
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
                ? 'border-primary bg-[var(--primary-soft)]'
                : pending !== null
                  ? 'cursor-not-allowed border-border bg-card opacity-50'
                  : 'border-border bg-card hover:border-primary hover:shadow-lg'
            }`}
          >
            {pending === lang.code ? (
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-border border-t-primary" />
            ) : (
              <span className="text-5xl">{lang.flag}</span>
            )}
            <span className="text-xl font-semibold text-foreground">
              {lang.native}
            </span>
            <span className="text-sm text-muted-foreground">
              {lang.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
