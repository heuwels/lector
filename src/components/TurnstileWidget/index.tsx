'use client';

import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile (#218) — bot protection on the auth forms. Renders
 * nothing unless window.__ENV__.TURNSTILE_SITE_KEY is set (selfhost and
 * keyless dev stay widget-free, matching the API, which only enforces
 * captcha when TURNSTILE_SECRET_KEY is configured server-side).
 *
 * The token lands via onToken and must be sent as the `x-captcha-response`
 * header on sign-up/sign-in/reset requests. Tokens are single-use: after a
 * failed submit the widget resets itself and issues a fresh one.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
          theme?: 'auto' | 'light' | 'dark';
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    __lectorTurnstileReady?: Promise<void>;
  }
}

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

export default function TurnstileWidget({
  onToken,
}: {
  /** Called with a fresh token, and with '' when the token expires/errors. */
  onToken: (token: string) => void;
}) {
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
  return <div ref={containerRef} data-testid="turnstile-widget" className="min-h-[65px]" />;
}
