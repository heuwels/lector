'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { useLectorMode } from '@/lib/use-env';

/**
 * TOTP two-factor authentication for the built-in accounts, so it renders in
 * cloud mode only (selfhost has no login to protect). Enrolment is
 * verify-to-arm: `enable` hands back the otpauth URI + backup codes, but the
 * account only starts demanding codes after the first one verifies — closing
 * the panel half-way never locks anyone out.
 */

type PasswordAction = 'enable' | 'disable' | 'regenerate';

/** Pull the base32 secret out of the otpauth:// URI for manual entry. */
function secretFromUri(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

const ACTION_LABELS: Record<PasswordAction, { title: string; cta: string }> = {
  enable: { title: 'Confirm your password to set up two-factor authentication', cta: 'Continue' },
  disable: { title: 'Confirm your password to turn off two-factor authentication', cta: 'Turn off' },
  regenerate: {
    title: 'Confirm your password to replace your backup codes',
    cta: 'Generate new codes',
  },
};

export default function TwoFactorSettings() {
  const mode = useLectorMode();
  const { data: session } = authClient.useSession();

  const [pendingAction, setPendingAction] = useState<PasswordAction | null>(null);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Enrolment payload from enable(): shown until verified or cancelled.
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [verifyCode, setVerifyCode] = useState('');

  if (mode !== 'cloud') return null;

  const enabled = Boolean(
    (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );

  function resetForms() {
    setPendingAction(null);
    setPassword('');
    setSubmitting(false);
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !pendingAction) return;
    setSubmitting(true);

    if (pendingAction === 'enable') {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error) {
        setSubmitting(false);
        toast.error(error.status === 400 ? 'Wrong password.' : (error.message ?? 'Could not start setup.'));
        return;
      }
      setTotpURI(data.totpURI);
      setBackupCodes(data.backupCodes);
      resetForms();
      return;
    }

    if (pendingAction === 'disable') {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) {
        setSubmitting(false);
        toast.error(error.status === 400 ? 'Wrong password.' : (error.message ?? 'Could not turn off 2FA.'));
        return;
      }
      resetForms();
      setTotpURI(null);
      setBackupCodes(null);
      toast.success('Two-factor authentication is off.');
      return;
    }

    const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
    if (error) {
      setSubmitting(false);
      toast.error(error.status === 400 ? 'Wrong password.' : (error.message ?? 'Could not generate codes.'));
      return;
    }
    setBackupCodes(data.backupCodes);
    resetForms();
    toast.success('New backup codes generated — the old ones no longer work.');
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code: verifyCode.trim() });
    setSubmitting(false);
    if (error) {
      toast.error('That code didn’t match — scan the QR code and try the current one.');
      return;
    }
    // Session refetches via the auth client, flipping the section to "on".
    setTotpURI(null);
    setVerifyCode('');
    toast.success('Two-factor authentication is on.');
  }

  function copyBackupCodes() {
    if (!backupCodes) return;
    navigator.clipboard.writeText(backupCodes.join('\n'));
    toast.success('Backup codes copied to clipboard');
  }

  const enrolling = totpURI !== null;

  return (
    <section className="panel p-6" data-testid="twofactor-section">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Two-Factor Authentication</h2>
        {!enabled && !enrolling && pendingAction === null && (
          <Button onClick={() => setPendingAction('enable')} data-testid="twofactor-enable">
            Enable 2FA
          </Button>
        )}
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        Protect your account with one-time codes from an authenticator app (Google Authenticator,
        1Password, Authy, …) on top of your password.
      </p>

      {!enrolling && (
        <p className="mb-4 text-sm text-foreground" data-testid="twofactor-status">
          {enabled
            ? 'Two-factor authentication is on. Signing in asks for a code from your authenticator app.'
            : 'Two-factor authentication is off.'}
        </p>
      )}

      {/* Shared password confirmation for enable / disable / regenerate */}
      {pendingAction !== null && (
        <form
          onSubmit={handlePasswordSubmit}
          className="mb-4 space-y-3 rounded-md border border-border bg-muted p-4"
        >
          <Label htmlFor="twofactor-password">{ACTION_LABELS[pendingAction].title}</Label>
          <Input
            id="twofactor-password"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="twofactor-password"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={submitting || password.length === 0}
              variant={pendingAction === 'disable' ? 'destructive' : 'default'}
              data-testid="twofactor-password-submit"
            >
              {submitting ? 'Working…' : ACTION_LABELS[pendingAction].cta}
            </Button>
            <Button type="button" variant="outline" onClick={resetForms}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {/* Enrolment: QR + manual secret + verify */}
      {enrolling && totpURI && (
        <div className="mb-4 space-y-4 rounded-md border border-border bg-muted p-4">
          <p className="text-sm font-medium text-foreground">
            1. Scan this QR code with your authenticator app
          </p>
          <div className="flex justify-center">
            {/* White plate so the code scans in dark mode too */}
            <div className="rounded-lg bg-white p-3" data-testid="twofactor-qr">
              <QRCodeSVG value={totpURI} size={168} marginSize={0} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Can’t scan? Enter this key manually:{' '}
            <code
              className="rounded bg-background px-1.5 py-0.5 font-mono text-xs break-all select-all"
              data-testid="twofactor-secret"
            >
              {secretFromUri(totpURI)}
            </code>
          </p>

          <form onSubmit={handleVerify} className="space-y-2">
            <Label htmlFor="twofactor-verify-code">
              2. Enter the 6-digit code the app shows now
            </Label>
            <Input
              id="twofactor-verify-code"
              type="text"
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="123456"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              data-testid="twofactor-verify-code"
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={submitting || verifyCode.trim().length < 6}
                data-testid="twofactor-verify-submit"
              >
                {submitting ? 'Verifying…' : 'Verify & activate'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  // Unverified setup never armed — safe to just close.
                  setTotpURI(null);
                  setBackupCodes(null);
                  setVerifyCode('');
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* One-time backup codes display (enrolment and regeneration) */}
      {backupCodes && (
        <div className="mb-4 rounded-md border border-[var(--gold-lip)] bg-[var(--gold-soft)] p-4">
          <p className="mb-2 text-sm font-medium text-[var(--gold-strong)]">
            Save these backup codes somewhere safe — each one signs you in once if you lose your
            authenticator, and they won’t be shown again.
          </p>
          <div
            className="mb-2 grid grid-cols-2 gap-x-6 gap-y-1 rounded border border-[var(--gold-lip)] bg-muted px-3 py-2 font-mono text-sm text-foreground sm:grid-cols-3"
            data-testid="twofactor-backup-codes"
          >
            {backupCodes.map((c) => (
              <span key={c} className="select-all">
                {c}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={copyBackupCodes}>Copy</Button>
            <Button
              variant="outline"
              onClick={() => setBackupCodes(null)}
              data-testid="twofactor-codes-saved"
            >
              I’ve saved these codes
            </Button>
          </div>
        </div>
      )}

      {/* Management actions once armed */}
      {enabled && pendingAction === null && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setPendingAction('regenerate')}
            data-testid="twofactor-regenerate"
          >
            New backup codes
          </Button>
          <Button
            variant="destructive"
            onClick={() => setPendingAction('disable')}
            data-testid="twofactor-disable"
          >
            Turn off 2FA
          </Button>
        </div>
      )}
    </section>
  );
}
