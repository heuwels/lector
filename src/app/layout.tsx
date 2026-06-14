import type { Metadata } from 'next';
import { Nunito, Literata } from 'next/font/google';
import Script from 'next/script';
import { Toaster } from 'sonner';
import ChatWidget from '@/components/ChatWidget';
import SetupGuard from '@/components/SetupGuard';
import './globals.css';
import NavHeader from '@/components/NavHeader';

// Nunito is the UI/chrome font; Literata stays the reading body (issue #147 §2.1).
const nunito = Nunito({
  variable: '--font-nunito',
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
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

      <body
        className={`${nunito.variable} ${literata.variable} flex min-h-screen flex-col bg-background font-sans text-foreground antialiased sm:flex-row`}
      >
        <NavHeader />

        <div className="flex-1">
          <SetupGuard>{children}</SetupGuard>
        </div>
        <ChatWidget />
        {/* Spacer for mobile bottom nav — invisible on sm+ */}
        <div className="h-16 sm:hidden" aria-hidden="true" />
        <Toaster theme="system" duration={5000} />
      </body>
    </html>
  );
}
