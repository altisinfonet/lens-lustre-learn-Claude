# STAGING RUN — ADMIN USER LIST PAGINATION

**Project:** `50mmretinaworld-staging` (`ztzutckwdhetphwghuzj`) · **Date:** 2026-08-24
**Migration:** `admin_user_list_pagination` · local file sha256 `f48f2c45…0738`
**Format:** Claim → Instrument → Result → Verdict → Regressions → Could-not-verify → Invariant lock → Abort condition (G8)

---

## 0. PRE-FLIGHT BASELINE (read-only, before any change)

| Check | Value |
|---|---|
| profiles / auth.users / user_roles | 513 / 513 / 513 |
| user_badges | 0 rows |
| `admin_search_users` (v1) present | yes |
| `admin_search_users_v2` present | **no** |
| `idx_profiles_created_at_id_desc` present | **no** |

Staging already carries 513 profiles — 5× the 100 ceiling, so **no profiles were
seeded** and the paging, role, authorization and clamping tests ran entirely read-only.

⚠ **One exception, added later the same day:** `user_badges` was empty, which left the
badge filter untestable. 12 badge rows were therefore seeded in staging, tested, and
deleted — with the trigger's 12 notification side effects also removed. Fully recorded
in §3b, including the verified return to this baseline. No other table was written to.

## 1. THE DEFECT, REPRODUCED ON STAGING BEFORE THE FIX

Called as the staging admin (`25d4916c-…`, `50mm Retina World`) with
`set local role authenticated` + a `sub` JWT claim, i.e. exactly as the browser calls it:

```
select count(*) from public.admin_search_users('', 'name');
  rows_returned              100      (of 513 profiles)
  admin_own_account_present    0      ← the caller cannot see themselves
```

Role-holder visibility under v1's `LIMIT 100`:

| role | holders | visible | **INVISIBLE** | rank range |
|---|---|---|---|---|
| user | 507 | 100 | **407** | 1–512 |
| judge | 4 | 0 | **4** | 495–499 |
| content_editor | 1 | 0 | **1** | 500 |
| admin | 1 | 0 | **1** | 513 |

Three of the four role filters return **nothing at all** on staging. This is the same
defect seen in production, larger because the dataset is larger.

## 2. APPLY

`apply_migration(project=ztzutckwdhetphwghuzj, name=admin_user_list_pagination)` → `{"success": true}`

### Post-apply structural verification

| Check | Expected | Actual | |
|---|---|---|---|
| v2 exists | 1 | 1 | ✅ |
| v1 still present | 1 | 1 | ✅ |
| index created | 1 | 1 | ✅ |
| `prosecdef` (SECURITY DEFINER) | true | true | ✅ |
| `proconfig` | `search_path=public` | `search_path=public` | ✅ |
| grants | postgres, authenticated, service_role — **no anon, no PUBLIC** | exactly that | ✅ |
| profiles row count | 513 unchanged | 513 | ✅ |

## 3. BEHAVIOURAL MATRIX — 33 tests, all PASS

### Paging

| # | Test | Expected | Actual | |
|---|---|---|---|---|
| T1 | page 1 (offset 0) | 100 rows, total 513 | 100 / 513 | ✅ |
| T2 | page 2 (offset 100) | 100 rows, total 513 | 100 / 513 | ✅ |
| T3 | page 5 (offset 400) | 100 rows, total 513 | 100 / 513 | ✅ |
| T4 | last page 6 (offset 500) | 13 rows (513 = 5×100+13) | 13 / 513 | ✅ |
| T4b | **admin's own account on page 6** | present | **present** | ✅ |
| T5 | past the end (offset 600) | 0 rows | 0 | ✅ |

### Completeness and disjointness — the ordering-tiebreak proof

All six pages walked and unioned:

```
rows_across_all_pages     513
distinct_ids              513
duplicates_across_pages     0     ← no member appears on two pages
profiles_in_table         513
members_never_shown         0     ← no member is unreachable
```

This is what `ORDER BY created_at DESC, id DESC` buys. Without the `id` tiebreak these
two zeros are not guaranteed.

### Role filters — the ones that returned nothing before

| # | Filter | Rows | total_count | |
|---|---|---|---|---|
| T7 | `role=admin` | 1 — **50mm Retina World** | 1 | ✅ |
| T8 | `role=judge` | 4 | 4 | ✅ |
| T9 | `role=content_editor` | 1 | 1 | ✅ |
| T10 | `role=user` page 1 | 100 | 507 | ✅ |
| T11 | `role=user` last page (offset 500) | 7 (507 = 5×100+7) | 507 | ✅ |
| T12 | `role=no_such_role` | 0 | — | ✅ |

`user_badges` was empty in staging at first pass, so the badge filter was initially
exercised only in its no-match path. **That gap has since been closed by seeding.** See
§3b below.

### Badge filters — seeded, tested, and cleaned up

`user_badges` held 0 rows, so on 2026-08-24 12 badge rows were seeded **in staging only**,
with ranks chosen deliberately to reproduce the defect class rather than to pass:

| badge | holders | inside the newest 100 | outside it |
|---|---|---|---|
| `verified` | 8 | 3 | **5** |
| `top_rated` | 4 | 0 | **4** |

**First, the old behaviour was reproduced with real badge data.** Intersecting the badge
holders against v1's 100 rows — exactly what the old client-side code did:

| badge | real holders | v1 would have shown | **silently dropped by v1** |
|---|---|---|---|
| `verified` | 8 | 3 | **5** |
| `top_rated` | 4 | **0** | **4** |

`top_rated` is the admin-filter failure repeated: a badge with four holders rendering as
"no users found".

**Then v2:**

| # | Test | Expected | Actual | |
|---|---|---|---|---|
| B1 | `badge=verified` | 8, total 8 | 8 / 8 | ✅ |
| B2 | `badge=top_rated` (v1 showed 0) | 4, total 4 | 4 / 4 | ✅ |
| B3 | `badge=most_popular` (defined, unheld) | 0 | 0 | ✅ |
| B4 | `badge=no_such_badge` | 0 | 0 | ✅ |
| B5 | `verified`, 5/page, page 1 | 5, total 8 | 5 / 8 | ✅ |
| B6 | `verified`, 5/page, page 2 | 3, total 8 | 3 / 8 | ✅ |
| B7 | `role=admin` **and** `badge=verified` | 1 | 1 | ✅ |
| B8 | `role=user` **and** `badge=verified` | 7 | 7 | ✅ |
| B9 | `role=admin` **and** `badge=top_rated` (no overlap) | 0 | 0 | ✅ |

B7–B9 matter beyond the badge case: they are the first proof that the two filters
**compose** rather than one silently winning.

**Identity check, not just counts** — pages 1 and 2 of the `verified` filter unioned and
compared against the truth set:

```
rows_across_pages        8
distinct_ids             8
duplicates               0
real_holders             8
holders_MISSED           0     ← no holder omitted
NON_holders_returned     0     ← nobody returned who lacks the badge
```

**Cleanup, verified.** The 12 seeded rows carried a sentinel `assigned_at` of
`2000-01-01T00:00:00Z`, so the delete could target them exactly. The
`trg_notify_badge_awarded` trigger had also produced 12 `badge_awarded` notifications —
an unplanned side effect, found by checking rather than assumed absent — and those were
removed by their single exact firing timestamp.

Final staging state: `user_badges` **0**, `profiles` **513**, `user_roles` **513**,
`badge_awarded` notifications **0**, `admin_search_users_v2` still present. Identical to
the pre-test baseline in §0.

### Authorization

| # | Caller | Expected | Actual | |
|---|---|---|---|---|
| T13 | signed-in **non-admin** | refused | `Not authorized` | ✅ |
| T14 | `anon` claims, no `sub` | refused | `Not authorized` | ✅ |
| T15 | no JWT at all | refused | `Not authorized` | ✅ |

### Input clamping and search

| # | Test | Expected | Actual | |
|---|---|---|---|---|
| T16 | `_limit = 10000` | clamps to 200 | 200 | ✅ |
| T17 | `_limit = -5` | clamps to 1 | 1 | ✅ |
| T18 | `_offset = -50` | clamps to 0 | 100 rows (page 1) | ✅ |
| T19 | name search `50mm` | finds it | `50mm Retina World` | ✅ |
| T20 | email search `@` | works | 100 | ✅ |
| T21 | all-null arguments | behaves as page 1 | 100 | ✅ |

### No regression to v1

| # | Test | Actual | |
|---|---|---|---|
| T22 | v1 still returns its 100 | 100 | ✅ |
| T23 | v1 still hides the admin (expected — UI not switched) | true | ✅ |

### Index actually used

```
EXPLAIN (ANALYZE, BUFFERS) … ORDER BY created_at DESC, id DESC LIMIT 100 OFFSET 500

Limit (actual time=1.556..1.577 rows=13 loops=1)
  ->  Index Only Scan using idx_profiles_created_at_id_desc on profiles p
Execution Time: 1.673 ms
```

Index Only Scan, **no Sort node**. Before the index this was a full scan plus a sort.

## 4. SECURITY ADVISORS

v2 raises **one** WARN: `0029_authenticated_security_definer_function_executable` —
"signed-in users can execute this SECURITY DEFINER function". **Expected and intended.**
That is the design: `authenticated` may call it, and the `has_role(auth.uid(),'admin')`
guard inside decides. T13–T15 prove the guard holds.

### ⚠ NEW FINDING — v1 is reachable by `anon`

The advisor flags v1 under a *different, worse* lint:
`0028_anon_security_definer_function_executable`. Confirmed by direct inspection —
**and it is true in production, not just staging**:

```
production  admin_search_users     postgres=X | anon=X | authenticated=X | service_role=X
staging     admin_search_users_v2  postgres=X |          authenticated=X | service_role=X
```

`admin_search_users` can be invoked at `/rest/v1/rpc/admin_search_users` by an
unauthenticated caller holding only the publishable key. It still raises
`Not authorized` (`has_role(null,'admin')` is false), so **no data leaks** — but it is
an unauthenticated-reachable admin endpoint, the same class as the `recount_hashtags`
grant closed in migration `20260817102540`.

**Deliberately NOT fixed in this migration.** It is a pre-existing, separate defect and
bundling it would widen a scope that is currently one thing. Recorded here as its own
item, requiring its own decision.

## 5. REGRESSIONS

None observed. v1 unchanged (T22/T23); row counts unchanged; no table written to.

## 6. COULD NOT VERIFY

1. ~~Badge filter with real matches.~~ **CLOSED 2026-08-24 — see §3b.**
2. **The UI itself.** Only the RPC was exercised. The React pager, page-number window,
   and realtime page-hold are covered by 16 source pins and are **not** execution-proven.
   That needs a browser session against a staging deploy.
3. **Deep-offset cost at millions of rows.** Not measurable on 513 rows. The `OFFSET`
   trade-off was accepted knowingly (owner, 2026-08-24).

## 7. INVARIANT LOCK

- v1 signature, body and grants unchanged — any diff means this migration overstepped.
- v2 must remain `SECURITY DEFINER` with `search_path=public` and the `has_role` guard.
- v2 must never carry an `anon` or `PUBLIC` grant.
- `ORDER BY created_at DESC, id DESC` — removing the `id` tiebreak breaks §3's two zeros.
- `count(*) over ()` must remain over the filtered set, never the page.

## 8. ABORT CONDITION FOR PRODUCTION

Stop and report if, on production: v1's definition or grants differ before/after; the
`profiles` row count changes across the apply; T13–T15 do not all return `Not authorized`;
or the page-union check yields any duplicate or any unreachable member.

---

## VERDICT

**PASS on staging.** The defect was reproduced first, then fixed, then re-verified —
33 behavioural tests, 7 structural checks, 3 authorization refusals, all green. Every
test was read-only except the badge seed of §3b, which was reverted and the revert
verified against the §0 baseline.

**Production is NOT yet applied.** Recommended order: apply the migration → re-run §3
read-only against production → then ship the UI PR (v1 keeps serving until it lands).
