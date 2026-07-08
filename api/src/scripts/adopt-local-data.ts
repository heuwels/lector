/**
 * Manual operator command: adopt a self-host box's 'local' data into a cloud
 * account after switching LECTOR_MODE=cloud. See lib/adopt-local-data.ts for
 * the why. Dry-run by default; pass --commit to actually reassign.
 *
 *   bun run src/scripts/adopt-local-data.ts --list                    # show users
 *   bun run src/scripts/adopt-local-data.ts --to you@example.com      # dry run
 *   bun run src/scripts/adopt-local-data.ts --to you@example.com --commit
 *   bun run src/scripts/adopt-local-data.ts --to-id <userId> --commit # by raw id
 *
 * In Docker the API runs from /app/api with DATA_DIR=/app/data, so:
 *   docker compose exec <service> sh -c \
 *     'cd /app/api && DATA_DIR=/app/data bun run src/scripts/adopt-local-data.ts --to you@example.com'
 *
 * Back up first (scripts/backup.sh). Safe against the live DB in WAL mode;
 * running with the app stopped is tidiest.
 */
import { getDatabaseInstance } from '../db';
import {
  adoptLocalData,
  listAuthUsers,
  resolveUserByEmail,
  hasAuthTables,
  AdoptConflictError,
  type AuthUser,
} from '../lib/adopt-local-data';

interface Args {
  to?: string;
  toId?: string;
  commit: boolean;
  list: boolean;
  help: boolean;
}

const HELP = `adopt-local-data — reassign self-host 'local' data to a cloud account

Usage:
  --to <email>     Target account, resolved by email (case-insensitive)
  --to-id <id>     Target account, by raw Better Auth user id
  --commit         Apply the reassignment (default is a dry run — no writes)
  --list           List registered users and exit
  --help, -h       Show this help

Adopts only into a FRESH account (one that owns no data yet); it refuses
otherwise so it can never merge two users or collide on a primary key.
Idempotent: once run there is no 'local' data left to move.`;

function parseArgs(argv: string[]): Args {
  const args: Args = { commit: false, list: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--to') args.to = argv[++i];
    else if (a === '--to-id') args.toId = argv[++i];
    else if (a === '--commit') args.commit = true;
    else if (a === '--list') args.list = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      console.error(`Unknown argument: ${a}\n`);
      args.help = true;
    }
  }
  return args;
}

const fmt = (n: number): string => n.toLocaleString('en-US');

function printUsers(users: AuthUser[]): void {
  if (users.length === 0) {
    console.log(
      'No registered users yet. In cloud mode, log in once (OIDC / GitHub / email)\n' +
        'to create your account, then re-run this command.',
    );
    return;
  }
  console.log('Registered users:');
  for (const u of users) {
    console.log(`  ${u.email}  (id: ${u.id}${u.name ? `, name: ${u.name}` : ''})`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const db = getDatabaseInstance();

  if (!hasAuthTables(db)) {
    console.error(
      'This database has no Better Auth tables — it has never run in cloud mode.\n' +
        'Switch LECTOR_MODE=cloud, start the app, log in once to create your account,\n' +
        'then re-run this command.',
    );
    process.exitCode = 1;
    return;
  }

  if (args.list) {
    printUsers(listAuthUsers(db));
    return;
  }

  // Resolve the target account.
  let targetUserId: string;
  let label: string;
  if (args.toId) {
    targetUserId = args.toId;
    const match = listAuthUsers(db).find((u) => u.id === args.toId);
    label = match ? `${match.email} (id: ${match.id})` : `id: ${args.toId}`;
    if (!match) {
      console.warn(`Warning: no user row matches id ${args.toId} — proceeding anyway.\n`);
    }
  } else if (args.to) {
    const user = resolveUserByEmail(db, args.to);
    if (!user) {
      console.error(`No registered user with email ${args.to}.\n`);
      printUsers(listAuthUsers(db));
      process.exitCode = 1;
      return;
    }
    targetUserId = user.id;
    label = `${user.email} (id: ${user.id})`;
  } else {
    console.error('Specify a target: --to <email> or --to-id <userId>. See --help.');
    process.exitCode = 1;
    return;
  }

  try {
    const report = adoptLocalData(db, targetUserId, { dryRun: !args.commit });

    console.log(`Target account: ${label}`);
    if (report.totalMoved === 0) {
      console.log("Nothing to adopt — no rows are owned by 'local'. (Already migrated?)");
      return;
    }

    console.log(args.commit ? 'Reassigned to this account:' : "Rows owned by 'local' that WOULD move:");
    for (const table of Object.keys(report.moved) as (keyof typeof report.moved)[]) {
      const n = report.moved[table];
      if (n > 0) console.log(`  ${String(table).padEnd(16)} ${fmt(n).padStart(10)}`);
    }
    console.log(`  ${'TOTAL'.padEnd(16)} ${fmt(report.totalMoved).padStart(10)}`);

    if (args.commit) {
      console.log(`\nDone — moved ${fmt(report.totalMoved)} rows into ${label}.`);
    } else {
      console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.');
      console.log('Tip: back up first (scripts/backup.sh).');
    }
  } catch (err) {
    if (err instanceof AdoptConflictError) {
      console.error(err.message);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
}

main();
