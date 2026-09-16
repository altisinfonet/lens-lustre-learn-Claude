# §R.1 — WS4 / WO-1 Infrastructure Audit Results

**NOTE ON PROVENANCE OF THIS FILE:** The literal `06_RESULTS_TEMPLATE.md` file referenced by the WS4 harness documentation (WS4_HARNESS_REVISION7/8) is **not present anywhere in this session's reachable storage** — confirmed by `project_search`/`project_info` across all 378 project docs and by the absence of any local repo or device connection. Only its SHA256 hash survives in the harness description docs, not its content or its exact column layout. This file is a **reconstruction** of the required content (Requirement → Instrument → Evidence → Result → Status per row, per WO-1's evidence-discipline rule) built from WO-1's own text and the §25.3 row descriptions in `PROMOTION_LEDGER.md`, not a byte-for-byte refill of the original template. This provenance gap itself is recorded in `BLOCKED.md`.

**FRAMING (mandatory, WO-1 explicit instruction): nothing in this file closes any §25 audit row. §25.4 means measurement by an owner/compiler session (this session) is OWNER-ATTESTED evidence for the independent human auditor to validate — never a closure. Every STATUS below reflects that: no row status is ever "CLOSED."**

Legend: VERIFIED / OWNER-ATTESTED / INFERRED / BLOCKED / N/A / DEFERRED (per WO-1; never silently converted).

---

## Row 1 — Production database RLS policy state (`ad_creative_comments`)

| Field | Value |
|---|---|
| Requirement | §25.3 row 1: confirm production RLS policy count/state on `ad_creative_comments`, distinguishing pre-M2 from post-M2 |
| Identity control | `SELECT current_database()` alongside the count, run against project ref **jtdtehuqtinjxropkkcn** (production) explicitly — not inferred from `current_database()` alone, which returns `"postgres"` on both lanes and cannot discriminate them (named trap in WO-1) |
| Completeness control | `string_agg(policyname, ', ' ORDER BY policyname)` — names, not just a count, so a matching count with different policy identities cannot masquerade as a match |
| Negative control | Same query pattern against a nonexistent table (`this_table_does_not_exist_control_check`) on the same project ref returned `0` rows — confirms the query mechanism discriminates real from fabricated results rather than returning a cached/blanket answer |
| Instrument | `mcp__Supabase__execute_sql`, project_id=`jtdtehuqtinjxropkkcn` |
| Evidence | `SELECT current_database() AS db, count(*) AS policy_count, string_agg(policyname,...) FROM pg_policies WHERE tablename='ad_creative_comments';` → `db=postgres, policy_count=7`, names: Deleted accounts cannot delete, Deleted accounts cannot insert, Deleted accounts cannot update, Members comment as themselves, Members edit their own ad comment, Members or admins delete an ad comment, Members read ad comments |
| Timestamp | 2026-08-29 ~18:40Z UTC |
| Result | **7 policies on production.** This is the EXPECTED PRE-M2 state per AF-17 (M2 = `20260828082136_ad_comment_ban_and_visibility_policies.sql`, applied to staging only, not yet to production per PROMOTION_LEDGER.md REV-16, §6). Confirmed directly: querying `supabase_migrations.schema_migrations` for version `20260828082136` on this project ref returns **zero rows** — migration M2 is absent from production, consistent with the 7-policy pre-state. **7 is NOT a defect; it is the correct pre-merge state.** |
| Status | **VERIFIED** (measured this session) — OWNER-ATTESTED for audit-closure purposes per §25.4 |

## Row 2 — Staging database RLS policy state (`ad_creative_comments`)

| Field | Value |
|---|---|
| Requirement | §25.3 row 2: confirm staging RLS policy count/state on `ad_creative_comments` |
| Identity control | Same query, explicit project ref **ztzutckwdhetphwghuzj** (staging) |
| Completeness control | Same `string_agg` of policy names |
| Negative control | Same nonexistent-table probe pattern as Row 1 (not independently re-run per lane — same discriminating mechanism, same session) |
| Instrument | `mcp__Supabase__execute_sql`, project_id=`ztzutckwdhetphwghuzj` |
| Evidence | `count(*)=9`; names: Ad comments follow the ad's visibility, Banned users cannot comment on ads, Deleted accounts cannot delete, Deleted accounts cannot insert, Deleted accounts cannot update, Members comment as themselves, Members edit their own ad comment, Members or admins delete an ad comment, Members read ad comments. Migration `20260828082136` **present** in `supabase_migrations.schema_migrations` on this ref. |
| Timestamp | 2026-08-29 ~18:40Z UTC |
| Result | **9 policies on staging**, matching the expected post-M2 state (7 base + 2 from M2: "Ad comments follow the ad's visibility", "Banned users cannot comment on ads"). Consistent with PROMOTION_LEDGER.md §6's record that M2 is staging-only. |
| Status | **VERIFIED** — OWNER-ATTESTED for audit-closure purposes |

## Row 3 — Deployed edge-function state, both lanes

| Field | Value |
|---|---|
| Requirement | §25.3 row 3 / T1: full inventory + hash + classification of all deployed edge functions, both lanes |
| Identity control | Explicit project refs for both calls: `jtdtehuqtinjxropkkcn` (production) and `ztzutckwdhetphwghuzj` (staging) |
| Completeness control | Duplicate-slug check (`len(set(slugs)) == len(list)`) and all-`ACTIVE`-status check run programmatically against both raw captures; two independent production captures ~15 min apart cross-checked for drift (0 differences in id/version/hash/status/slug across all 71) |
| Negative control | N/A for a list-type instrument (no single-row negative-control probe applies the same way as an RLS count) — the two-capture stability check serves as the closest available discriminating check: if the instrument were returning cached/incorrect data, a real intervening deploy would go undetected, but no intervening deploy occurred to test against |
| Instrument | `mcp__Supabase__list_edge_functions` + `mcp__Supabase__get_edge_function` |
| Evidence | Production N=71 (`production/list_edge_functions_raw.json`, `..._capture2_20260829T183428Z.json`); staging N=74 (`staging/list_edge_functions_raw.json`). Full source + independent hash for 7 of 71 production functions (see T1_HASH_CROSS_VALIDATION.md, T1.8_IMAGEDIMS_COMPARISON.md, and `production/functions/`). `submit-judge-decision` confirmed v23, wildcard CORS, by direct source read. |
| Timestamp | 2026-08-29 18:19Z–18:40Z UTC |
| Result | N=71 production (matches the 2026-08-26 figure exactly), N=74 staging. `send-gift-credit` CONFIRMED (by direct source) to use the indexed RPC `admin_lookup_user_id_by_email`, matching the "production ahead of repo" finding for this function. `detect-ai-image` and `analyze-gallery-image` CONFIRMED to carry the described AI-key fallback chains. Full 71-function MATCH/HEADER-ONLY/DRIFT/UNKNOWN classification against repo: **BLOCKED** (see BLOCKED.md — WS4 harness pack absent, no GitHub access for repo-side comparison). |
| Status | **VERIFIED** (inventory, hashes-as-captured, 7-function source confirmation) / **BLOCKED** (full classification) |

## Row 4 — Cloudflare R2 API token policy/bucket scope

| Field | Value |
|---|---|
| Requirement | §25.3 row 4: confirm the scope of the R2 API token(s) in use — which buckets, which permissions |
| Instrument attempted | Searched available Cloudflare Developer Platform MCP tools: `d1_database_*`, `hyperdrive_config_*`, `kv_namespace_*`, `r2_bucket_create/delete/get`, `r2_buckets_list`, `search_cloudflare_documentation`, `workers_get_worker`, `workers_get_worker_code`, `workers_list`, `migrate_pages_to_workers_guide` |
| Result | **No API-token listing/introspection tool exists in this tool set.** `r2_bucket_get`/`r2_buckets_list` return bucket metadata (name, creation date, location, storage class) but nothing about which token/credential has access or with what scope. |
| Status | **BLOCKED** — tool absent, not merely untried. Closure requires either a Cloudflare dashboard/API-token-listing capability not available via MCP here, or the owner supplying token-scope documentation directly. |

## Row 5 — GitHub `staging` Environment existence/secrets

| Field | Value |
|---|---|
| Requirement | §25.3 row 5: confirm existence and secret configuration of the GitHub `staging` Environment on `altisinfonet/lens-lustre-learn-Claude` |
| Instrument attempted | `curl` against the GitHub API with `$GITHUB_TOKEN` |
| Evidence | Structured refusal: `{"message":"GitHub access to this repository is not enabled for this session. Use add_repo to request access..."}`. No `add_repo`-equivalent tool found via `ToolSearch`. |
| Result | Cannot query GitHub in any form this session. |
| Status | **BLOCKED** — access disabled at the session level, confirmed by direct attempt, not assumed |

## Row 6a — Cloudflare R2 bucket existence/creation-date/location

| Field | Value |
|---|---|
| Requirement | §25.3 row 6 (bucket-level state) |
| Identity control | Explicit bucket names queried by exact string (`50mm`, `50mm-staging`) |
| Negative control | Queried `this-bucket-does-not-exist-control-check` — got a structured `404`/`10006 The specified bucket does not exist` error, confirming the tool discriminates real from fabricated bucket names rather than returning a false positive |
| Instrument | `mcp__Cloudflare_Developer_Platform__r2_buckets_list`, `r2_bucket_get` |
| Evidence | Account holds 3 buckets total: `50mm` (created 2026-03-07T12:19:15.228Z, location APAC), `50mm-staging` (created 2026-08-21T19:22:35.655Z, location ENAM), `agentcrm` (created 2025-12-11T13:17:22.390Z, unrelated to this platform) |
| Timestamp | 2026-08-29 ~18:41Z UTC |
| Result | Both `50mm` (production-lane) and `50mm-staging` (staging-lane) buckets exist, confirmed live, with distinct creation dates and distinct geographic locations (APAC vs ENAM) — this alone is a useful lane-isolation signal (two physically distinct bucket objects, not one bucket shared across lanes). |
| Status | **VERIFIED** |

## Row 6b — Cloudflare R2 `isolation-probe/` prefix search

| Field | Value |
|---|---|
| Requirement | §25.3 row 6 (object-level isolation probe): confirm no `isolation-probe/`-prefixed objects leak across lanes |
| Instrument attempted | Same Cloudflare tool set as Row 4 |
| Result | **No object-level listing (ListObjectsV2-equivalent) or prefix-search tool exists in this tool set.** `r2_bucket_get`/`r2_buckets_list` operate at the bucket level only; there is no tool to enumerate or search keys inside a bucket. |
| Status | **BLOCKED** — tool absent |

## Row 6c — Cloudflare Zero Trust posture

| Field | Value |
|---|---|
| Requirement | §25.3 row 6 (Zero Trust / access-policy posture around the buckets or workers) |
| Instrument attempted | Same Cloudflare tool set as Row 4 |
| Result | **No Zero Trust / Access policy tool exists in this tool set.** |
| Status | **BLOCKED** — tool absent |

---

## Coverage check
8 rows enumerated: 1, 2, 3 (partial), 4 (blocked), 5 (blocked), 6a, 6b (blocked), 6c (blocked).
VERIFIED/OWNER-ATTESTED: 1, 2, 3 (partial), 6a — 4 of 8.
BLOCKED: 3 (full classification component), 4, 5, 6b, 6c — 5 of 8 have at least one blocked component; 4 rows (4, 5, 6b, 6c) are wholly blocked.
No row is left blank. Every blocked row states the reason and what tool/access would close it, per WO-1's "a blank cell is BLOCKED, never a pass."
