---
# MACHINE-READABLE. Both agents parse this block. Humans read below it.
# This file is PUBLIC (the repo is public). It must never describe an unfixed
# vulnerability. Detail lives in the private claude.ai project.
schema: 1
project: 50mm Retina
phase: B
state: DEPLOYED          # DESIGN|APPROVED|IMPLEMENTING|LOCAL_VERIFICATION|READY_FOR_REVIEW|APPROVED_FOR_PRODUCTION|DEPLOYED|POST_DEPLOY_VERIFICATION|CLOSED|BLOCKED
base_commit: 3dcd44d         # origin/main after the query-ceilings cycle
rollback_required_from: 20260813000000  # mandate start; older migrations out of scope
db_migration: 20260815064043 # newest APPLIED production migration
last_cycle: C_REALTIME        # 13 subscriptions cannot fire; D1 awaits owner
next_action: OWNER_DECISION   # D1 realtime publish-or-delete; then CDN economics
approved_hash: null          # consumed by 20260815064043
blocked_reason: null
---

# AI CONTROL — 50mm Retina

**Truth is derived, never stored.** Every field above is a *claim*. `node scripts/ai-control.mjs`
re-derives each one from git and the database and prints `READY` / `DRIFT` / `BLOCKED`.
**When the machine disagrees with this file, the machine is right.**

## Commands

| Word | Meaning |
|---|---|
| `CONTROL` | Reconcile, then continue only the currently authorised action. |
| `STATUS` | Reconcile and report. Change nothing. |
| `GO <hash>` | Execute the one approved artifact whose `git hash-object` equals `<hash>`. |
| `STOP` | Halt, record state, no cleanup. |
| `REVIEW` | Produce the 8-section gate report. |
| `ROLLBACK` | Execute the previously approved rollback file. |

## Standing authority — no per-step approval needed

Read production · run `EXPLAIN` · write code, migrations, tests, docs · run the full gate ·
commit locally · write to the claude.ai project · create Supabase **branches** and do anything
on them.

## Requires an explicit `GO` bound to a hash

Any production write. One per cycle.

## Hard ceiling — no authorisation overrides these

`DROP TABLE` · destructive production data operations · credential rotation · the upload
keystore or Play service-account JSON · publishing anything public that describes an unfixed
vulnerability · silent scope expansion · weakening any acceptance threshold to obtain a PASS.

## The rule that outranks the rest

**Discovering something adjacent is not authorisation to fix it.**
STOP → record evidence → set `state: BLOCKED` → ask.

## Evidence

`AI_EVIDENCE.md` — append-only, one line per check, command + result.
Anything that would describe an unfixed hole is recorded as an id + PASS/FAIL only; the
detail is in the private project. **Claims are not evidence; re-runnable commands are.**

## Deletion Protocol (standing rule, adopted 2026-08-14)

No cleanup job may delete an object unless BOTH hold:

1. The reference graph enumerated **successfully** — a failed reference query
   aborts the run (fail-loud). An incomplete reference set is worse than no
   answer, because it looks like an answer.
2. The run followed, in order: **dry-run → expected count → sample review →
   maximum-deletion threshold → execute → post-delete verification.**

Context: the 2026-08-14 pre-audit measured 263 live files (249 member
thumbnails among them) that the then-current reference set would have condemned
the moment the scan learned to see R2. The repair order WAS the risk.

Enforcement: `src/__tests__/deletionProtocol.test.ts` asserts every
bulk-delete-capable function implements this protocol (dry-run default,
MAX_DELETE + hard ceiling, expected_count gate, fail-loud paginated live-id
reads, empty-set refusal, post-delete verification), and that targeted
deleters on the exemption list actually exist. Shipped with B3b, 8/8
mutations caught.
