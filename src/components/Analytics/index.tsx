'use client';

import { useSyncExternalStore } from 'react';
import Script from 'next/script';
import { lectorMode } from '@/lib/api-base';

const noSubscription = () => () => {};

// Plausible tracks the cloud canary (app.lector.dev) only — self-hosted installs
// default to lectorMode() === 'selfhost' and never load the third-party script.
// useSyncExternalStore rather than useState+useEffect: window.__ENV__ doesn't
// exist during SSR, so the server snapshot is fixed at `false` and the client
// snapshot (lectorMode()) is only read in the browser — avoiding the hydration
// mismatch SetupGuard sidesteps by not reading localStorage before mount.
export default function Analytics() {
  const cloud = useSyncExternalStore(
    noSubscription,
    () => lectorMode() === 'cloud',
    () => false,
  );

  if (!cloud) return null;

  return (
    <>
      <Script
        async
        src="https://plausible.io/js/pa-xQmf4ajJGkUSy59pCYMJz.js"
        strategy="afterInteractive"
      />
      <Script id="plausible-init" strategy="afterInteractive">
        {`window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
plausible.init()`}
      </Script>
    </>
  );
}
