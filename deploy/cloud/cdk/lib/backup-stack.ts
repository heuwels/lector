import { CfnOutput, Duration, Stack, StackProps, Tags } from 'aws-cdk-lib';
import * as dlm from 'aws-cdk-lib/aws-dlm';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * Nightly backups of the canary's data volume (the SQLite DB + dictionaries
 * at /srv/lector/data) via Data Lifecycle Manager: one EBS snapshot per night,
 * keep the last 30. No agents, no cron on the box — DLM is a managed
 * scheduler that snapshots volumes by tag.
 *
 * Crash-consistency is enough here: SQLite runs in WAL mode, and a
 * point-in-time snapshot taken mid-write recovers exactly like a power loss
 * (WAL replay/rollback on next open). DB + WAL live on the same volume, so
 * the snapshot is internally consistent.
 *
 * This stack also owns the Litestream replica bucket (#270): continuous WAL
 * replication → S3 gives second-level RPO on top of the nightly snapshots
 * (which stay useful — they also cover the dictionaries/books). The sidecar
 * itself lives in the canary stack's compose file; access is granted HERE via
 * a bucket policy keyed on the instance role's `stack=cloud-canary` principal
 * tag, because attaching an identity policy would mean deploying the canary
 * stack — and any UserData drift there replaces the instance. Same-account S3
 * access needs only one side (identity OR resource policy) to allow.
 *
 * Targets the INSTANCE by the canary stack's `stack=cloud-canary` tag with
 * the boot volume excluded, rather than tagging the data volume directly:
 * instance tags are CloudFormation-managed, so a replacement instance is
 * picked up automatically — no out-of-band volume tag to forget (a silently
 * dead backup policy being the worst possible failure mode).
 *
 * Like LectorCanaryCiStack, deliberately separate from the instance stack —
 * no compute here, always safe to deploy.
 */

export class LectorCanaryBackupStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const dlmRole = new iam.Role(this, 'DlmRole', {
      assumedBy: new iam.ServicePrincipal('dlm.amazonaws.com'),
      description: 'DLM execution role for lector canary nightly data-volume snapshots',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSDataLifecycleManagerServiceRole',
        ),
      ],
    });

    const policy = new dlm.CfnLifecyclePolicy(this, 'NightlyDataSnapshot', {
      // DLM descriptions allow only [0-9A-Za-z _-] — no commas or colons.
      description: 'lector canary nightly data-volume snapshot - keep last 30',
      state: 'ENABLED',
      executionRoleArn: dlmRole.roleArn,
      policyDetails: {
        policyType: 'EBS_SNAPSHOT_MANAGEMENT',
        resourceTypes: ['INSTANCE'],
        // stack=cloud-canary is applied by LectorCloudCanaryStack to the
        // instance; unique in this account, and survives instance replacement.
        targetTags: [{ key: 'stack', value: 'cloud-canary' }],
        parameters: { excludeBootVolume: true },
        schedules: [
          {
            name: 'nightly-16utc-keep30',
            // 16:00 UTC = 02:00 Sydney (03:00 in AEDT summer) — the single
            // implicit user is asleep; snapshots are online either way.
            createRule: { interval: 24, intervalUnit: 'HOURS', times: ['16:00'] },
            // Count-based on purpose: if snapshot creation ever silently
            // stops, the newest 30 are kept forever. An age-based rule would
            // keep deleting and could drain the history to zero.
            retainRule: { count: 30 },
            copyTags: true,
            tagsToAdd: [
              { key: 'Name', value: 'lector-canary-data-nightly' },
              { key: 'backup', value: 'lector-canary-nightly' },
            ],
            variableTags: [{ key: 'instance-id', value: '$(instance-id)' }],
          },
        ],
      },
    });

    // ── Litestream replica bucket (#270) ──────────────────────────────────
    // Deterministic name so the canary box's litestream.yml can reference it
    // without cross-stack exports. Unversioned on purpose: Litestream manages
    // its own generations and prunes by its `retention` setting; the nightly
    // EBS snapshots above are the independent safety net.
    const litestreamBucket = new s3.Bucket(this, 'LitestreamBucket', {
      bucketName: `lector-canary-litestream-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(7) }],
    });

    // Grant the canary instance by principal tag (applied to its role by
    // Tags.of() in canary-stack.ts) — see the header for why not an identity
    // policy. Litestream needs get/put/delete on objects + list on the bucket.
    litestreamBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [litestreamBucket.arnForObjects('*')],
        principals: [new iam.AccountPrincipal(this.account)],
        conditions: { StringEquals: { 'aws:PrincipalTag/stack': 'cloud-canary' } },
      }),
    );
    litestreamBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [litestreamBucket.bucketArn],
        principals: [new iam.AccountPrincipal(this.account)],
        conditions: { StringEquals: { 'aws:PrincipalTag/stack': 'cloud-canary' } },
      }),
    );

    Tags.of(this).add('project', 'lector');
    Tags.of(this).add('stack', 'canary-backup');

    new CfnOutput(this, 'LitestreamBucketName', {
      value: litestreamBucket.bucketName,
      description: 'S3 bucket receiving continuous Litestream replication (#270)',
    });

    new CfnOutput(this, 'LifecyclePolicyId', {
      value: policy.ref,
      description: 'DLM policy id (aws dlm get-lifecycle-policy --policy-id ...)',
    });
    new CfnOutput(this, 'ListSnapshotsHint', {
      value:
        'aws ec2 describe-snapshots --owner-ids self --filters Name=tag:backup,Values=lector-canary-nightly --query "sort_by(Snapshots,&StartTime)[].[StartTime,SnapshotId,VolumeId]" --output table',
      description: 'List the nightly snapshots',
    });
  }
}
