'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getFluencyStats, seedStarterContent, setSetting } from '@/lib/data-layer';
import { LANGUAGES } from '@/lib/languages';
import { LanguageCode } from '@/types/language';
import { useActiveLanguage } from '@/utils/hooks';
import { setLanguageInStorage } from '@/utils/storage';
import { toast } from 'sonner';

export default function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const activeLang = useActiveLanguage();
  const [knownWordsCount, setKnownWordsCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        // Pass the selected language explicitly. The badge belongs to this
        // selector state; relying on the ambient cache can show the previous
        // language's count while a cloud language change is propagating.
        const fluency = await getFluencyStats(activeLang.code);

        if (!cancelled) setKnownWordsCount(fluency.totalKnownWords);
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [activeLang.code]);

  async function handleSwitch(code: LanguageCode) {
    try {
      await setSetting('targetLanguage', code);
      setLanguageInStorage(code);
      // First-ever switch to a language seeds its starter content before the
      // reload lands wherever the user was; never throws (#315).
      await seedStarterContent(code);
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change language');
    }
  }

  const knownBadge = knownWordsCount ? (
    <span
      title={`Words known: ${knownWordsCount}`}
      className="rounded-full border border-[var(--gold-lip)] bg-[var(--gold-soft)] px-1 py-px text-[var(--gold-strong)] sm:px-2 sm:py-1"
    >
      {knownWordsCount > 1000 ? `${(knownWordsCount / 1000).toFixed(1)}K` : knownWordsCount}
    </span>
  ) : null;

  const menuItems = Object.values(LANGUAGES).map((lang) => (
    <DropdownMenuItem
      key={lang.code}
      onClick={() => handleSwitch(lang.code)}
      data-testid={`language-option-${lang.code}`}
      className={lang.code === activeLang.code ? 'font-medium' : undefined}
    >
      <span className="text-lg">{lang.flag}</span>
      <span>{lang.native}</span>
      {lang.code === activeLang.code && <Check className="ml-auto size-4" />}
    </DropdownMenuItem>
  ));

  if (compact) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="language-selector"
          aria-label={`Language: ${activeLang.native}`}
          className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <span>{activeLang.flag}</span>
          <span>{activeLang.code.toUpperCase()}</span>
          {knownBadge}
          <ChevronDown className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" aria-label="Select language" className="w-44">
          {menuItems}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="mx-3">
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="language-selector"
          aria-label={`Language: ${activeLang.native}`}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <span className="text-lg">{activeLang.flag}</span>
          <span className="flex-1 text-left">{activeLang.native}</span>
          {knownBadge}
          <ChevronDown className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label="Select language" className="min-w-44">
          {menuItems}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
