'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import TurnstileWidget, { turnstileSiteKey } from '@/components/TurnstileWidget';
import { authClient } from '@/lib/auth-client';

/**
 * Two forms on one route (#218):
 *   - no ?token → request a reset link (email form)
 *   - ?token=… → set a new password (the emailed link redirects back here
 *     with the token; better-auth appends ?error=… on an invalid/expired one)
 */
export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary for prerendering.
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const linkError = params.get('error');

  if (linkError) {
    return (
      <div className="space-y-4" data-testid="reset-link-invalid">
        <h2 className="text-lg font-semibold text-foreground">Link expired</h2>
        <p className="text-sm text-muted-foreground">
          That reset link is invalid or has expired. Request a new one below.
        </p>
        <Button className="w-full" onClick={() => window.location.assign('/reset-password')}>
          Request a new link
        </Button>
      </div>
    );
  }

  return token ? <NewPasswordForm token={token} /> : <RequestResetForm />;
}

function RequestResetForm() {
  const [email, setEmail] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaRound, setCaptchaRound] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
      fetchOptions: {
        headers: captchaToken ? { 'x-captcha-response': captchaToken } : {},
      },
    });

    setSubmitting(false);
    if (error) {
      setCaptchaToken('');
      setCaptchaRound((r) => r + 1);
      toast.error(error.message ?? 'Could not request a reset.');
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-4" data-testid="reset-check-email">
        <h2 className="text-lg font-semibold text-foreground">Check your inbox</h2>
        <p className="text-sm text-muted-foreground">
          If an account exists for <span className="font-medium text-foreground">{email}</span>,
          a reset link is on its way.
        </p>
        <Link href="/login" className="block">
          <Button className="w-full">Back to sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Reset your password</h2>
      <p className="text-sm text-muted-foreground">
        Enter your account email and we&apos;ll send you a reset link.
      </p>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="reset-email"
        />
      </div>

      <TurnstileWidget key={captchaRound} onToken={setCaptchaToken} />

      <Button
        type="submit"
        className="w-full"
        disabled={submitting || (!!turnstileSiteKey() && !captchaToken)}
        data-testid="reset-submit"
      >
        {submitting ? 'Sending…' : 'Send reset link'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

function NewPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const { error } = await authClient.resetPassword({ newPassword: password, token });

    setSubmitting(false);
    if (error) {
      toast.error(error.message ?? 'Could not reset the password.');
      return;
    }
    toast.success('Password updated — sign in with the new one.');
    router.replace('/login');
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Choose a new password</h2>

      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="reset-new-password"
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>

      <Button type="submit" className="w-full" disabled={submitting} data-testid="reset-confirm">
        {submitting ? 'Updating…' : 'Set new password'}
      </Button>
    </form>
  );
}
