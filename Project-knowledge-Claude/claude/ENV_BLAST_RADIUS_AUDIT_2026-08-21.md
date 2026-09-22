# .ENV DELETION — BLAST-RADIUS AUDIT (8-agent parallel sweep, 2026-08-21)

Context: PR #87 deletes the committed `.env`. This audit enumerates every consumer that
implicitly depended on it, so the workflow-env fix is complete on the first try.

## CI workflows — the fix commit (5 step-level env blocks, 4 files)
| step | env |
|---|---|
| web-build.yml:47 `npm run build` | production trio (guard step after it asserts prod ref) |
| ui-gate.yml:113 `npm run ui:gate` | synthetic trio (hermetic; sweep proven 148/0 with it; fork PRs get no secrets; fakeBackend intercepts fetch) |
| android-build.yml:363 `npm run ui:gate` | synthetic trio |
| android-build.yml:519 `npm run build` | production trio (dist ships inside the APK) |
| health.yml:55 `health-check.mjs` | production VITE_SUPABASE_PUBLISHABLE_KEY (script's fallback was readFileSync('../.env') — verified at line ~90) |

CLEAN (audited, no change): security.yml, typecheck.yml, apply-migration.yml.
RULE (verified): env STEP-LEVEL ONLY — test-isolation-guard.mjs RED-3 requires
VITE_SUPABASE_URL absent; job-level env breaks the harness by design.

## Non-CI entrypoints (24) — deferred housekeeping, NOT in the fix commit
Local dev (`npm run dev`, preview, ui:harness/shot, vocab:snapshot, audits/*.mjs) now
requires `.env.local` (covered by `.env.example`); docs that say bare `npm run build`
(README:36, PROJECT_MASTER_RECORD:96, start-here:55, how-to-ship:128,
ANDROID_RELEASE_RUNBOOK:41, CAPACITOR_SETUP:33/103/108, STORE_LISTING:77,
ui-checking-policy:23/88) need a one-line ".env.local first" note in a later docs pass.

## Full per-consumer detail

### .github/workflows/web-build.yml — NEEDS_ENV
- [ok] `.github/workflows/web-build.yml:35` — actions/checkout@v4 → none
- [ok] `.github/workflows/web-build.yml:37` — actions/setup-node@v4 (node-version-file: .node-version) → none
- [ok] `.github/workflows/web-build.yml:44` — npm ci --no-audit --no-fund → none
- [NEEDS ENV] `.github/workflows/web-build.yml:47` — npm run build  (= vite build && node scripts/generate-redirects.mjs) → production-values
  - BROKEN by the .env deletion — the step has no env: block. (1) scripts/generate-redirects.mjs:6-10 hard-exits 1 unless VITE_SUPABASE_URL matches https://<ref>.supabase.co, so the step now fails outright. (2) Even before that, vite build bakes import.meta.env.VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY into the bundle (src/integrations/supabase/client.ts:8-9 and ~10 other call sites) and subst
- [ok] `.github/workflows/web-build.yml:52` — shell: test -f dist/index.html; test -d dist/assets; find dist/assets -name '*.js' | wc -l → none
- [ok] `.github/workflows/web-build.yml:61` — node scripts/test-isolation-guard.mjs → none
- [ok] `.github/workflows/web-build.yml:64` — node scripts/verify-bundle-isolation.mjs → none

### .github/workflows/ui-gate.yml — NEEDS_ENV
- [ok] `.github/workflows/ui-gate.yml:45` — uses: actions/checkout@v4 → none
- [ok] `.github/workflows/ui-gate.yml:47` — uses: actions/setup-node@v4 (node-version-file: .node-version) → none
- [ok] `.github/workflows/ui-gate.yml:54` — npm ci --no-audit --no-fund → none
- [ok] `.github/workflows/ui-gate.yml:73` — uses: actions/cache@v4 (path: ~/.cache/ms-playwright) → none
- [ok] `.github/workflows/ui-gate.yml:95` — npx playwright install chromium (3-attempt retry loop) → none
- [NEEDS ENV] `.github/workflows/ui-gate.yml:113` — npm run ui:gate  →  node tools/uishot/gate.mjs  →  spawns `npx vite --host 127.0.0.1 --port 5199 --s → synthetic-values
  - The sweep drives the Vite DEV SERVER, not vitest, so vitest.config.ts's synthetic env does NOT apply here and no env: block exists on this step. capture.mjs loads uiharness.html → /src/uiharness/main.tsx → await import("./scenes") (main.tsx:~137); scenes.tsx statically imports real app components and realScreens.tsx lazy-imports real pages (Feed, Login, Profile, PostDetail…). 296 files under src/ 
- [ok] `.github/workflows/ui-gate.yml:118` — uses: actions/upload-artifact@v4 (path: /tmp/shots, if: always()) → none

### .github/workflows/security.yml — CLEAN
- [ok] `.github/workflows/security.yml:32` — actions/checkout@v4 (project-rules) → none
- [ok] `.github/workflows/security.yml:33` — actions/setup-node@v4 (project-rules) → none
- [ok] `.github/workflows/security.yml:40` — node scripts/security-audit.mjs → none
- [ok] `.github/workflows/security.yml:46` — actions/checkout@v4 fetch-depth:0 (secrets) → none
- [ok] `.github/workflows/security.yml:50` — gitleaks/gitleaks-action@v2 → none
- [ok] `.github/workflows/security.yml:58` — actions/checkout@v4 (dependencies) → none
- [ok] `.github/workflows/security.yml:59` — actions/setup-node@v4 (dependencies) → none
- [ok] `.github/workflows/security.yml:62` — npm ci --no-audit --no-fund → none
- [ok] `.github/workflows/security.yml:67` — npm audit || true → none
- [ok] `.github/workflows/security.yml:76` — npm audit --omit=dev --audit-level=critical → none

### .github/workflows/typecheck.yml — CLEAN
- [ok] `.github/workflows/typecheck.yml:12` — uses: actions/checkout@v4 → none
- [ok] `.github/workflows/typecheck.yml:13` — uses: actions/setup-node@v4 → none
- [ok] `.github/workflows/typecheck.yml:17` — npm ci --no-audit --no-fund → none
- [ok] `.github/workflows/typecheck.yml:19` — npx tsc --noEmit -p tsconfig.app.json → none

### .github/workflows/android-build.yml — NEEDS_ENV
- [ok] `.github/workflows/android-build.yml:242` — node scripts/security-audit.mjs → none
- [NEEDS ENV] `.github/workflows/android-build.yml:363` — npm run ui:gate (tools/uishot/gate.mjs -> spawns `npx vite` dev server + tools/uishot/capture.mjs sw → synthetic-values
  - gate.mjs:88 starts a real vite dev server with no env block and no .env to fall back on. Every real-screen scene dynamically imports app code, evaluating src/integrations/supabase/client.ts at module scope: createClient(import.meta.env.VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY) at client.ts:103 throws 'supabaseUrl is required.' when undefined, so every scene fails at module load, the sweep 
- [ok] `.github/workflows/android-build.yml:444` — npm test (vitest run) → none
- [NEEDS ENV] `.github/workflows/android-build.yml:519` — npm run build (vite build && node scripts/generate-redirects.mjs) → production-values
  - Two consumers in one command, neither satisfied now that .env is gone and the step has no env block. (1) scripts/generate-redirects.mjs:6-10 exits 1 unless VITE_SUPABASE_URL matches ^https://[a-z0-9]{15,25}\.supabase\.co$ — the step fails closed, so no AAB can currently be built at all. (2) vite build inlines VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PROJECT_ID into the dis

### .github/workflows/apply-migration.yml — CLEAN
- [ok] `.github/workflows/apply-migration.yml:81` — uses: actions/checkout@v4 → none
- [ok] `.github/workflows/apply-migration.yml:86` — shell test on $DB_URL (Refuse to start without the database credential) → none
- [ok] `.github/workflows/apply-migration.yml:101` — shell validation of inputs.migration (string compare, case globs, ls, wc) → none
- [ok] `.github/workflows/apply-migration.yml:134` — cat '${{ inputs.migration }}' (Show the SQL that is about to run) → none
- [ok] `.github/workflows/apply-migration.yml:140` — sudo apt-get install postgresql-client (Install psql) → none
- [ok] `.github/workflows/apply-migration.yml:154` — psql "$DB_URL" --set ON_ERROR_STOP=1 --echo-errors --no-psqlrc -f '${{ inputs.migration }}' (Run it) → none
- [ok] `.github/workflows/apply-migration.yml:163` — echo confirmation (Confirm) → none

### .github/workflows/health.yml — NEEDS_ENV
- [ok] `.github/workflows/health.yml:45` — uses: actions/checkout@v4 → none
- [ok] `.github/workflows/health.yml:47` — uses: actions/setup-node@v4 (node-version 20) → none
- [NEEDS ENV] `.github/workflows/health.yml:55` — node scripts/health-check.mjs (env: DEEP=1) → production-values
  - readAnonKey() in scripts/health-check.mjs:85-102 resolves the Supabase anon key from SUPABASE_ANON_KEY || VITE_SUPABASE_PUBLISHABLE_KEY, else parses the repo's .env (line 90) — the file this commit deletes — else prints CANNOT RUN and exits 2. The step's env block has only DEEP=1, so every 2-hourly run now fails and emails the owner: a permanent false alarm from the site-down watchdog. Only the pu

### other-entrypoints — NEEDS_ENV
- [NEEDS ENV] `/home/claude/repo/work/package.json:7` — npm run dev → production-values
  - Dev server starts, but src/integrations/supabase/client.ts:103 calls createClient(import.meta.env.VITE_SUPABASE_URL) at module scope; with the committed .env gone the value is undefined and supabase-js throws 'supabaseUrl is required.' -> blank page. Real backend values needed for dev to be useful (gitignored .env.local per .env.example).
- [NEEDS ENV] `/home/claude/repo/work/package.json:8` — npm run build → production-values
  - Tail step scripts/generate-redirects.mjs:6-10 exits 1 when VITE_SUPABASE_URL is unset/invalid (fails closed by design). Bare local builds that previously inherited the committed .env now stop. Produces the deployable dist/, so a real build needs the target project's values.
- [NEEDS ENV] `/home/claude/repo/work/package.json:9` — npm run build:dev → production-values
  - No generate-redirects tail, so it exits 0 with env unset and SILENTLY emits a broken artifact: undefined supabase URL baked into the bundle and literal %VITE_SUPABASE_URL% left in index.html:62-63. A trap, not a loud failure — worth adding a guard or env note.
- [NEEDS ENV] `/home/claude/repo/work/package.json:11` — npm run preview → production-values
  - vite preview reads no env itself; it serves dist/ from a prior `npm run build`, which now fails without env — so a fresh preview is impossible bare, and a stale dist/ may carry the wrong backend. Pair with the same values used for the build being previewed.
- [NEEDS ENV] `/home/claude/repo/work/package.json:18` — npm run ui:harness → synthetic-values
  - Harness scenes dynamically import app modules; the supabase client module throws at evaluation with VITE_* unset, so every scene crashes. fakeBackend.ts:228 tolerates a missing env for its own base URL but cannot prevent the module-scope createClient throw. Harness is hermetic by design (fixtures, no network) — synthetic trio like vitest.config.ts:12-16 suffices.
- [NEEDS ENV] `/home/claude/repo/work/package.json:19` — npm run ui:shot → synthetic-values
  - tools/uishot/capture.mjs:27-28 reads only UI_HARNESS_BASE/UI_SHOT_DIR; the break is transitive — the harness dev server it screenshots needs VITE_* or every scene renders a crash. Synthetic values on the server side make the sweep hermetic again.
- [NEEDS ENV] `/home/claude/repo/work/package.json:20` — npm run ui:gate → synthetic-values
  - tools/uishot/gate.mjs:88 spawns `npx vite` inheriting process env; without VITE_* the app modules throw at the supabase client and the sweep fails on every scene. Same command runs locally and in CI, so the fix must work for both — synthetic env keeps it hermetic.
- [NEEDS ENV] `/home/claude/repo/work/package.json:16` — npm run vocab:snapshot → production-values
  - scripts/snapshot-vocabulary.mjs:23-28 exits 2 without SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. It never read the committed .env (unchanged by the deletion) but refreshes docs/judging/vocabulary.source.json from the live DB — a real committed artifact, service-role key required (normally the nightly workflow's secrets).
- [NEEDS ENV] `/home/claude/repo/work/package.json:22` — npm run gate → synthetic-values
  - typecheck and vitest are hermetic (vitest.config.ts:12-16 synthetic env), but the final `npm run build` step dies at generate-redirects without VITE_SUPABASE_URL. As a pre-merge check whose dist/ is discarded, synthetic values (any https://<15-25 lowercase alnum>.supabase.co passes the regex) keep it hermetic.
- [NEEDS ENV] `/home/claude/repo/work/package.json:23` — npm run verify:isolation → production-values
  - scripts/verify-bundle-isolation.mjs:32 fails closed (R1) without VITE_SUPABASE_URL — by design. Must run with the SAME env as the build it certifies; for a real deployment lane that is the target project's values.
- [ok] `/home/claude/repo/work/package.json:24` — npm run test:isolation-guard → none
- [NEEDS ENV] `/home/claude/repo/work/scripts/generate-redirects.mjs:6` — node scripts/generate-redirects.mjs → production-values
  - Reads process.env.VITE_SUPABASE_URL and exits 1 when unset/invalid — the designed fail-closed tail of every build. Listed standalone because it is also runnable directly and is the exact line that makes bare builds stop.
- [NEEDS ENV] `/home/claude/repo/work/scripts/health-check.mjs:90` — node scripts/health-check.mjs → production-values
  - Its fallback of reading the repo's ../.env for the anon key (lines 89-95) is now dead code; without SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY exported it exits 2 'CANNOT RUN'. It probes the hardcoded production project (line 65), so the public production anon key is the right input.
- [NEEDS ENV] `/home/claude/repo/work/scripts/audits/phase_parity.mjs:41` — node scripts/audits/phase_parity.mjs → production-values
  - Unguarded readFileSync('.env') now throws ENOENT before any work — hard crash, worst break in scripts/. Runs a live-DB RPC (audit_phase_parity) with VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY; needs a patch to read process.env instead of the deleted file.
- [NEEDS ENV] `/home/claude/repo/work/scripts/audits/v3_catalog_parity.mjs:37` — node scripts/audits/v3_catalog_parity.mjs → production-values
  - Parses the repo .env when present (lines 69-87); with it gone the DB-diff half is SILENTLY SKIPPED (warn, lines 88-93) and only the TS-side 16-key assertions run — silent coverage loss rather than a crash. Full contract check diffs the live v3_stage_catalog.
- [NEEDS ENV] `/home/claude/repo/work/scripts/audits/rpc_contract_parity.mjs:63` — node scripts/audits/rpc_contract_parity.mjs → production-values
  - Requires SUPABASE_URL|VITE_SUPABASE_URL plus a key in process.env, exit 1 otherwise (lines 62-73). Never auto-loaded .env, so behavior is unchanged by the deletion, but it is a scripts/ entrypoint reading process.env.VITE_* against the live DB.
- [NEEDS ENV] `/home/claude/repo/work/tools/uishot/repro-crop-upload.mjs:29` — node tools/uishot/repro-crop-upload.mjs [scene] → synthetic-values
  - Drives the real composer against the harness at 127.0.0.1:5199; the harness dev server it targets needs VITE_* set or app modules throw at the supabase client (same failure as ui:harness). Fixture-driven, no real backend.
- [ok] `/home/claude/repo/work/scripts/test-agent/run-checks.mjs:15` — node scripts/test-agent/run-checks.mjs → none
- [NEEDS ENV] `/home/claude/repo/work/README.md:36` — npm run dev → production-values
  - Quickstart is clone -> npm i -> npm run dev with no env step; now yields a blank page (client module throws). Doc needs a 'cp .env.example .env.local and fill values' step before the dev command.
- [NEEDS ENV] `/home/claude/repo/work/PROJECT_MASTER_RECORD.md:96` — npm run dev / npm run build → production-values
  - Section 5 'Run locally' DOES instruct creating an env file first (lines 92-95) so it still works, but it names '.env' — now gitignored and no longer the blessed name; should reference .env.example -> .env.local.
- [NEEDS ENV] `/home/claude/repo/work/docs/start-here.md:55` — npm run build (full gate: tsc, vitest, build, security-audit) → synthetic-values
  - The 'every change passes the full gate' instruction now fails at generate-redirects with no env. The gate's dist/ is discarded, so synthetic values are the hermetic fix; doc should say so.
- [NEEDS ENV] `/home/claude/repo/work/docs/how-to-ship-code-and-sql.md:128` — npm run build (in 'The gate — run all four before shipping anything') → synthetic-values
  - Same bare-build break as start-here.md: the fenced gate block stops at generate-redirects without VITE_SUPABASE_URL. Hermetic check -> synthetic values, with a note for real-deploy builds.
- [NEEDS ENV] `/home/claude/repo/work/ANDROID_RELEASE_RUNBOOK.md:41` — npm run build (step 6 — builds the web app into dist/) → production-values
  - This dist/ is the real web bundle wrapped into the APK — a production artifact. The runbook step now fails bare; it must specify the production Pages values (and running verify:isolation after).
- [NEEDS ENV] `/home/claude/repo/work/CAPACITOR_SETUP.md:33` — npm run build (also lines 103, 108: npm run build && npx cap sync) → production-values
  - Capacitor wraps dist/ into the shipped app; every 'build && cap sync' instruction in this doc now fails bare and, once env is supplied, bakes that backend into the APK — must be the intended real values.
- [NEEDS ENV] `/home/claude/repo/work/STORE_LISTING.md:77` — npm run build && npx cap sync → production-values
  - Same pattern as CAPACITOR_SETUP.md — a real store-bound artifact built from dist/; the bare command now fails at generate-redirects.
- [NEEDS ENV] `/home/claude/repo/work/docs/ui-checking-policy.md:23` — npm run ui:harness then npm run ui:shot (also line 88) → synthetic-values
  - The policy doc's mandated commands now crash every scene at the supabase client module. The harness is deliberately hermetic (fixtures, fake backend), so the doc should prescribe the synthetic trio, mirroring vitest.config.ts.
