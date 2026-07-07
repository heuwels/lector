import { CfnOutput, Stack, StackProps, Tags } from 'aws-cdk-lib';
import * as dlm from 'aws-cdk-lib/aws-dlm';
import * as iam from 'aws-cdk-lib/aws-iam';
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
 * the snapshot is internally consistent. Continuous replication
 * (Litestream → R2) still arrives with #217; this is the safety net until
 * then — and stays useful after, snapshots also cover the dictionaries/books.
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

    Tags.of(this).add('project', 'lector');
    Tags.of(this).add('stack', 'canary-backup');

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
