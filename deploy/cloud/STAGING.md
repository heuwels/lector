# Staging and production promotion

Lector uses trunk-based deployment. A merge to `master` runs CI; only a successful
CI run builds an immutable `ghcr.io/heuwels/lector:sha-<commit>` image. That exact
image deploys automatically to staging. Production then waits for Luke's approval
through the protected GitHub `production` Environment—there is no rebuild between
staging and production.

```text
merge to master
  → CI
  → build one immutable multi-arch image
  → deploy + health-check staging.lector.dev
  → manual GitHub production approval
  → promote the same image to app.lector.dev
```

Both deployment jobs roll back to the previous image when the new container fails
its `/health` check.

## One-time GitHub setup

Repository Settings → Environments:

- `staging`: no required reviewer; deployment branches limited to protected branches.
- `production`: Luke is a required reviewer, self-review is allowed, deployment
  branches limited to protected branches.

The environments are also the OIDC trust boundary. AWS roles accept only
`repo:heuwels/lector:environment:staging` or `:production`; a normal branch/PR job
cannot assume either role.

## One-time AWS/CDK setup

Deploy the compute-free identity stack first, then staging. Do not deploy
`LectorCloudCanary` as part of this setup: any UserData change may replace the live
production instance.

```bash
cd deploy/cloud/cdk
bun install --frozen-lockfile
bunx cdk diff LectorCanaryCi
bunx cdk deploy LectorCanaryCi
bunx cdk diff LectorCloudStaging
bunx cdk deploy LectorCloudStaging
```

`LectorCloudStaging` defaults to `t4g.micro`, uses a disposable 20 GB data volume,
has no Litestream/backup service, and reads only `/lector/staging/*` parameters.

## Staging parameters

Create a dedicated Cloudflare tunnel and Paddle sandbox resources. Never reuse live
Paddle credentials, prices, webhook secrets, or account data.

Required:

| Parameter                               | Type         | Purpose                                                                           |
| --------------------------------------- | ------------ | --------------------------------------------------------------------------------- |
| `/lector/staging/tunnel-token`          | SecureString | staging Cloudflare tunnel                                                         |
| `/lector/staging/better-auth-secret`    | SecureString | staging-only session secret                                                       |
| `/lector/staging/lector-billing`        | String       | `paddle`                                                                          |
| `/lector/staging/paddle-env`            | String       | `sandbox`                                                                         |
| `/lector/staging/paddle-api-key`        | SecureString | Paddle sandbox server key                                                         |
| `/lector/staging/paddle-webhook-secret` | SecureString | sandbox notification destination secret                                           |
| `/lector/staging/checkout-url`          | String       | approved sandbox checkout page, recommended `https://sandbox.lector.dev/checkout` |
| `/lector/staging/paddle-price-monthly`  | String       | sandbox Cloud monthly price ID                                                    |
| `/lector/staging/paddle-price-annual`   | String       | sandbox Cloud annual price ID                                                     |

Optional staging-only values follow the production suffixes in `README.md`, including
Plus prices, Resend, Turnstile, LLM/TTS keys, exempt accounts, and Sentry. The stack
sets `SENTRY_ENVIRONMENT=staging`; production sets `production`.

## Cloudflare and Paddle

1. Route `staging.lector.dev` through its staging tunnel to the compose services:
   `/api/*` and `/health` → `lector:3457`; everything else → `lector:3000`.
2. Keep Cloudflare Access on the whole staging hostname for UAT users.
3. Add a more-specific Access bypass for `/api/billing/webhook`; Paddle authenticates
   that endpoint with its signature.
4. In Paddle sandbox, create separate products/prices, API key, notification
   destination, and checkout-domain approval.
5. The checkout surface must initialize Paddle.js in sandbox mode and return to
   `https://staging.lector.dev/subscribe`. This is a `lector-site` deployment concern;
   do not point staging transactions at the live checkout initializer.

## UAT and promotion

After an automatic staging deploy, test at minimum:

- signup, verification, login, reset, TOTP and session revocation;
- empty/new account isolation and starter content;
- sandbox monthly/annual checkout and webhook activation;
- cancel, past-due, renew, upgrade/downgrade and webhook replay;
- entitlement limits and soft upsells;
- data export/import and admin support actions;
- Sentry events carry `environment=staging`;
- the Version panel reports the SHA waiting for promotion.

Open the workflow run and approve the pending `production` job only after UAT. Reject
or leave it pending when staging is not acceptable; a later green master build will
produce a new staging candidate.

## Emergency operations

- A failed deployment automatically restores the prior image tag.
- To redeploy the current candidate, rerun the failed GitHub job; it remains pinned to
  the workflow run's `head_sha`.
- To roll production back deliberately, use the last known-good immutable SHA with
  the same `deploy-cloud.sh` wrapper over SSM—never retag `latest`.
- Staging data is disposable. Production data remains retained and backed up as
  documented in `README.md`.
