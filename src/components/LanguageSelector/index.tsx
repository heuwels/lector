'use client';

import { Check, ChevronDown, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getFluencyStats, seedStarterContent, setSetting } from '@/lib/data-layer';
import { availableLanguages, LANGUAGES, normalizeEnabledLanguages } from '@/lib/languages';
import { LanguageCode } from '@/types/language';
import { useActiveLanguage, useEnabledLanguages } from '@/utils/hooks';
import { setLanguageInStorage } from '@/utils/storage';
import { toast } from 'sonner';

export default function LanguageSelector({
  compact = false,
  collapsed = false,
}: {
  compact?: boolean;
  collapsed?: boolean;
}) {
  const activeLang = useActiveLanguage();
  const enabledCodes = useEnabledLanguages();
  const [knownWordsCount, setKnownWordsCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

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
      // The API opts the account into whatever language it switches to (#442),
      // so adding a language and switching to one are the same write.
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

  // The active language is always listed, whatever the stored list says.
  const listed = normalizeEnabledLanguages([...enabledCodes, activeLang.code]);
  const addable = availableLanguages(listed);

  function languageRow(code: LanguageCode, testIdPrefix: string, markActive: boolean) {
    const isActive = markActive && code === activeLang.code;
    return (
      <DropdownMenuItem
        key={code}
        onClick={() => handleSwitch(code)}
        data-testid={`${testIdPrefix}-${code}`}
        className={isActive ? 'font-medium' : undefined}
      >
        <span className="text-lg">{LANGUAGES[code].flag}</span>
        <span>{LANGUAGES[code].native}</span>
        {isActive && <Check className="ml-auto size-4" />}
      </DropdownMenuItem>
    );
  }

  const menuItems = listed.map((code) => languageRow(code, 'language-option', true));
  const addItems = addOpen
    ? addable.map((code) => languageRow(code, 'language-add-option', false))
    : null;

  const addSection =
    addable.length > 0 ? (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          closeOnClick={false}
          onClick={() => setAddOpen((wasOpen) => !wasOpen)}
          data-testid="language-add-toggle"
          aria-expanded={addOpen}
          className="text-muted-foreground"
        >
          <Plus className="size-4" />
          <span>Add a language</span>
        </DropdownMenuItem>
        {addItems}
      </>
    ) : null;

  function onOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setAddOpen(false);
  }

  const variant = collapsed ? 'collapsed' : compact ? 'compact' : 'full';
  const triggerClass = {
    collapsed:
      'flex items-center justify-center rounded-lg p-2 text-lg transition-colors hover:bg-accent',
    compact:
      'flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted',
    full: 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent',
  }[variant];

  const menu = (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        data-testid="language-selector"
        aria-label={`Language: ${activeLang.native}`}
        title={variant === 'collapsed' ? activeLang.native : undefined}
        className={triggerClass}
      >
        <span className={variant === 'full' ? 'text-lg' : undefined}>{activeLang.flag}</span>
        {variant === 'compact' && <span>{activeLang.code.toUpperCase()}</span>}
        {variant === 'full' && <span className="flex-1 text-left">{activeLang.native}</span>}
        {variant !== 'collapsed' && knownBadge}
        {variant !== 'collapsed' && <ChevronDown className="size-4" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === 'compact' ? 'end' : 'start'}
        aria-label="Select language"
        className={variant === 'compact' ? 'w-44' : 'min-w-44'}
      >
        {menuItems}
        {addSection}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (variant === 'collapsed') {
    return <div className="flex justify-center px-1">{menu}</div>;
  }
  if (variant === 'full') {
    return <div className="mx-3">{menu}</div>;
  }
  return menu;
}
