'use client';

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

  async function handleSelect(code: LanguageCode) {
    // Save to server
    await setSetting('targetLanguage', code);
    // Save to localStorage
    localStorage.setItem('lector-target-language', code);
    // Navigate to home
    router.replace('/');
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
            data-testid={`setup-language-${lang.code}`}
            className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-zinc-200 bg-white px-6 py-8 transition-all hover:border-zinc-400 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
          >
            <span className="text-5xl">{lang.flag}</span>
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
