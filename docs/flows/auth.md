# Auth domain

Auth is the cloud session gate. Selfhost skips this domain. The root layout mounts AuthGuard first.

## Sign in

**App domain:** Auth

```mermaid
sequenceDiagram
  actor User
  participant Guard as AuthGuard
  participant Login as Login page
  participant Auth as authClient
  participant API as Better Auth
  participant DB as session table

  User->>Guard: Open an app route
  Guard->>Auth: useSession
  alt No session
    Guard->>Login: bounceToLogin
  end
  User->>Login: Email and password
  Login->>Auth: signIn.email
  Auth->>API: POST /api/auth/sign-in/email
  API->>DB: Write session cookie
  Login->>Guard: Session exists
```

### Key files

| Role | Path | Function |
| --- | --- | --- |
| Gate | `src/components/AuthGuard/index.tsx` | `AuthGuard`, `CloudSessionGate` |
| Login | `src/app/(auth)/login/page.tsx` | `handleSubmit` |
| Client | `src/lib/auth-client.ts` | `authClient` |
| Bounce | `src/lib/api-base.ts` | `bounceToLogin` |
| Engine | `api/src/lib/accounts.ts` | `createAuthEngine`, `getAuthEngine` |
| Mount | `api/src/index.ts` | `/api/auth/*` |

### Branches

- Selfhost never mounts `useSession`. The API has no `/api/auth/*` route.
- Auth pages render even with no session. They send a signed-in user to `/`.
- When `window.__ENV__` enables them, GitHub and OIDC buttons show.
- Turnstile is a one-use token. A failed submit remounts the widget.
- An unverified email stays on the login page. The user can ask for a new mail.

### Tables

Better Auth owns `user`, `session`, `account`, and `verification`. Lector study tables do not hold the session.

### Tests

`e2e/auth-cloud.spec.ts`, `e2e/auth-selfhost.spec.ts`.

## Sign up

**App domain:** Auth

The register page calls `authClient.signUp.email`. Better Auth sends a confirmation email. The account is not a session until the user opens the confirmation link.

| Role | Path | Function |
| --- | --- | --- |
| Register | `src/app/(auth)/register/page.tsx` | `handleSubmit` |
| Engine | `api/src/lib/accounts.ts` | `createAuthEngine` |

Reset password and two-factor live in `src/app/(auth)/reset-password/` and `src/app/(auth)/two-factor/`. They use the same Better Auth handler.

## Session gate

**App domain:** Auth

The root layout order is AuthGuard, then BillingGuard, then SetupGuard.

```mermaid
flowchart TD
  Layout[src/app/layout.tsx] --> Auth[AuthGuard]
  Auth --> Billing[BillingGuard]
  Billing --> Setup[SetupGuard]
  Setup --> App[App pages]
```

- Cloud: AuthGuard waits for a session. BillingGuard waits for `accessAllowed`. SetupGuard waits for `targetLanguage`.
- Selfhost: AuthGuard and BillingGuard pass through. SetupGuard still runs.
- `apiFetch` treats 401 as `bounceToLogin` and 402 as `bounceToSubscribe`.
- Impersonation changes the tenant id inside AuthGuard. See [Admin](admin.md#impersonate).
