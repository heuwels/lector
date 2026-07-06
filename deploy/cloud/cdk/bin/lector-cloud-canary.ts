#!/usr/bin/env bun
import { App } from 'aws-cdk-lib';
import { LectorCloudCanaryStack } from '../lib/canary-stack';

const app = new App();

new LectorCloudCanaryStack(app, 'LectorCloudCanary', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    // Default region for the canary; override with CDK_DEFAULT_REGION or
    // AWS_REGION in the deploy environment.
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
  },
  description:
    'Lector cloud canary — app.lector.dev behind Cloudflare Access via a Cloudflare Tunnel (heuwels/lector#242)',
});
