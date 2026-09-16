# PHASE 1 · CONTROL CYCLE 1 — RECONCILIATION (read-only)

No production change. No code change. Evidence only.

## GIT — RECONCILED
```
HEAD          7fd6f82bfbda3386e63a3af6608f91989f2213a2
origin/main   7fd6f82bfbda3386e63a3af6608f91989f2213a2
ahead/behind  0 / 0
working tree  0 modified, 0 untracked
```
All 15 files changed today are accounted for; `docs/error-codes.md` regenerates
byte-identical from `src/lib/errorCodes.ts` (rule 17 satisfied).

## MIGRATION LEDGER — RED, DECISION REQUIRED

| | |
|---|---|
| versioned `.sql` files in Git | **615** |
| entries in production's `supabase_migrations` ledger | **19** (earliest `20260813171159`) |

~596 migrations exist in Git that production's ledger has never heard of. They
were applied through the earlier Lovable pipeline. Consequence: `supabase db
push` / `migration up` would attempt to replay all 596 against production.
Nothing in CI runs those commands today, which is the only reason this has not
already fired.

**This cannot be resolved by guessing which side is right.** Options are
(a) baseline the ledger to current production state, (b) leave the ledger
recording only post-2026-08-13 work and pin the "never run db push" rule in CI.
Owner decision.

## VERSION-STRING DRIFT — RED (mine)
```
Git filename    supabase/migrations/20260816T1900_hashtag_index.sql
production      version 20260817051750, name "hashtag_index"
```
Two causes: I applied via the Supabase connector, which stamps its own version;
and the filename uses `20260816T1900` (13 chars + `T`), not the 14-digit format
every other file uses. Cosmetic today, misleading in any future audit.

## MISPLACED ROLLBACK — RED (mine)

`supabase/rollback/` exists and holds every rollback script — except one.
`20260816T1900_hashtag_index_ROLLBACK.sql` was written into
`supabase/migrations/` instead. `apply-migration.yml` accepts both directories
so it is not dangerous today, but a rollback script sitting in the migrations
directory is a trap for anyone who later runs a directory-ordered apply.

## PLAN ITEMS ALREADY SATISFIED — CONTRADICTION, REPORTED NOT "FIXED"

**Item 9 — "CI typecheck must actually check source files."** Already true:
`typecheck.yml` runs `tsc --noEmit -p tsconfig.app.json`, and that config
declares `include: ["src"]`. Separate observation, not the same defect:
`strict: false`, `noImplicitAny: false`, `noUnusedLocals: false` — it checks the
source weakly. Tightening it is a scope decision, not a reconciliation fix.

**Item 10 — "remove unsafe dependency-install fallback."** Already true: all
three workflows run `npm ci --no-audit --no-fund`; no `npm install`, no
`|| true`, no fallback. The only `||` match in the repo is a comment stating
the rule.

Per rule 25 these are reported as plan-vs-repository conflicts rather than
silently ticked or silently "re-fixed".

## CONTINUE-ON-ERROR INVENTORY — AMBER

Three occurrences, all in `android-build.yml`, all on the **debug side-load APK**
steps (build, prove, upload artifact), each documented as deliberate so a debug
variant cannot block the release AAB. The release AAB path carries none.
Not a violation; flagged for the owner's ruling.

## RULE-23 RECHECK (shared layer changed today)

`WallPosts.tsx` is mounted twice — Feed (`composerOnly`) and the Wall. Yesterday
the crop fix was proven on the Wall only. Re-run today against the Feed mount:
```
journey-create-from-feed  →  PASS
composer survived Crop & Upload, tag/category step opened
```

## NOT VERIFIED (stated, not converted to PASS)

- App-surface behaviour for the crop fix and for @mentions in the app caption
  box. Both are proven on the website; the app flow begins in Android's photo
  picker, which the harness cannot drive. Real-device only.
- `ComposerCaptionBoxes.test.ts` is a **source pin**, not an execution test.
  Under rule 7 it proves the shape of the file, not that the path runs. The
  execution proof for crop is `repro-crop-upload.mjs`; there is **no execution
  proof for the app mention list**.
