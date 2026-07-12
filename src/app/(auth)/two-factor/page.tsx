'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { authHref, sanitizeAuthReturnPath } from '@/lib/auth-return';

/**
 * Second step of a 2FA sign-in. The password step answered with
 * twoFactorRedirect and set a short-lived challenge cookie (10 min) instead
 * of a session; verifying a TOTP or backup code here turns that challenge
 * into the session. Reached only via the login page — a cold visit has no
 * challenge cookie and any code is refused, so the page just sends those
 * visitors back to sign in.
 */
export default function TwoFactorPage() {
  return (
    <Suspense fallback={null}>
      <TwoFactorForm />
    </Suspense>
  );
}

function TwoFactorForm() {
  const router = useRouter();
  const params = useSearchParams();
  const returnPath = sanitizeAuthReturnPath(params.get('next'));
  const destination = returnPath ?? '/';
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const trimmed = code.trim();
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: trimmed, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code: trimmed, trustDevice });

    if (!error) {
      router.replace(destination);
      return;
    }

    setSubmitting(false);
    if (error.code === 'INVALID_TWO_FACTOR_COOKIE') {
      toast.error('This sign-in attempt has expired — enter your password again.');
      router.replace(authHref('/login', returnPath));
      return;
    }
    if (
      error.code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' ||
      error.code === 'ACCOUNT_TEMPORARILY_LOCKED'
    ) {
      toast.error('Too many failed codes — wait a bit, then sign in again.');
      return;
    }
    toast.error(
      useBackup ? 'That backup code didn’t work.' : 'That code didn’t work — try the current one.',
    );
  }

  function toggleMode() {
    setUseBackup((b) => !b);
    setCode('');
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Two-factor authentication</h2>
      <p className="text-sm text-muted-foreground">
        {useBackup
          ? 'Enter one of your backup codes. Each code works once.'
          : 'Enter the 6-digit code from your authenticator app.'}
      </p>

      <div className="space-y-2">
        <Label htmlFor="totp-code">{useBackup ? 'Backup code' : 'Verification code'}</Label>
        <Input
          id="totp-code"
          type="text"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode={useBackup ? 'text' : 'numeric'}
          pattern={useBackup ? undefined : '[0-9]{6}'}
          maxLength={useBackup ? 32 : 6}
          placeholder={useBackup ? 'e.g. abcde-fghij' : '123456'}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          data-testid="twofactor-code"
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className="rounded"
          checked={trustDevice}
          onChange={(e) => setTrustDevice(e.target.checked)}
          data-testid="twofactor-trust-device"
        />
        Trust this device for 30 days
      </label>

      <Button
        type="submit"
        className="w-full"
        disabled={submitting || code.trim().length === 0}
        data-testid="twofactor-submit"
      >
        {submitting ? 'Verifying…' : 'Verify'}
      </Button>

      <button
        type="button"
        onClick={toggleMode}
        className="w-full text-center text-sm font-medium text-primary hover:underline"
        data-testid="twofactor-toggle-backup"
      >
        {useBackup ? 'Use an authenticator code instead' : 'Use a backup code instead'}
      </button>

      <p className="text-center text-sm text-muted-foreground">
        <Link
          href={authHref('/login', returnPath)}
          className="font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
