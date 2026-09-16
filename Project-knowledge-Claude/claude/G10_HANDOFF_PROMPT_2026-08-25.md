PROJECT: 50mm Retina World — Master Execution Plan Rev 3.0 (+ Erratum E-1), gate G10.
REPO: altisinfonet/lens-lustre-learn-Claude

════════ FIRST ACTION — BEFORE ANYTHING ELSE ════════

Verify you have PUSH, not read-only:

  git fetch origin '+refs/heads/*:refs/remotes/origin/*' --prune
  git push --dry-run origin HEAD:refs/heads/tool/pushcheck-$(date +%s)
  gh api repos/altisinfonet/lens-lustre-learn-Claude --jq .permissions

If ANY of those returns 403, or "not in this session's authorized repository set", or
mentions add_repo — STOP. Tell me in one line and do nothing else. Do NOT hand me commands
to paste. This session exists specifically so you can push; I am not going to touch the PC.

If all three succeed, say "PUSH OK" and continue.

════════ READ THESE FIRST ════════

  claude/PROJECT_MASTER_RECORD.md                          <- start here, updated 2026-08-25
  claude/G10_STAGING_VERIFICATION_AND_17_CHECKLIST_2026-08-25.md
  claude/PR101_PRODUCTION_RELEASE_VERIFIED_2026-08-25.md
  claude/CERT_MIGRATIONS_REVIEW_2026-08-25.md
  claude/G10_SCHEMA_GUARD_REV3_2026-08-25.md
  claude/G10_PRODUCTION_SCHEMA_APPLIED_2026-08-25.md
  claude/DECISION_HEADING_KEEP_AND_BRANCH_PROTECTION_2026-08-25.md

The governing document is 50mm_Master_Execution_Plan_v3.docx — gates G0–G10, §12.4 promotion
procedure, §14 hard stops, §17 final checklist. Where anything disagrees with it about how
code reaches production, Rev 3.0 wins.

════════ STATE, MEASURED 2026-08-25 ════════

  main     b671e1fb0c5bcf145d442076c229eca888afd674
           tree db8df5679ab812be4f0ba9a3284df7dc2f02c3e1   (PR #101, shipped to production)
  staging  c92d5345c69908caeff5ed08aabab559c5872b47
           tree 646f0592bc89e4cf3cf9b91a9825d8016453210d
  production Supabase  jtdtehuqtinjxropkkcn   latest migration 20260825115208
  staging    Supabase  ztzutckwdhetphwghuzj

VERIFIED GREEN on main's shipped tree: tsc exit 0 · vitest 167 files / 2,345 tests passed /
0 failed · schema guard 105 RPC names, 122 call sites, 122 argument-checked, 0 name-only ·
all 105 RPCs checked against LIVE production = 0 missing, 0 incompatible. Expand-then-deploy
held: production had the schema before the code merged.

OWNER-ATTESTED: branch protection ruleset `protect-main` is Active — targets the default
branch, empty bypass list, requires a pull request, required approvals 0, blocks force pushes,
restricts deletions. HS-12 is CLOSED. Re-attest on promotion day. NEVER record it as
independently verified (§17-7 / §3.1) — no session can read the setting.

════════ DO THESE, IN ORDER ════════

1. Commit the 3 attached rollback SQL files into supabase/rollback/ via a PR into staging.
   None exist today; Rev 3.0 §13.1 requires one per migration. FIRST confirm the DRAFT
   heading rollback against the real forward migration
   supabase/migrations/UNAPPLIED_20260825170000_certificate_custom_heading.sql — the draft was
   reconstructed from staging's live schema, not from that file.

2. Commit the 3 attached schema-guard files via a PR into staging:
     scripts/verify-schema-dependencies.mjs
     scripts/test-schema-dependencies.mjs
     .github/workflows/verify-schema-dependencies.yml
   Run its harness first — it must print 41/41 before you trust it. Then wire the workflow as
   a required status check. Until it is a required check it catches nothing automatically; it
   has already caught two real defects by hand.

3. Execute Rev 3.0 §5.3 secret-isolation negative test FRESH for this RC: throwaway branch
   outside both lanes, push-triggered workflow printing ONLY "EMPTY" or "NON-EMPTY", run it,
   record the run ID and the literal log line, delete the branch. Never print a secret value.
   Do NOT inherit G3's evidence — the plan forbids it.

4. Capture CI evidence for §17-4: run IDs AND job-level results for both lanes on the exact
   tree. Local runs are explicitly not a substitute where the checklist asks for CI.

5. Record the §17-9 rollback target. Already verified: tree
   a0c3f34d724867f0a10fc768f6987e21fd4ddbfa, commit 32930e75b1d87d361f44e4b4f90dabf9deeda3e1
   — the entire delta to main at that point was two .sql files; src/, package.json,
   package-lock.json, vite.config.ts, index.html, public/, scripts/ and functions/ were all
   IDENTICAL. Still missing: its Cloudflare Pages deployment ID (owner must read it).

6. Write the §10 Release Candidate record for PR #101. It shipped without a §12.4 freeze,
   without an approved/* tag, without an RC record and without §5.3. The content verifies
   clean; the control does not exist. Record that honestly.

7. Then re-run the §17 twelve-line checklist and report which lines are now closed.

════════ STANDING RULES — ABSOLUTE ════════

- Report only VERIFIED / OWNER-ATTESTED / BLOCKED / NOT APPLICABLE / NOT YET VERIFIED.
  Unknown is never PASS. Never write "done", "should work", "assumed", "inherited",
  "probably" or "looks good" in place of evidence.
- Never claim VERIFIED unless you executed or inspected it IN THAT TURN. Re-measure every
  time; never report from memory.
- Never print, quote, hash or partially display any secret. Never ask me to paste one.
- Never modify main, production Supabase, production R2 or production Cloudflare unless the
  live gate authorises it.
- Never copy production users, auth records, photographs, storage objects, vault secrets or
  application data into staging.
- Never weaken or remove an existing isolation test to get green (hard stop HS-2).
- Schema before code, always. A new capability gets a NEW function name, never an in-place
  signature change.
- Any mismatch = STOP and investigate. Any unexpected production change = STOP.
- If you hit a tool limitation, STOP and tell me what access you need. Do not invent a
  workaround. Do not claim success.
- Do NOT start: Node 20, bun/npm, svgo, branch aliases, the stale `Main` rule, the health
  task, or any unrelated cleanup. All post-G10.
- ANOTHER CLAUDE SESSION IS ACTIVELY PUSHING to staging and main. Re-fetch before every
  decision — a tree captured ten minutes ago may already be stale. Never promote a branch
  assembled with GitHub's "Add files via upload": one such branch silently dropped five files
  and failed 7 tests. Always run the FULL suite against the exact tree you intend to ship.

Start with the push check. One line. Then begin step 1.
