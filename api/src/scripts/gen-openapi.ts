/**
 * Generates the OpenAPI document for the Lector API.
 *
 *   bun run src/scripts/gen-openapi.ts                 # write api/openapi.json
 *   bun run src/scripts/gen-openapi.ts --check          # verify, write nothing
 *   bun run src/scripts/gen-openapi.ts --include-internal --out /tmp/all.json
 *
 * From the repository root, use the npm scripts instead:
 *
 *   npm run gen:openapi
 *   npm run gen:openapi:check
 *
 * Paths, methods and token scopes come from the live Hono route table
 * (`src/routes/registry.ts`). Prose and payload shapes come from
 * `src/lib/openapi/annotations.ts`. The script imports the route modules, so
 * it needs no server and no database.
 *
 * `--check` exits 1 when the document on disk is stale, or when a route has no
 * annotation. That is the gate that keeps the published API documentation
 * honest: a new endpoint fails the check until somebody documents it.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { buildDocument } from '../lib/openapi/build';

const DEFAULT_OUT = join(import.meta.dir, '..', '..', 'openapi.json');

interface Args {
  check: boolean;
  includeInternal: boolean;
  out: string;
  quiet: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    check: false,
    includeInternal: false,
    out: DEFAULT_OUT,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') args.check = true;
    else if (arg === '--include-internal') args.includeInternal = true;
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--out') args.out = argv[++i] ?? DEFAULT_OUT;
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function serialize(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const { document, drift, included } = buildDocument({
    includeInternal: args.includeInternal,
  });
  const serialized = serialize(document);

  const log = (line: string) => {
    if (!args.quiet) console.log(line);
  };

  log(`${included.length} endpoint(s) in the document.`);

  let failed = false;

  if (drift.undocumented.length > 0) {
    failed = true;
    console.error(
      `\n${drift.undocumented.length} route(s) have no entry in src/lib/openapi/annotations.ts:`,
    );
    for (const key of drift.undocumented) console.error(`  ${key}`);
    console.error('\nAdd one entry per route, then run this script again.');
  }

  if (drift.stale.length > 0) {
    failed = true;
    console.error(`\n${drift.stale.length} annotation(s) describe a route that no longer exists:`);
    for (const key of drift.stale) console.error(`  ${key}`);
    console.error('\nDelete or rename those entries.');
  }

  if (drift.schemaless.length > 0) {
    log(
      `\n${drift.schemaless.length} documented endpoint(s) have no response schema yet (not a failure):`,
    );
    for (const key of drift.schemaless) log(`  ${key}`);
  }

  if (args.check) {
    if (!existsSync(args.out)) {
      console.error(`\n${args.out} does not exist. Run the generator.`);
      return 1;
    }
    if (readFileSync(args.out, 'utf8') !== serialized) {
      console.error(`\n${args.out} is out of date. Run the generator and commit the result.`);
      return 1;
    }
    log(`\n${args.out} is up to date.`);
    return failed ? 1 : 0;
  }

  if (failed) {
    console.error('\nRefusing to write an incomplete document.');
    return 1;
  }

  writeFileSync(args.out, serialized);
  log(`\nWrote ${args.out}`);
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
