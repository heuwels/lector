import { CfnOutput, Stack, StackProps, Tags } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * CI deploy identity for the cloud canary — the IAM half of docker.yml's
 * deploy-canary job. GitHub Actions authenticates with a short-lived OIDC
 * token (no AWS keys in repo secrets); the role can do exactly one thing:
 * run commands over SSM on instances tagged as the canary, and read back
 * the results. What actually runs on the box is deploy/cloud/deploy-canary.sh.
 *
 * Deliberately its OWN stack, not part of LectorCloudCanaryStack: the canary
 * instance replaces on any UserData change (taking a fresh, empty data
 * volume with it), so CI-credential changes must never deploy through that
 * stack as a side effect. This one carries no compute — deploying it is
 * always safe.
 */

const GITHUB_REPO = 'heuwels/lector';
// Stable, human-typed name: .github/workflows/docker.yml references this ARN.
const DEPLOY_ROLE_NAME = 'lector-canary-github-deploy';

export class LectorCanaryCiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // One provider per URL per account — if another stack ever needs GitHub
    // OIDC, import this one instead of creating a second.
    const githubOidc = new iam.OpenIdConnectProvider(this, 'GithubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const deployRole = new iam.Role(this, 'GithubDeployRole', {
      roleName: DEPLOY_ROLE_NAME,
      description: 'GitHub Actions (heuwels/lector master) - update the canary via SSM',
      assumedBy: new iam.WebIdentityPrincipal(githubOidc.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          // Master-branch runs only — a workflow on any other ref (PRs
          // included) cannot assume this role.
          'token.actions.githubusercontent.com:sub': `repo:${GITHUB_REPO}:ref:refs/heads/master`,
        },
      }),
    });

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        // Target by tag (canary-stack.ts applies these), not instance id, so
        // instance replacement (new AMI, resize) never strands CI on a stale id.
        sid: 'SendCommandToCanaryByTag',
        actions: ['ssm:SendCommand'],
        resources: [`arn:${this.partition}:ec2:${this.region}:${this.account}:instance/*`],
        conditions: {
          StringEquals: {
            'ssm:resourceTag/project': 'lector',
            'ssm:resourceTag/stack': 'cloud-canary',
          },
        },
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        // SendCommand authorizes against the document AND the target.
        sid: 'SendCommandRunShellScript',
        actions: ['ssm:SendCommand'],
        resources: [`arn:${this.partition}:ssm:${this.region}::document/AWS-RunShellScript`],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        // Neither action supports resource-level scoping.
        sid: 'ResolveInstanceAndPollResult',
        actions: ['ssm:GetCommandInvocation', 'ec2:DescribeInstances'],
        resources: ['*'],
      }),
    );

    Tags.of(this).add('project', 'lector');
    Tags.of(this).add('stack', 'canary-ci');

    new CfnOutput(this, 'GithubDeployRoleArn', {
      value: deployRole.roleArn,
      description: 'role-to-assume for the deploy-canary job in .github/workflows/docker.yml',
    });
  }
}
