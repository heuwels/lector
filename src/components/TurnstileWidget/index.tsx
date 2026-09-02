'use client';

import { useEffect, useRef } from 'react';
import type { ITurnstileWidgetProps } from './types';

/**
 * Cloudflare Turnstile
 * Provides bot protection on the auth forms.
 *
 * Only renders when window.__ENV__.TURNSTILE_SITE_KEY is set
 *
 * Token is retrieved via onToken and must be sent as the
 * `x-captcha-response` header on sign-up/sign-in/reset requests.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function turnstileSiteKey(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__ENV__?.TURNSTILE_SITE_KEY || undefined;
}

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!window.__lectorTurnstileReady) {
    window.__lectorTurnstileReady = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Turnstile'));
      document.head.appendChild(script);
    });
  }
  return window.__lectorTurnstileReady;
}

export default function TurnstileWidget({ onToken }: ITurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  const siteKey = typeof window !== 'undefined' ? turnstileSiteKey() : undefined;

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let widgetId: string | undefined;
    let cancelled = false;

    loadTurnstile()
      .then(() => {
        if (cancelled || !window.turnstile || !containerRef.current) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'auto',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => onTokenRef.current(''),
        });
      })
      .catch(() => {
        // Script blocked/unreachable: leave the token empty — the API rejects
        // the submit with a clear captcha error rather than failing silently.
      });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={containerRef} data-testid="turnstile-widget" className="min-h-16.25" />;
}
