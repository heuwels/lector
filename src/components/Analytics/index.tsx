'use client';

import { useSyncExternalStore } from 'react';
import Script from 'next/script';
import { lectorMode } from '@/lib/api-base';

const noSubscription = () => () => {};

// Cloud only. Self-host leaves ANALYTICS unset, so this renders nothing.
// The server snapshot stays false: window.__ENV__ does not exist during SSR.
export default function Analytics() {
  const on = useSyncExternalStore(
    noSubscription,
    () => lectorMode() === 'cloud' && window.__ENV__?.ANALYTICS === '1',
    () => false,
  );

  if (!on) return null;

  return <Script async src="/a/boot.js" strategy="afterInteractive" />;
}
