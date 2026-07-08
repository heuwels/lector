# Lector cloud canary — `app.lector.dev`

The first **cloud-mode** deployment (#242): the published image running with
`LECTOR_MODE=cloud` + `LECTOR_CLOUD_GATE=external`, fronted by **Cloudflare
Access**. Single-user until #217/#218 land — the point is to have the cloud
shape running in production (one codebase, one image, mode-flagged) before
accounts exist.

```
browser ── https://app.lector.dev ──▶ Cloudflare edge (Access policy)
                                          │ tunnel (outbound-only)
                                          ▼
EC2, zero inbound, SSM shell ──── cloudflared ──▶ lector container
                                     /api/* and /health  → :3457 (Hono API)
                                     everything else     → :3000 (Next UI)
EBS gp3 data volume (survives the instance) → /app/data (SQLite, WAL)
```

Design notes:

- **Zero ingress.** No ports are published on the host and the security group
  allows no inbound; `cloudflared` dials out. Shell access is SSM Session
  Manager (no SSH keys). The app is reachable _only_ through Cloudflare, so the
  Access policy is the sole front door — which is exactly what
  `LECTOR_CLOUD_GATE=external` asserts.
- **One hostname, path-split.** The browser calls the Hono API directly
  (no Next proxy, #188). Routing `/api/*` and `/health` to `:3457` on the same
  hostname makes UI↔API **same-origin** — no CORS, and the Access cookie just
  works.
- **A VM, not Fargate/EFS.** SQLite runs in WAL mode (`api/src/db.ts`), which
  needs shared memory that network filesystems can't provide safely. Local EBS
  is the sound home for it, and matches the plan-010 tenancy economics
  (shared SQLite on a VM, continuously replicated to S3 by Litestream — #270).

## Prerequisites

- AWS account + credentials, region bootstrapped for CDK (`bunx cdk bootstrap`,
  first time only). Default region: `us-east-1` (override with
  `CDK_DEFAULT_REGION`).
- `bun` (the CDK app runs through it).
- Cloudflare account with the `lector.dev` zone and Zero Trust enabled.
- Image access: `ghcr.io/heuwels/lector` is currently **private** → either flip
  the package to public (GitHub → package settings; the README already assumes
  public pulls) or create a fine-grained PAT with `read:packages` for step 2.

## Deploy

1. **Create the tunnel** (Cloudflare → Zero Trust → Networks → Tunnels →
   Create a tunnel → _Cloudflared_, remotely managed). Name it `lector-canary`
   and copy the token (`eyJ…`).

2. **Put the parameters.** SSM Parameter Store is the single source of truth
   for every secret and LLM setting; the box re-reads all of them on every
   `update.sh` (see _Rotate a secret_ below). Only `tunnel-token` is required:

   | Parameter (`/lector/canary/…`) | Type         | Becomes                                                      |
   | ------------------------------ | ------------ | ------------------------------------------------------------ |
   | `tunnel-token` **(required)**  | SecureString | cloudflared `TUNNEL_TOKEN`                                    |
   | `claude-oauth-token`           | SecureString | `CLAUDE_OAUTH_TOKEN` (plan credits — preferred over API key)  |
   | `anthropic-api-key`            | SecureString | `ANTHROPIC_API_KEY`                                           |
   | `openrouter-api-key`           | SecureString | `OPENAI_COMPAT_API_KEY`                                       |
   | `google-api-key`               | SecureString | `GOOGLE_CLOUD_API_KEY` (TTS)                                  |
   | `llm-provider`                 | String       | `LLM_PROVIDER` (`anthropic` default, or `openai`)             |
   | `openai-compat-url`            | String       | `OPENAI_COMPAT_URL`                                           |
   | `openai-compat-model`          | String       | `OPENAI_COMPAT_MODEL`                                         |
   | `resend-api-key`               | SecureString | `RESEND_API_KEY` (account verification/reset emails, #218 — the sending domain must be verified at resend.com/domains or sends 403) |
   | `better-auth-secret`           | SecureString | `BETTER_AUTH_SECRET` (session signing, #218 — **required**: cloud proper refuses to boot without it. Generate: `openssl rand -base64 32`) |
   | `turnstile-site-key`           | String       | `TURNSTILE_SITE_KEY` (Cloudflare Turnstile widget on the auth forms, #218 — public key, rides `window.__ENV__`) |
   | `turnstile-secret`             | SecureString | `TURNSTILE_SECRET_KEY` (server-side captcha verification; set both or neither) |
   | `ghcr-token`                   | SecureString | image-pull login (only if the package goes private again)     |

   ```bash
   aws ssm put-parameter --name /lector/canary/tunnel-token \
     --type SecureString --value 'eyJ…'
   # LLM via your Claude plan credits (canary-friendly, $0 marginal).
   # NOTE: `claude setup-token` prints prose AROUND the token — do NOT command-
   # substitute its output. Run it, copy the bare sk-ant-oat01-… string, paste:
   aws ssm put-parameter --name /lector/canary/claude-oauth-token \
     --type SecureString --value 'sk-ant-oat01-…'
   # …or LLM via OpenRouter (one key, any model):
   aws ssm put-parameter --name /lector/canary/openrouter-api-key \
     --type SecureString --value 'sk-or-…'
   aws ssm put-parameter --name /lector/canary/llm-provider \
     --type String --value 'openai'
   aws ssm put-parameter --name /lector/canary/openai-compat-url \
     --type String --value 'https://openrouter.ai/api'
   aws ssm put-parameter --name /lector/canary/openai-compat-model \
     --type String --value 'google/gemini-2.5-flash-lite'
   # TTS:
   aws ssm put-parameter --name /lector/canary/google-api-key \
     --type SecureString --value '…'
   ```

   Note: the OpenAI-compatible provider uses **one model for everything**
   (per-task word/phrase/chat models are Anthropic-only for now), so pick an
   all-rounder. Use `--overwrite` when changing an existing value.

3. **Deploy the stack:**

   ```bash
   cd deploy/cloud/cdk
   bun install
   bunx cdk deploy --all    # ~3 min; outputs the instance id + SSM shell hint,
                            # plus LectorCanaryCi's GitHub deploy role ARN
                            # (the OIDC role docker.yml uses to auto-deploy)
   ```

4. **Route the hostname** (Cloudflare → the tunnel → _Public Hostname_) — two
   rules, API rule first (first match wins):

   | #   | Hostname         | Path             | Service              |
   | --- | ---------------- | ---------------- | -------------------- |
   | 1   | `app.lector.dev` | `^/(api\|health)` | `http://lector:3457` |
   | 2   | `app.lector.dev` | _(empty)_        | `http://lector:3000` |

   The path field is a regex. Use the **service names** (`lector`), never
   `localhost` — cloudflared runs in its own container, so its `localhost` is
   itself; `lector` resolves on the instance's compose network.

5. **Gate it with Access** (Zero Trust → Access → Applications → self-hosted):
   application domain `app.lector.dev` (the whole hostname — `/api` and
   `/health` included), allow-policy on your email(s). **The canary must never
   run un-gated**: the app delegates all auth to this policy.

6. **Smoke-check:** open `https://app.lector.dev` → Access login → the app.
   Then `https://app.lector.dev/health` → `{"ok":true,"mode":"cloud"}`.

## Operate

- **Update to the latest image:** automatic. Every merge to `master` publishes
  `:latest` (docker.yml), whose `deploy-canary` job then assumes the
  `LectorCanaryCi` stack's GitHub-OIDC role (no AWS keys in repo secrets) and
  runs `/srv/lector/update.sh` on the box over SSM, health-gated by
  [`deploy-canary.sh`](./deploy-canary.sh). Manual fallback — same effect:
  `aws ssm start-session --target <instance-id>` → `sudo /srv/lector/update.sh`
  (refreshes all secrets from SSM + pull + recreate; the data volume is untouched).
- **Redeploying `LectorCloudCanary`:** a boot-script (UserData) change
  **replaces the instance**, and the replacement mounts a **fresh, empty data
  volume** — the old one survives detached, but nothing re-attaches it for
  you. Run `bunx cdk diff LectorCloudCanary` first and treat an
  `Instance may be replaced` line as a data-migration step, not a routine
  deploy. `LectorCanaryCi` (IAM only) is always safe to deploy.
- **Rotate a secret / change LLM provider:** `aws ssm put-parameter --overwrite …`,
  then `update.sh`. Deleted parameters drop out of the container env entirely
  on the next refresh — nothing lingers as an empty string.
- **Adding a NEW parameter** (a mapping that isn't in the table yet) needs a
  matching `put <ENV_KEY> <param-suffix>` line in `/srv/lector/refresh-env.sh`.
  That script is baked into UserData at first boot, so a stack edit only covers
  *future* instances — patch the live box over SSM (append the line, run
  `update.sh`); do **not** redeploy the stack for this, a UserData change
  replaces the instance.
- **Logs:** `sudo docker logs lector` / `sudo docker logs cloudflared`;
  first-boot log at `/var/log/lector-canary-init.log`.
- **Data:** SQLite lives on the dedicated EBS volume at `/srv/lector/data`.
  It survives instance replacement (`deleteOnTermination: false`).
- **Backups:** the `LectorCanaryBackup` stack (cdk/lib/backup-stack.ts) runs a
  Data Lifecycle Manager policy: an EBS snapshot of the **data volume only**
  (boot excluded) nightly at 16:00 UTC ≈ 02:00 Sydney, keeping the newest 30.
  Crash-consistent is safe here — SQLite WAL recovers a mid-write snapshot
  like a power loss. List them:
  `aws ec2 describe-snapshots --owner-ids self --filters Name=tag:backup,Values=lector-canary-nightly`.
  **Restore:** create a volume from the chosen snapshot in the instance's AZ →
  `docker compose down` → detach the live data volume, attach the restored one
  at `/dev/sdf` → `mount -a` → `docker compose up -d`. Snapshot storage for
  this DB is pennies/month (incremental).
- **Continuous replication (Litestream → S3, #270):** a `litestream` sidecar
  in the compose file replicates `/srv/lector/data/lector.db` to
  `s3://lector-canary-litestream-<account>/lector.db` every 10s (72h
  retention) — second-level RPO on top of the nightly snapshots. Credentials
  come from the **instance role via IMDSv2** (hop limit 2; no static keys);
  the bucket + its principal-tag bucket policy live in `LectorCanaryBackup`,
  which is always safe to deploy.

  **Applying to an already-running box** (the boot script only runs at first
  boot, and redeploying `LectorCloudCanary` replaces the instance — don't):
  1. `bunx cdk deploy LectorCanaryBackup` — creates the bucket + access policy.
  2. From your workstation, let containers reach IMDS (one extra hop through
     the docker bridge):
     `aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required --http-put-response-hop-limit 2 --region us-east-1`
  3. On the box (SSM session, `sudo -i`): write `/srv/lector/litestream.yml`
     and append the `litestream` service to `/srv/lector/docker-compose.yml`
     **exactly as the boot script in `canary-stack.ts` defines them** (copy
     from there — it stays the single source of truth), then
     `/srv/lector/update.sh`.
  4. Verify: `docker logs litestream` shows an initial snapshot upload, and
     `aws s3 ls s3://lector-canary-litestream-<account>/lector.db/ --recursive | head`
     shows `generations/…` objects growing.

  **Restore drill** (run it now, and again before real users — an unrestored
  backup is a hope, not a backup):
  ```bash
  docker run --rm -v /tmp:/out -v /srv/lector/litestream.yml:/etc/litestream.yml:ro \
    litestream/litestream restore -o /out/restored.db /data/lector.db
  sqlite3 /tmp/restored.db 'PRAGMA integrity_check; SELECT COUNT(*) FROM lessons;'
  ```
  Full recovery = restore onto a fresh box's data volume, then
  `docker compose up -d`.
- **Teardown:** `bunx cdk destroy`. The data volume is retained — delete it
  manually (and the SSM parameters + tunnel + Access app) for a full cleanup.

## Caveats

- **Cloud proper since 2026-07-08** (#218): built-in Better Auth accounts are
  the app-level gate — real signup/login, per-user isolation, Turnstile on the
  auth forms. `LECTOR_CLOUD_GATE=external` is gone from the compose env;
  `BETTER_AUTH_SECRET` is **required** (the container refuses to boot without
  it) and `BETTER_AUTH_URL` must be the public origin. Cloudflare Access may
  stay in front as an outer gate during the soak — the app no longer depends
  on it for auth, so removing the Access app is safe when ready for public
  signup.
- **Pre-flip data** (everything created under the external gate) belongs to
  the implicit `local` tenant: invisible to session users, retained in the DB
  and in every Litestream/EBS backup.
- **Cost:** ~US$12–15/mo (t4g.small + 36 GB gp3 + public IPv4). Downsize with
  `bunx cdk deploy -c instanceType=t4g.micro` if the canary is idle-mostly.
