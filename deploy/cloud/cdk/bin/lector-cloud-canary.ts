#!/usr/bin/env bun
import { App } from 'aws-cdk-lib';
import { LectorCanaryBackupStack } from '../lib/backup-stack';
import { LectorCloudCanaryStack } from '../lib/canary-stack';
import { LectorCanaryCiStack } from '../lib/ci-stack';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  // Default region for the canary: us-east-1 — an English-language SaaS
  // skews US/EU, so origin latency belongs there (Cloudflare fronts it
  // everywhere regardless). Override with CDK_DEFAULT_REGION / AWS_REGION.
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

new LectorCloudCanaryStack(app, 'LectorCloudCanary', {
  env,
  description:
    'Lector cloud canary - app.lector.dev behind Cloudflare Access via a Cloudflare Tunnel (heuwels/lector#242)',
});

// Disposable pre-production target. It tracks successful master builds and
// receives the exact immutable image later promoted to production.
new LectorCloudCanaryStack(app, 'LectorCloudStaging', {
  env,
  deploymentName: 'staging',
  hostname: 'staging.lector.dev',
  paramPrefix: '/lector/staging',
  retainData: false,
  enableLitestream: false,
  description:
    'Lector cloud staging - staging.lector.dev with Paddle sandbox and disposable data (#304)',
});

// Separate stack on purpose: deploying CI credentials must never risk
// replacing the canary instance (see ci-stack.ts).
new LectorCanaryCiStack(app, 'LectorCanaryCi', {
  env,
  description:
    'GitHub OIDC deploy role for the lector cloud canary - assumed by docker.yml deploy-canary',
});

// Also compute-free and always safe to deploy (see backup-stack.ts).
new LectorCanaryBackupStack(app, 'LectorCanaryBackup', {
  env,
  description: 'Nightly DLM snapshots of the lector canary data volume - keep last 30',
});
