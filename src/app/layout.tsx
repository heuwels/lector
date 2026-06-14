import type { Metadata } from 'next';
import { Inter, Literata } from 'next/font/google';
import Script from 'next/script';
import { Toaster } from 'sonner';
import ChatWidget from '@/components/ChatWidget';
import SetupGuard from '@/components/SetupGuard';
import './globals.css';
import NavHeader from '@/components/NavHeader';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const literata = Literata({
  variable: '--font-literata',
  subsets: ['latin', 'latin-ext'],
});

export const metadata: Metadata = {
  title: 'Lector',
  description: 'A self-hosted language learning reader with SRS practice and Anki integration',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before paint to migrate legacy localStorage keys and apply the
            saved theme, preventing a flash of the wrong colour scheme. Uses
            next/script (beforeInteractive) rather than a raw <script> so React
            19 doesn't warn about a script tag inside the component tree. */}
        <Script id="lector-theme-init" strategy="beforeInteractive">
          {`(function(){if(!localStorage.getItem('lector-migrated')){var m={'afrikaans-reader-api-key':'lector-api-key','afrikaans-reader-google-api-key':'lector-google-api-key','afrikaans-reader-anki-deck':'lector-anki-deck','afrikaans-reader-anki-cloze-deck':'lector-anki-cloze-deck','afrikaans-reader-card-type':'lector-card-type','afrikaans-reader-tts-speed':'lector-tts-speed','afrikaans-reader-theme':'lector-theme','afrikaans-reader-tts-voice':'lector-tts-voice','afrikaans-reader-tts-mode':'lector-tts-mode'};for(var k in m){var v=localStorage.getItem(k);if(v!==null){localStorage.setItem(m[k],v);localStorage.removeItem(k)}}localStorage.setItem('lector-migrated','1')}var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches);if(d)document.documentElement.classList.add('dark')})()`}
        </Script>
      </head>
      <SetupGuard>
        <body
          className={`${inter.variable} ${literata.variable} flex min-h-screen flex-col bg-gray-50 font-sans text-gray-900 antialiased sm:flex-row dark:bg-gray-900 dark:text-gray-100`}
        >
          <NavHeader />
          <div className="flex-1">{children}</div>
          <ChatWidget />
          {/* Spacer for mobile bottom nav — invisible on sm+ */}
          <div className="h-16 sm:hidden" aria-hidden="true" />
          <Toaster theme="system" />
        </body>
      </SetupGuard>
    </html>
  );
}
