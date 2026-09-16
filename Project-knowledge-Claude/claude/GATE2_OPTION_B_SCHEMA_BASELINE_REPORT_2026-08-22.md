# GATE 2 — OPTION B SCHEMA BASELINE REPORT
2026-08-22 · Zero production writes. Zero credential resets. Staging untouched.

## VERDICT UP FRONT: **B = BLOCKED (not equivalent-capable at acceptable risk).**
Not RED for the project — nothing broke, nothing was applied. B is stopped at a genuine
technical wall, reported rather than worked around, per instruction.

---

## 1 · PRODUCTION EXTRACTION RESULTS
| Category | State | Evidence |
|---|---|---|
| Tables + columns | **COMPLETE, byte-verified** | `30_tables.sql`, 61,084 B, sha256 `8bf29302…4d36a2`; 146 CREATE TABLE; 1,405 columns; table-name md5 matched production both sides |
| Functions | **PARTIAL — 87 of 381**, every written byte md5-verified | `40_functions.sql`, 108,851 B, sha256 `58056e0b…5ee7eb`; header `SET check_function_bodies = off;`; ends at `extract_hashtags` |
| Views / triggers / indexes / policies / constraints / sequences / grants | **NOT STARTED** — halted when the blocker surfaced | — |

## 2 · THE BLOCKER — measured, not theoretical
The MCP `execute_sql` transport has **no file sink**. DDL can only reach disk by the model
re-typing it into a heredoc — a hand-copy channel. Over 7 pages the extracting agent
detected **3 transcription corruptions**, including a silent numeric change to
`1000000000000.0` inside `compute_entry_rank_score`'s ranking formula. All three were
caught **only** because per-page md5 gating was added; the committed bytes are therefore
correct, but the channel itself is unsound.

Cost of continuing on that channel: 87 functions consumed ~470K tokens. Extrapolated to
the remaining 294 functions plus 730 policies, 437 indexes, 148 triggers, 10 views, 381
constraints and grants: **~3M+ additional tokens and many hours**, to produce an artifact
whose correctness rests on verification catching every error rather than on the transfer
being sound. For the foundation that every later staging test depends on, that is the
wrong trade.

## 3 · EXACT DIFFERENCES FOUND — and three CORRECTIONS TO MY OWN BASELINE
This is the "COUNT MATCH ≠ DEFINITION MATCH" work, and it changed three of my numbers.
**Had B or A been compared against my original baseline, correct output would have FAILED.**

| Baseline metric | I previously stated | **Correct value for a schema baseline** | Why |
|---|---|---|---|
| columns | 1,482 | **1,405** | 1,482 = `information_schema.columns` for public = 1,405 table columns **+ 77 view columns**. Verified: 1405 + 77 = 1482 |
| functions | 381 | **357** | 381 includes **24 extension-owned** functions (`pg_depend deptype='e'`, chiefly `plpgsql_check`). `pg_dump` excludes extension-owned objects and emits `CREATE EXTENSION` instead |
| policies | 730 | **686** | 730 = all schemas; public alone = 686 (+42 storage, +2 cron). Already corrected earlier by the code session |
| tables | 146 | 146 ✓ | unchanged |
| indexes / triggers / RLS | 437 / 148 / 146-of-146 | unchanged, but not yet re-verified against a dump | |

Classification of every difference found so far: **OTHER (baseline definition error)** — none
were MISSING/EXTRA/DIFFERENT-DEFINITION in production itself. Production is self-consistent.

### Fidelity findings that any baseline route must honour
- **2 generated columns**: `posts.is_public` (`GENERATED ALWAYS AS ((privacy='public')) STORED`)
  and `competition_entries.current_round_int` (contains a `\D` regex escape — must survive apply).
- **2 enum types** in public (`app_role`, `post_tag_status`) must exist before tables.
  ⚠ `user_roles.role` is declared `text` but defaults to `'user'::app_role` — the enum is
  required even though the column is not of that type.
- **2 sequence-backed defaults** (`media_repair_audit.id`, `push_delivery_log.id`) — not
  identity columns, so sequences need a separate, earlier step.
- **Cross-schema dependency**: `ad_conversions.user_id DEFAULT auth.uid()`.
- **Cross-schema function references**: `auth.` ×101, `pgmq.` ×6, `net.` ×1, `vault.` ×1.
- Language split: plpgsql 263 / sql 96 / c 22 (all C functions extension-owned).
- No partitioned tables, no inheritance, no identity columns, no domains/citext/vector/geometry.

## 4 · STAGING APPLICATION RESULT
**NOT ATTEMPTED.** B2 did not go GREEN, so B3 was never entered — as specified.

## 5 · PRODUCTION ↔ STAGING DEFINITION RECONCILIATION
**N/A** — nothing applied.

## 6 · ISOLATION VERIFICATION (re-measured at report time)
- staging ref `ztzutckwdhetphwghuzj` ≠ production ref `jtdtehuqtinjxropkkcn` ✅
- staging R2 `50mm-staging` ≠ production `50mm` ✅
- staging: **0 tables, 0 functions, 0 policies, 0 auth users** ✅ (no production rows, users,
  storage objects or secrets — nothing has ever been written there)
- production migration ledger: **32 rows, max `20260820181949`** — unchanged ✅
- no production secrets copied anywhere ✅

## 7 · PRODUCTION HEALTH
Unchanged and healthy. Every production statement in this phase was a catalog `SELECT`.
No writes, no DDL, no credential change.

## 8 · FINAL VERDICT
**B: BLOCKED.** Achievable only via a hand-copy channel whose safety depends on
verification catching every error. Two artifacts survive as genuinely useful by-products:
a complete byte-verified `CREATE TABLE` set, and the corrected baseline in §3.

Explicitly, per the required distinction:
- **COUNT MATCH** — achievable via B. Already demonstrated for tables.
- **DEFINITION MATCH** — achievable per-object, but only with per-chunk md5 gating.
- **FULL BASELINE EQUIVALENCE** — **NOT achievable by B at acceptable cost/risk**, because
  ordering, default privileges, comments, ownership and extension-membership are exactly
  what `pg_dump` encodes natively and catalog reconstruction must re-derive by hand.

## 9 · IS OPTION A STILL NECESSARY?
**Yes — recommended.** `supabase db dump` produces in one shot, byte-exact, everything B
would spend ~3M tokens approximating: correct topological ordering, extension exclusion,
grants/ownership, comments. The §3 corrections mean we can now validate an A dump properly:
expect **146 tables, 1,405 table columns, ~357 user functions, 686 public policies**.
A's only cost remains the production DB-password reset, which the browser session correctly
refused to perform on credential-handling grounds — so A needs the owner personally, or a
different trusted operator.

**Not switching to A. Awaiting explicit instruction, per standing rule.**

## 10 · EXACT NEXT GATE-2 STEP
Owner decision between:
- **(a)** Owner personally performs A2 (reset + secret) using the corrected session-pooler
  host `aws-1-ap-northeast-2.pooler.supabase.com:5432` — then the code session runs the
  authoritative dump and I validate it against the §3 corrected baseline.
- **(b)** Continue B to completion anyway, accepting ~3M tokens, hours of wall-clock, and a
  verification-dependent artifact.
- **(c)** Pause the database baseline and proceed with Gate-2 items that do not depend on it
  (staging Pages project + domain + variables), returning to the schema later.

Nothing else in Gate 2 was touched: no staging Pages project, no edge functions, no seed,
no Phase 1–5, no Judging Panel.
