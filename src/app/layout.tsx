import type { Metadata } from "next";
import { Inter, Literata } from "next/font/google";
import "./globals.css";
import ChatWidget from "@/components/ChatWidget";
import SetupGuard from "@/components/SetupGuard";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "Lector",
  description: "A self-hosted language learning reader with SRS practice and Anki integration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){if(!localStorage.getItem('lector-migrated')){var m={'afrikaans-reader-api-key':'lector-api-key','afrikaans-reader-google-api-key':'lector-google-api-key','afrikaans-reader-anki-deck':'lector-anki-deck','afrikaans-reader-anki-cloze-deck':'lector-anki-cloze-deck','afrikaans-reader-card-type':'lector-card-type','afrikaans-reader-tts-speed':'lector-tts-speed','afrikaans-reader-theme':'lector-theme','afrikaans-reader-tts-voice':'lector-tts-voice','afrikaans-reader-tts-mode':'lector-tts-mode'};for(var k in m){var v=localStorage.getItem(k);if(v!==null){localStorage.setItem(m[k],v);localStorage.removeItem(k)}}localStorage.setItem('lector-migrated','1')}var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches);if(d)document.documentElement.classList.add('dark')})()` }} />
      </head>
      <body
        className={`${inter.variable} ${literata.variable} font-sans antialiased bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen`}
      >
        <SetupGuard>
          {children}
        </SetupGuard>
        <ChatWidget />
        {/* Spacer for mobile bottom nav — invisible on sm+ */}
        <div className="h-16 sm:hidden" aria-hidden="true" />
      </body>
    </html>
  );
}
