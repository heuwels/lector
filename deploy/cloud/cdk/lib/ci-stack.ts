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
const PRODUCTION_DEPLOY_ROLE_NAME = 'lector-canary-github-deploy';
const STAGING_DEPLOY_ROLE_NAME = 'lector-staging-github-deploy';

export class LectorCanaryCiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // One provider per URL per account — if another stack ever needs GitHub
    // OIDC, import this one instead of creating a second.
    const githubOidc = new iam.OpenIdConnectProvider(this, 'GithubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const createDeployRole = (
      constructId: string,
      roleName: string,
      environment: 'staging' | 'production',
      targetStack: 'cloud-staging' | 'cloud-canary',
    ) => {
      const role = new iam.Role(this, constructId, {
        roleName,
        description: `GitHub Actions (${GITHUB_REPO}, ${environment}) - deploy via SSM`,
        assumedBy: new iam.WebIdentityPrincipal(githubOidc.openIdConnectProviderArn, {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            // Jobs that reference a GitHub Environment receive an environment-
            // scoped OIDC subject. The production environment supplies the human
            // approval gate; neither role can be assumed by a plain branch job.
            'token.actions.githubusercontent.com:sub': `repo:${GITHUB_REPO}:environment:${environment}`,
          },
        }),
      });

      role.addToPolicy(
        new iam.PolicyStatement({
          // Target by tag, not instance id, so
          // instance replacement (new AMI, resize) never strands CI on a stale id.
          sid: 'SendCommandToEnvironmentByTag',
          actions: ['ssm:SendCommand'],
          resources: [`arn:${this.partition}:ec2:${this.region}:${this.account}:instance/*`],
          conditions: {
            StringEquals: {
              'ssm:resourceTag/project': 'lector',
              'ssm:resourceTag/stack': targetStack,
            },
          },
        }),
      );
      role.addToPolicy(
        new iam.PolicyStatement({
          // SendCommand authorizes against the document AND the target.
          sid: 'SendCommandRunShellScript',
          actions: ['ssm:SendCommand'],
          resources: [`arn:${this.partition}:ssm:${this.region}::document/AWS-RunShellScript`],
        }),
      );
      role.addToPolicy(
        new iam.PolicyStatement({
          // Neither action supports resource-level scoping.
          sid: 'ResolveInstanceAndPollResult',
          actions: ['ssm:GetCommandInvocation', 'ec2:DescribeInstances'],
          resources: ['*'],
        }),
      );
      return role;
    };

    const productionDeployRole = createDeployRole(
      'GithubDeployRole',
      PRODUCTION_DEPLOY_ROLE_NAME,
      'production',
      'cloud-canary',
    );
    const stagingDeployRole = createDeployRole(
      'GithubStagingDeployRole',
      STAGING_DEPLOY_ROLE_NAME,
      'staging',
      'cloud-staging',
    );

    Tags.of(this).add('project', 'lector');
    Tags.of(this).add('stack', 'canary-ci');

    new CfnOutput(this, 'GithubDeployRoleArn', {
      value: productionDeployRole.roleArn,
      description: 'role-to-assume for the production approval job in docker.yml',
    });
    new CfnOutput(this, 'GithubStagingDeployRoleArn', {
      value: stagingDeployRole.roleArn,
      description: 'role-to-assume for the automatic staging deploy job in docker.yml',
    });
  }
}
