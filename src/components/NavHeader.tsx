'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore, useEffect, useRef } from 'react';
import ThemeToggle from './ThemeToggle';
import { setSetting } from '@/lib/data-layer';
import { LANGUAGES, DEFAULT_LANGUAGE, type LanguageCode, type LanguageConfig, isValidLanguageCode } from '@/lib/languages';

const navLinks = [
  { href: '/', label: 'Library' },
  { href: '/practice', label: 'Practice' },
  { href: '/journal', label: 'Journal' },
  { href: '/vocab', label: 'Vocab' },
  { href: '/stats', label: 'Stats' },
  { href: '/settings', label: 'Settings' },
];

// Icons — defined inside render to avoid module-scope JSX (React 19 hydration)
function LibraryIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  );
}

function PracticeIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}

function JournalIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function VocabIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
        d="M4 6h16M4 10h16M4 14h10M4 18h7" />
    </svg>
  );
}

function StatsIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

const iconMap: Record<string, () => React.ReactElement> = {
  '/': LibraryIcon,
  '/practice': PracticeIcon,
  '/journal': JournalIcon,
  '/vocab': VocabIcon,
  '/stats': StatsIcon,
  '/settings': SettingsIcon,
};

function getLanguageSnapshot(): LanguageConfig {
  const stored = localStorage.getItem('lector-target-language');
  if (stored && isValidLanguageCode(stored)) return LANGUAGES[stored];
  return LANGUAGES[DEFAULT_LANGUAGE];
}

// Custom event for same-tab localStorage changes (storage event only fires cross-tab)
const LANGUAGE_CHANGE_EVENT = 'lector-language-change';

function subscribeToStorage(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(LANGUAGE_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(LANGUAGE_CHANGE_EVENT, callback);
  };
}

function setLanguageInStorage(code: string) {
  localStorage.setItem('lector-target-language', code);
  window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));
}

function useActiveLanguage(): LanguageConfig {
  return useSyncExternalStore(subscribeToStorage, getLanguageSnapshot, () => LANGUAGES[DEFAULT_LANGUAGE]);
}

function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeLang = useActiveLanguage();

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  async function handleSwitch(code: LanguageCode) {
    setIsOpen(false);
    await setSetting('targetLanguage', code);
    setLanguageInStorage(code);
    window.location.reload();
  }

  const allLangs = Object.values(LANGUAGES);

  if (compact) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={`Language: ${activeLang.native}`}
          data-testid="language-selector"
          className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          <span>{activeLang.flag}</span>
          <span>{activeLang.code.toUpperCase()}</span>
          <ChevronIcon />
        </button>
        {isOpen && (
          <div role="listbox" aria-label="Select language" className="absolute left-0 z-50 mt-1 w-44 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            {allLangs.map((lang) => (
              <button
                role="option"
                aria-selected={lang.code === activeLang.code}
                key={lang.code}
                onClick={() => handleSwitch(lang.code)}
                data-testid={`language-option-${lang.code}`}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                  lang.code === activeLang.code
                    ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                    : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700'
                }`}
              >
                <span>{lang.flag}</span>
                <span>{lang.native}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative mx-3" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Language: ${activeLang.native}`}
        data-testid="language-selector"
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50"
      >
        <span className="text-lg">{activeLang.flag}</span>
        <span className="flex-1 text-left">{activeLang.native}</span>
        <ChevronIcon />
      </button>
      {isOpen && (
        <div role="listbox" aria-label="Select language" className="absolute left-0 right-0 z-50 mt-1 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
          {allLangs.map((lang) => (
            <button
              role="option"
              aria-selected={lang.code === activeLang.code}
              key={lang.code}
              onClick={() => handleSwitch(lang.code)}
              data-testid={`language-option-${lang.code}`}
              className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors ${
                lang.code === activeLang.code
                  ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                  : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              <span className="text-lg">{lang.flag}</span>
              <span>{lang.native}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg className="h-4 w-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export default function NavHeader() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile top bar — language selector, visible only on mobile */}
      <div className="fixed top-0 left-0 right-0 z-50 flex h-[var(--mobile-topbar-h)] items-center justify-end px-3 bg-white/80 backdrop-blur-sm border-b border-zinc-200 dark:bg-zinc-950/80 dark:border-zinc-800 sm:hidden">
        <LanguageSelector compact />
      </div>

      {/* Desktop left sidebar — hidden on mobile */}
      <aside className="hidden sm:flex sm:flex-col fixed inset-y-0 left-0 z-50 w-56 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {/* App name */}
        <div className="flex h-16 items-center px-5">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="Lector" width={28} height={28} className="rounded" />
            <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Lector
            </span>
          </Link>
        </div>

        {/* Language selector */}
        <div className="border-b border-zinc-200 pb-2 dark:border-zinc-800">
          <LanguageSelector />
        </div>

        {/* Navigation links */}
        <nav className="flex-1 space-y-1 px-3 py-2">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            const Icon = iconMap[link.href];
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                    : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50'
                }`}
              >
                <Icon />
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: theme toggle */}
        <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile bottom nav — hidden on sm+ */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 sm:hidden bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800">
        <div className="flex items-stretch">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            const Icon = iconMap[link.href];
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                <Icon />
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
