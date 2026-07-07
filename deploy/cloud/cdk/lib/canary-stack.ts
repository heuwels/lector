import { CfnOutput, Stack, StackProps, Tags } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * Lector cloud canary (heuwels/lector#242): a single zero-ingress EC2 box
 * running the published multi-arch image in cloud mode behind Cloudflare
 * Access.
 *
 *   browser ── https://app.lector.dev ──▶ Cloudflare edge (Access policy)
 *                                            │ tunnel (outbound-only)
 *                                            ▼
 *   EC2 (no inbound SG rules, SSM for shell) ── cloudflared ──▶ lector
 *                                                  /api/*, /health → :3457
 *                                                  everything else → :3000
 *   EBS gp3 data volume (survives instance replacement) → /app/data (SQLite)
 *
 * Why a VM and not Fargate/EFS: the app keeps SQLite in WAL mode
 * (api/src/db.ts `PRAGMA journal_mode = WAL`), and WAL requires shared memory
 * that network filesystems (EFS/NFS) can't provide safely — local block
 * storage is the only sound home for it. This also matches the plan-010
 * tenancy decision (shared SQLite on a VM; Litestream→R2 later, #217).
 *
 * Continuous deploy: every master merge publishes :latest (docker.yml), whose
 * deploy-canary job runs /srv/lector/update.sh on the box via SSM. The IAM
 * side of that (GitHub OIDC provider + deploy role) lives in its own stack —
 * see ci-stack.ts — so rolling CI credentials never risks touching this
 * instance (a UserData change here REPLACES the box and its fresh data
 * volume starts empty; deploy this stack deliberately, never as a side
 * effect).
 *
 * Secrets are NOT in this stack. SSM Parameter Store is the single source of
 * truth; the box fetches everything via /srv/lector/refresh-env.sh — run at
 * first boot and by every /srv/lector/update.sh — so rotating a secret or
 * flipping LLM provider is `aws ssm put-parameter` + update.sh, no redeploy.
 * Parameters (see ../README.md for the full table):
 *   /lector/canary/tunnel-token        SecureString  required — Cloudflare Tunnel token
 *   /lector/canary/claude-oauth-token  SecureString  optional — CLAUDE_OAUTH_TOKEN (plan credits)
 *   /lector/canary/anthropic-api-key   SecureString  optional — ANTHROPIC_API_KEY
 *   /lector/canary/openrouter-api-key  SecureString  optional — OPENAI_COMPAT_API_KEY
 *   /lector/canary/google-api-key      SecureString  optional — GOOGLE_CLOUD_API_KEY (TTS)
 *   /lector/canary/llm-provider        String        optional — LLM_PROVIDER (default anthropic)
 *   /lector/canary/openai-compat-url   String        optional — e.g. https://openrouter.ai/api
 *   /lector/canary/openai-compat-model String        optional — e.g. google/gemini-flash-lite
 *   /lector/canary/resend-api-key      SecureString  optional — RESEND_API_KEY (account emails, #218)
 *   /lector/canary/ghcr-token          SecureString  optional — only if the ghcr package goes private again
 */

const HOSTNAME = 'app.lector.dev';
const PARAM_PREFIX = '/lector/canary';
const IMAGE = 'ghcr.io/heuwels/lector:latest';

export class LectorCloudCanaryStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Minimal network: one public subnet, no NAT. The instance gets a public
    // IP for *egress only* (image pulls, the tunnel, SSM); the security group
    // allows no inbound at all — Cloudflare reaches the app exclusively
    // through the outbound-dialled tunnel.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
    });

    const sg = new ec2.SecurityGroup(this, 'InstanceSg', {
      vpc,
      // AWS-visible descriptions must stay ASCII: IAM validates against
      // [ -~¡-ÿ] and EC2 SG descriptions are stricter still.
      description: 'lector canary - zero inbound; cloudflared dials out, shell via SSM',
      allowAllOutbound: true,
    });

    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'lector canary instance - SSM session access + canary parameters',
    });
    role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:${this.partition}:ssm:${this.region}:${this.account}:parameter${PARAM_PREFIX}/*`,
        ],
      }),
    );

    const userData = ec2.UserData.forLinux();
    userData.addCommands(this.bootScript());

    const instanceType = new ec2.InstanceType(
      this.node.tryGetContext('instanceType') ?? 't4g.small',
    );

    const instance = new ec2.Instance(this, 'Instance', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      associatePublicIpAddress: true,
      securityGroup: sg,
      role,
      instanceType,
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),
      requireImdsv2: true,
      blockDevices: [
        {
          // Root — OS + docker images.
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(16, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
        {
          // Data — the SQLite DB + dictionaries, mounted at /srv/lector/data.
          // Survives instance termination (deleteOnTermination: false) so a
          // `cdk destroy` / instance replacement never takes the canary's data
          // with it; delete the volume manually for a full teardown.
          deviceName: '/dev/sdf',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: false,
          }),
        },
      ],
      userData,
    });

    Tags.of(this).add('project', 'lector');
    Tags.of(this).add('stack', 'cloud-canary');

    new CfnOutput(this, 'InstanceId', { value: instance.instanceId });
    new CfnOutput(this, 'ShellHint', {
      value: `aws ssm start-session --target ${instance.instanceId} --region ${this.region}`,
      description: 'Shell onto the box (no SSH keys, no open ports)',
    });
    new CfnOutput(this, 'Hostname', {
      value: `https://${HOSTNAME}`,
      description: 'Route this hostname to the tunnel in Cloudflare (see deploy/cloud/README.md)',
    });
  }

  /**
   * First-boot script. Everything the box runs is defined here — there is no
   * config drift between the repo and the instance because this is the only
   * copy. Escaping rule: `\${…}` emits a literal `${…}` for compose-time
   * interpolation; every other `$` is plain bash. Unescaped `${…}` are CDK
   * constants resolved at synth (HOSTNAME, IMAGE, PARAM_PREFIX, region).
   */
  private bootScript(): string {
    return `#!/bin/bash
set -euo pipefail
exec > >(tee -a /var/log/lector-canary-init.log) 2>&1

echo "== lector cloud canary first boot =="

# ── docker + compose v2 plugin (AL2023 packages neither compose v2 nor a plugin) ──
dnf install -y docker
systemctl enable --now docker
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64" \\
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# ── data volume: /dev/sdf (nitro exposes it via udev symlink), xfs, fstab ──
DEV=/dev/sdf
for i in $(seq 1 30); do [ -e "$DEV" ] && break; sleep 2; done
if ! blkid "$DEV" >/dev/null 2>&1; then
  mkfs -t xfs "$DEV"
fi
mkdir -p /srv/lector/data
UUID=$(blkid -s UUID -o value "$DEV")
grep -q "$UUID" /etc/fstab || echo "UUID=$UUID /srv/lector/data xfs defaults,nofail 0 2" >> /etc/fstab
mount -a

# ── secrets: SSM Parameter Store is the source of truth ──
# refresh-env.sh re-fetches every parameter and rewrites .env; it runs now
# (first boot) and inside every update.sh, so rotating a secret or flipping
# LLM provider = put-parameter + update.sh. Only keys with a value are
# written — absent params stay absent in the container (no empty-string
# overrides of in-app defaults).
install -d -m 750 /srv/lector
cat > /srv/lector/refresh-env.sh <<'REFRESHEOF'
#!/bin/bash
set -euo pipefail
REGION=__REGION__
ENVFILE=/srv/lector/.env
get_param() {
  aws ssm get-parameter --region "$REGION" --name "$1" --with-decryption \\
    --query Parameter.Value --output text 2>/dev/null || true
}
TMP=$(mktemp)
chmod 600 "$TMP"
put() { # put <ENV_KEY> <param-suffix>
  VAL=$(get_param "__PARAM_PREFIX__/$2")
  if [ -z "$VAL" ] || [ "$VAL" = "None" ]; then
    return 0
  fi
  # Every value here is a token/key/slug - none may contain whitespace. A
  # value with spaces or newlines means the parameter was stored wrong (e.g.
  # a command's full prose output instead of the bare token); writing it
  # would corrupt .env and can leak the value through error paths. Skip it
  # loudly, never printing the value itself.
  if printf '%s' "$VAL" | grep -q "[[:space:]]"; then
    echo "WARNING: __PARAM_PREFIX__/$2 contains whitespace - looks like a malformed value (did a command's full output get stored instead of the bare secret?). Skipping it; re-put the parameter with --overwrite." >&2
    return 0
  fi
  printf '%s=%s\\n' "$1" "$VAL" >> "$TMP"
}
put TUNNEL_TOKEN          tunnel-token
put CLAUDE_OAUTH_TOKEN    claude-oauth-token
put ANTHROPIC_API_KEY     anthropic-api-key
put OPENAI_COMPAT_API_KEY openrouter-api-key
put GOOGLE_CLOUD_API_KEY  google-api-key
put LLM_PROVIDER          llm-provider
put OPENAI_COMPAT_URL     openai-compat-url
put OPENAI_COMPAT_MODEL   openai-compat-model
put RESEND_API_KEY        resend-api-key
mv "$TMP" "$ENVFILE"
if ! grep -q "^TUNNEL_TOKEN=" "$ENVFILE"; then
  echo "WARNING: __PARAM_PREFIX__/tunnel-token is missing - cloudflared will crash-loop until it exists (put the parameter, then run /srv/lector/update.sh)" >&2
fi
GHCR_TOKEN=$(get_param __PARAM_PREFIX__/ghcr-token)
if [ -n "$GHCR_TOKEN" ] && [ "$GHCR_TOKEN" != "None" ]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u token --password-stdin
fi
echo "refreshed $ENVFILE with keys:"
awk -F= 'NF>1{print $1}' "$ENVFILE"
REFRESHEOF
sed -i "s|__REGION__|${this.region}|g; s|__PARAM_PREFIX__|${PARAM_PREFIX}|g" /srv/lector/refresh-env.sh
chmod +x /srv/lector/refresh-env.sh
/srv/lector/refresh-env.sh

# ── the whole deployment: lector (cloud canary shape) + cloudflared ──
# No published ports: nothing listens on the host. cloudflared reaches lector
# on the compose network and dials OUT to Cloudflare; Access fronts every
# request at the edge (that is what LECTOR_CLOUD_GATE=external asserts).
cat > /srv/lector/docker-compose.yml <<'COMPOSEEOF'
services:
  lector:
    image: ${IMAGE}
    container_name: lector
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - LECTOR_MODE=cloud
      - LECTOR_CLOUD_GATE=external
      - API_URL=https://${HOSTNAME}
      # Interpolated from .env at compose time so a value set via SSM wins;
      # absent -> anthropic. All pure secrets ride env_file below instead,
      # so params that don't exist never become empty-string env overrides.
      - LLM_PROVIDER=\${LLM_PROVIDER:-anthropic}
    env_file:
      - /srv/lector/.env
    volumes:
      - /srv/lector/data:/app/data

  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: cloudflared
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=\${TUNNEL_TOKEN}
    depends_on:
      - lector
COMPOSEEOF

# ── update helper: refresh secrets from SSM + pull newest image + recreate ──
cat > /srv/lector/update.sh <<'UPDATEEOF'
#!/bin/bash
set -euo pipefail
cd /srv/lector
./refresh-env.sh
docker compose pull
docker compose up -d
docker image prune -f
UPDATEEOF
chmod +x /srv/lector/update.sh

cd /srv/lector
docker compose up -d
echo "== lector cloud canary init done =="
`;
  }
}
