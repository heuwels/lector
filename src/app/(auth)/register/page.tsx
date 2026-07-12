'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import TurnstileWidget, { turnstileSiteKey } from '@/components/TurnstileWidget';
import { authClient } from '@/lib/auth-client';
import { authHref, sanitizeAuthReturnPath } from '@/lib/auth-return';

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const returnPath = sanitizeAuthReturnPath(params.get('next'));
  const destination = returnPath ?? '/';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaRound, setCaptchaRound] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && session) router.replace(destination);
  }, [destination, isPending, session, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const { error } = await authClient.signUp.email({
      name: name.trim() || email.split('@')[0],
      email,
      password,
      // Absolute: the verification link lives on the API origin and redirects
      // here after confirming; a bare '/' would resolve against the API.
      callbackURL: `${window.location.origin}${destination}`,
      fetchOptions: {
        headers: captchaToken ? { 'x-captcha-response': captchaToken } : {},
      },
    });

    setSubmitting(false);
    if (error) {
      setCaptchaToken('');
      setCaptchaRound((r) => r + 1);
      toast.error(error.message ?? 'Sign-up failed.');
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="space-y-4" data-testid="register-check-email">
        <h2 className="text-lg font-semibold text-foreground">Check your inbox</h2>
        <p className="text-sm text-muted-foreground">
          We sent a verification link to{' '}
          <span className="font-medium text-foreground">{sentTo}</span>. Click it to activate your
          account, then sign in.
        </p>
        <Button className="w-full" onClick={() => router.push(authHref('/login', returnPath))}>
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Create your account</h2>

      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="register-name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="register-email"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="register-password"
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>

      <TurnstileWidget key={captchaRound} onToken={setCaptchaToken} />

      <Button
        type="submit"
        className="w-full"
        disabled={submitting || (!!turnstileSiteKey() && !captchaToken)}
        data-testid="register-submit"
      >
        {submitting ? 'Creating account…' : 'Create account'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href={authHref('/login', returnPath)}
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
