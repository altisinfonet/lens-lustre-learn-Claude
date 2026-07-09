# W-5 PRECHECK — `competition_entries` Internal Judging Columns Exposed

**Mode:** READ-ONLY. Zero migrations, zero policy edits, zero deploys, zero file changes outside this doc.
**Scanner finding ID:** `competition_entries_internal_judging_columns_exposed` (level=warn, scanner=`supabase_lov`)
**Scanned at:** session `2026-06-22` (live queries cited below).
**Forensic Mandate:** Rules 1–5 honoured. Every claim cites the exact SQL run **this session**.

---

## 1. Scanner verdict (verbatim)

> The RLS policy 'Authenticated can view public-status entries' on the 'competition_entries' table grants SELECT on all columns to every authenticated user. This means fields such as 'progression_decision', 'stage_key', 'current_round', and 'current_round_int' — which are internal judging workflow markers — are returned in API queries alongside the intentionally public 'public_*_derived' columns. Any authenticated participant can poll their own (or others') entries and observe changes to 'progression_decision' (e.g., 'advance', 'reject') and 'stage_key' before results are officially published.

---

## 2. Live policy inventory

`SELECT policyname, cmd, roles, qual FROM pg_policies WHERE schemaname='public' AND tablename='competition_entries'`

| policyname | cmd | roles | qual |
|---|---|---|---|
| Admins can manage entries | ALL | public | `has_role(auth.uid(),'admin')` |
| Users can submit entries | INSERT | public | — |
| **Authenticated can view public-status entries** | **SELECT** | **authenticated** | `status ∈ (submitted, approved, winner, runner_up, honorary, finalist, shortlisted, qualified)` |
| Users can update own metadata only | UPDATE | authenticated | owner + submission_open phase |

SELECT policy is **row-filtered** by status but **NOT column-filtered**. All 29 columns return to any signed-in user when row matches.

## 3. Live grants

`SELECT has_table_privilege(...)` →

| Role | SELECT on `competition_entries` |
|---|---|
| `anon` | ❌ false |
| `authenticated` | ✅ true |
| `service_role` | ✅ true |

`information_schema.column_privileges` for the table → **empty** (no column-level REVOKE/GRANT exists today; all rely on table-level grant).

## 4. Live column inventory (29 cols)

Sensitive (scanner-flagged + adjacent internal-judging cols):

| Column | Type | Public-safe? |
|---|---|---|
| `progression_decision` | text | ❌ internal judging |
| `stage_key` | text | ❌ internal judging |
| `current_round` | text | ❌ internal judging |
| `current_round_int` | int | ❌ internal judging |
| `status` | text | ⚠️ used in row filter; leaks pre-publish state via literals like `qualified`, `shortlisted`, `winner` |
| `placement` | text | ⚠️ pre-publish placement leak |
| `is_ai_generated`, `ai_detection_result`, `is_ai_advisory` | bool/jsonb | ❌ moderation-internal |
| `exif_data` | jsonb | ❌ already noted by scanner as previously masked |
| `certificate_ready` | bool | ❌ internal |
| `view_count`, `is_pinned`, `is_trending` | int/bool | ⚠️ admin-curated |

Public-safe derived cols (intended public surface, already populated by `trg_entry_public_status_recompute`):
- `public_status_derived`, `public_round_derived`, `public_placement_derived`, `public_progression_note_derived`, `public_r4_tags_derived`

User-content cols (legitimately readable): `id, competition_id, user_id, title, description, photos, photo_thumbnails, photo_meta, created_at, updated_at`.

## 5. Existing infra that should consume the public surface

- View `public.entry_public_status` — **EXISTS** (confirmed via `information_schema.views`).
- RPC `get_gated_entry_status(uuid[])` — wraps `entry_public_status` + publish gate (see `src/hooks/judging/useGatedEntryStatus.ts`).
- Memory `mem://judging/status-display-rule` — declares `useGatedEntryStatus` as the **only legal** status reader for user-facing UI.
- ESLint rule `audit-v6/no-raw-entry-status` — blocks raw `entry.status / placement / progression_decision` reads in user-facing UI.

⇒ The infrastructure to close this finding *already exists*; the gap is that the **base table** still hands raw internal columns to `authenticated` over PostgREST.

## 6. Caller inventory (raw column references — live counts this session)

```
rg progression_decision|stage_key|current_round_int|.current_round  src **/*.ts(x)  (excl tests)   → 188 hits / 33 files
rg progression_decision|stage_key|current_round_int  supabase/functions/**/*.ts                    → 87 hits
```

Edge-function hits (87) all run under `service_role` → unaffected by any change to `authenticated` grants/policies.
Client hits (188 across 33 files) need migration to `useGatedEntryStatus` (per memory) **before** any column REVOKE — otherwise judge / admin / owner panels break.

## 7. Classification

**OPEN — REAL WARN.**
- Scanner finding is factually accurate against live policy + grant text.
- Pre-publish leak is reachable from any authenticated user against any entry whose `status` falls in the publish-bucket literal list — including rows still mid-judging where `progression_decision` mutates live.
- Severity is `warn` (not `error`) because the public `public_*_derived` columns + the `complete-round`/`publish-round` triggers gate the *display* surface; the leak is in **direct PostgREST reads** bypassing the gated hook.

## 8. Remediation options (DRAFT — NOT EXECUTED)

### Option A — SECURITY-BARRIER VIEW exposing only safe columns *(lightest)*

1. `CREATE VIEW public.competition_entries_public WITH (security_barrier=true) AS SELECT id, competition_id, user_id, title, description, photos, photo_thumbnails, photo_meta, created_at, updated_at, public_status_derived, public_round_derived, public_placement_derived, public_progression_note_derived, public_r4_tags_derived FROM public.competition_entries WHERE status = ANY (ARRAY[...publish-bucket...]);`
2. `GRANT SELECT ON public.competition_entries_public TO authenticated, anon;`
3. **Keep** the existing SELECT policy on the base table (owners need it for their own dashboard; admins/judges have separate policies).
4. Add owner-only SELECT policy on the base table: `USING (user_id = auth.uid())` so owners still see their own internal columns.
5. **Drop** the broad `Authenticated can view public-status entries` policy → public discovery routes through the view.
6. Migrate client readers (33 files) to `useGatedEntryStatus` / the new view. (Already partially done — ESLint rule already blocks raw status reads.)

**Blast radius:** medium. Requires every public-feed component to switch SELECT target. Owner-self reads keep working because of the new owner policy. Judge/admin reads keep working via existing `Admins can manage entries` + `judge_*` policies.

### Option B — Column-level REVOKE + split SELECT policies

`REVOKE SELECT (progression_decision, stage_key, current_round, current_round_int, ai_detection_result, is_ai_generated, is_ai_advisory, certificate_ready, exif_data, view_count, is_pinned, is_trending) ON public.competition_entries FROM authenticated;` + add owner-scoped SELECT policy that grants column access via a separate role.

PostgreSQL **column-level grants are per-role, not per-row** → owners would lose access to their own `progression_decision` (legit need for their dashboard). Requires a new Postgres role per audience or a SECURITY-DEFINER RPC. **Not recommended.**

### Option C — Full migration to `entry_public_status` view + drop base-table public SELECT

Most aligned with `mem://judging/status-display-rule`. Largest scope (188 client hits across 33 files). Recommended as the *end-state* but must run behind a feature flag with shadow audit because raw SELECTs from feed/discovery/admin/judge surfaces all need redirection.

## 9. Risk analysis

| Dimension | Rating | Notes |
|---|---|---|
| Latent security risk if unfixed | **MEDIUM (warn)** | Pre-publish leak of judging outcome literals; no PII, no financial data |
| Blast radius of Option A | **Medium** | New view + owner-self policy + drop broad policy + 33-file client migration |
| Blast radius of Option B | **High** | Per-role grants break owner self-reads; requires new role plumbing |
| Blast radius of Option C | **High** | 188 raw reads × 33 files; needs feature-flagged shadow audit |
| Judge/Admin regression risk (all options) | **None** | Both bypass via `Admins can manage entries` + judge policies / service_role |
| Edge-fn regression risk | **None** | All 87 edge-fn refs run under `service_role` |
| Rollback complexity (Option A) | **Trivial** | DROP VIEW + DROP new owner policy + recreate old broad policy |

## 10. Recommended next step

Author a **GO W-5 EXECUTE Option A** migration in a follow-up turn:
- 1 new view `competition_entries_public` (security_barrier=true)
- 1 GRANT SELECT to authenticated + anon
- 1 new RLS policy `Owners view own entries` on base table
- 1 DROP POLICY `Authenticated can view public-status entries`
- ZERO code changes in this migration; client migration tracked separately under ESLint rule `audit-v6/no-raw-entry-status` (already enforced in CI).

## 11. Final status

**ALL CLEAR FOR PRECHECK ONLY** — awaiting explicit `GO W-5 EXECUTE` token with chosen option (A / B / C / defer).

Nothing executed, written, deployed, or edited beyond this precheck doc.
