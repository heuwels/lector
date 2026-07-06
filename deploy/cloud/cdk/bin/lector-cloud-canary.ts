#!/usr/bin/env bun
import { App } from 'aws-cdk-lib';
import { LectorCloudCanaryStack } from '../lib/canary-stack';

const app = new App();

new LectorCloudCanaryStack(app, 'LectorCloudCanary', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    // Default region for the canary: us-east-1 — an English-language SaaS
    // skews US/EU, so origin latency belongs there (Cloudflare fronts it
    // everywhere regardless). Override with CDK_DEFAULT_REGION / AWS_REGION.
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description:
    'Lector cloud canary - app.lector.dev behind Cloudflare Access via a Cloudflare Tunnel (heuwels/lector#242)',
});
