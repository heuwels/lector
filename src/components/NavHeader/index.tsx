'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageSelector from '@/components/LanguageSelector';
import { iconMap, navLinks } from './constants';

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
                                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${isActive
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
                                className={`flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors ${isActive
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
