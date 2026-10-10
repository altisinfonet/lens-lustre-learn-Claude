# GATE 2+ — READY-TO-FIRE PACKAGE (prepared while Gate 1 CI runs; NOTHING executed)

Precondition: Gate 1 GREEN (PR #87 all checks green + owner merge + guard PASS visible in
the production Pages deploy log). Until then this file is inert.

## Step 3 — staging Supabase project (CLAUDE, ~2 min, on "Gate 1 green — go")
- Cost verified via API this session: **type=project, monthly, amount=0** → confirm_cost → create_project
  { name: "50mmretinaworld-staging", region: "ap-northeast-2" (same as prod), org: oaqsxhwefkyypoinylua }
- Then: record new ref as STAGING_REF everywhere; generate publishable key via get_publishable_keys.

## Step 4 — staging R2 bucket (CLAUDE, ~1 min)
- r2_bucket_create "50mm-staging" (name free — verified, account has only 50mm + agentcrm).
- OWNER (dashboard, 3 clicks each, exact paths already in the architecture audit §19):
  custom domain staging-cdn.50mmretina.com on the bucket · bucket-scoped R2 API token.

## Step 5 — Pages staging project (OWNER with my checklist — no Pages API exists)
- New Pages project "50mm-staging", Git repo altisinfonet/lens-lustre-learn-Claude,
  production branch = develop (create branch first: code session, one command),
  build command: npm run build && node scripts/verify-bundle-isolation.mjs
  env (Production): VITE_SUPABASE_URL=https://<STAGING_REF>.supabase.co,
  VITE_SUPABASE_PUBLISHABLE_KEY=<staging key>, VITE_SUPABASE_PROJECT_ID=<STAGING_REF>,
  ISOLATION_FORBIDDEN_REFS=jtdtehuqtinjxropkkcn   ← the guard then makes prod-leak impossible per deploy
- Custom domain staging.50mmretina.com. Optional: Cloudflare Access + noindex.

## Step 6 — schema baseline (OWNER one command, or code session if it gains DB URL)
- supabase db dump --schema-only from PRODUCTION → apply to staging → baseline staging ledger.
  NEVER migration replay (C5/C6). I then verify: table/policy/function counts vs prod snapshot.

## Steps 7–9 — my verification battery (CLAUDE, read-only + staging-only writes)
- Deploy edge functions to STAGING ref (deploy_edge_function — staging project only).
- Synthetic seed (deterministic accounts/posts; zero PII).
- Isolation proof: staging writes land in staging DB/bucket; production row counts and
  ref_set_md5 unchanged before/after; bundle contains zero prod refs (guard, already live).

## Standing risk log for this phase
- GitHub billing 2026-08-31 (all gates die) · Pages Preview env now = production values
  (revisit once 50mm-staging exists: point previews at staging instead).
