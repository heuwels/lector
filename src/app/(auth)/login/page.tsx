'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import TurnstileWidget, { turnstileSiteKey } from '@/components/TurnstileWidget';
import { authClient } from '@/lib/auth-client';
import { useGithubLogin, useOidcLogin, useOidcProviderName } from '@/lib/use-env';

export default function LoginPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const githubEnabled = useGithubLogin();
  const oidcEnabled = useOidcLogin();
  const oidcName = useOidcProviderName();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  // Turnstile tokens are single-use: bump the key after a failed submit so
  // the widget remounts and issues a fresh one.
  const [captchaRound, setCaptchaRound] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  // Signed in already (or just now) → into the app.
  useEffect(() => {
    if (!isPending && session) router.replace('/');
  }, [isPending, session, router]);

  function captchaHeaders(): Record<string, string> {
    return captchaToken ? { 'x-captcha-response': captchaToken } : {};
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setUnverifiedEmail(null);

    const { data, error } = await authClient.signIn.email({
      email,
      password,
      fetchOptions: { headers: captchaHeaders() },
    });

    if (!error) {
      // A 2FA-enrolled account answers with a challenge instead of a session —
      // the TOTP code on /two-factor completes the sign-in.
      if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
        router.replace('/two-factor');
      } else {
        router.replace('/');
      }
      return;
    }

    setSubmitting(false);
    setCaptchaToken('');
    setCaptchaRound((r) => r + 1);
    if (error.code === 'EMAIL_NOT_VERIFIED') {
      setUnverifiedEmail(email);
      return;
    }
    toast.error(
      error.status === 401 ? 'Invalid email or password.' : (error.message ?? 'Sign-in failed.'),
    );
  }

  async function resendVerification() {
    if (!unverifiedEmail) return;
    const { error } = await authClient.sendVerificationEmail({
      email: unverifiedEmail,
      callbackURL: `${window.location.origin}/`,
    });
    if (error) toast.error(error.message ?? 'Could not resend the email.');
    else toast.success('Verification email sent — check your inbox.');
  }

  async function handleGithub() {
    await authClient.signIn.social({
      provider: 'github',
      callbackURL: `${window.location.origin}/`,
    });
  }

  async function handleOidc() {
    // BYO OIDC (#218) — providerId 'oidc' is fixed server-side (accounts.ts).
    await authClient.signIn.oauth2({
      providerId: 'oidc',
      callbackURL: `${window.location.origin}/`,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Sign in</h2>

      {unverifiedEmail && (
        <div
          className="rounded-lg border border-border bg-[var(--primary-soft)] p-3 text-sm text-foreground"
          data-testid="login-unverified-notice"
        >
          <p>
            <span className="font-medium">{unverifiedEmail}</span> hasn&apos;t been verified yet.
            Check your inbox for the link.
          </p>
          <button
            type="button"
            onClick={resendVerification}
            className="mt-1 font-medium text-primary hover:underline"
          >
            Resend verification email
          </button>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="login-email"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/reset-password" className="text-xs text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="login-password"
        />
      </div>

      <TurnstileWidget key={captchaRound} onToken={setCaptchaToken} />

      <Button
        type="submit"
        className="w-full"
        disabled={submitting || (!!turnstileSiteKey() && !captchaToken)}
        data-testid="login-submit"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>

      {githubEnabled && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGithub}
          data-testid="login-github"
        >
          Continue with GitHub
        </Button>
      )}

      {oidcEnabled && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleOidc}
          data-testid="login-oidc"
        >
          Continue with {oidcName}
        </Button>
      )}

      <p className="text-center text-sm text-muted-foreground">
        No account yet?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>
    </form>
  );
}
