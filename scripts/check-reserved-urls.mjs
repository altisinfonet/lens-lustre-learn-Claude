#!/usr/bin/env node
/**
 * F-93 — the reserved-URL list must be DERIVED, never hand-maintained.
 *
 * WHY THIS SCRIPT EXISTS, stated first because it is the whole point.
 * The vanity route is a catch-all `/:customUrl` and every specific route is
 * matched BEFORE it. A member whose generated URL equals a route's first
 * segment is UNREACHABLE, and nothing anywhere looks broken — no error, no
 * 404, no log line. Under the change window they are stuck with it for a year.
 *
 * The reserved list was hand-built once by grepping single-segment routes
 * (`path="/x"`), which silently skipped every NESTED route because those carry
 * a colon or a second segment — `path="/page/:slug"` never matched. That list
 * was short by eleven, and the eleven included `page`, `post`, `entry`,
 * `settings` and `admin`. Page and Post are real surnames. A member called
 * "Page" would have generated `page` and vanished.
 *
 * So the list is not copied here. It is EXTRACTED from the same files that
 * create the collision — App.tsx for routes, public/ for paths Cloudflare
 * serves before React ever loads — and compared against what the migration
 * actually seeds. A route added next month without a matching reserved row
 * fails this check instead of swallowing a member.
 *
 * Exit 0 = every derived path is reserved. Exit 1 = at least one is not.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_TSX = resolve(ROOT, 'src/App.tsx');
const PUBLIC_DIR = resolve(ROOT, 'public');
const SEED_SQL = resolve(ROOT, 'supabase/migrations/20260910_0006_f93_reserved_custom_urls.sql');

/** The build output directory Cloudflare serves; it is not in public/. */
const BUILD_OUTPUT_DIRS = ['assets'];

/** First path segment of a route, or null for the ones that cannot collide. */
export function firstSegment(routePath) {
  if (typeof routePath !== 'string') return null;
  const trimmed = routePath.trim();
  if (trimmed === '' || trimmed === '*' || trimmed === '/') return null;
  const seg = trimmed.replace(/^\/+/, '').split('/')[0];
  // `/:customUrl` IS the vanity route itself — it is the catch-all we are
  // protecting, not a name that shadows it.
  if (seg === '' || seg.startsWith(':')) return null;
  return seg.toLowerCase();
}

export function routesFromAppTsx(source) {
  const out = new Set();
  for (const m of source.matchAll(/path\s*=\s*"([^"]*)"/g)) {
    const seg = firstSegment(m[1]);
    if (seg) out.add(seg);
  }
  return out;
}

export function staticPathsFrom(entries, extraDirs = BUILD_OUTPUT_DIRS) {
  const out = new Set(extraDirs.map((d) => d.toLowerCase()));
  for (const name of entries) out.add(name.toLowerCase());
  return out;
}

/** Pull the seeded values out of the migration's VALUES list. */
export function reservedFromSeedSql(sql) {
  const marker = sql.indexOf('-- BEGIN DERIVED RESERVED VALUES');
  const end = sql.indexOf('-- END DERIVED RESERVED VALUES');
  if (marker < 0 || end < 0 || end < marker) {
    throw new Error(
      'check-reserved-urls: the seed migration is missing its DERIVED RESERVED VALUES markers. ' +
      'Without them this check cannot tell which rows the migration seeds, and a green run ' +
      'would mean nothing. Restore the markers rather than deleting this check.'
    );
  }
  const block = sql.slice(marker, end);
  const out = new Set();
  for (const m of block.matchAll(/\('([^']+)'/g)) out.add(m[1].toLowerCase());
  return out;
}

function main() {
  const derived = new Set([
    ...routesFromAppTsx(readFileSync(APP_TSX, 'utf8')),
    ...staticPathsFrom(readdirSync(PUBLIC_DIR)),
  ]);
  const reserved = reservedFromSeedSql(readFileSync(SEED_SQL, 'utf8'));

  const missing = [...derived].filter((d) => !reserved.has(d)).sort();

  console.log(`derived from App.tsx + public/ : ${derived.size}`);
  console.log(`seeded by the migration        : ${reserved.size}`);

  if (missing.length > 0) {
    console.error('\nFAILED — these paths exist but are NOT reserved:\n');
    for (const m of missing) console.error(`  ${m}`);
    console.error(
      '\nEach one is a name a member could be assigned, which would make that member\n' +
      'unreachable forever behind the route of the same name, with nothing appearing\n' +
      'broken. Add them to the seed migration. Do NOT delete them from App.tsx or\n' +
      'public/ to make this pass.\n'
    );
    process.exit(1);
  }

  console.log('\nOK — every route first-segment and every statically served path is reserved.');
  // Extra reserved entries are fine and expected: the RPC's historical words
  // (admin, api, www, root …) guard names no route uses today.
}

if (import.meta.url === `file://${process.argv[1]}`) main();
