# P32 — the anon-executable VOLATILE inventory. MEASUREMENT AND PROPOSED DISPOSITION ONLY.

**Unit:** P32 · Phase 1 · D1 · branch `d1/P32-inventory-20260910` off `staging`

> ⚠ **THIS PR REVOKES NOTHING AND CHANGES NO GRANT.** It is the inventory the Auditor freezes before
> any P32 SQL is written — the same sequencing that made P30 work. No SQL, no migration, no rollback.

**The gate, verbatim:**

> **P32** — every anon-executable VOLATILE function either requires a session, or sits behind a
> rate-limited edge function, or has a written justification with a test.

**Three dispositions, and one of them is not a revoke.** A guarded function gets the *justification*
disposition, proven by a test — the same shape as the `PUBLIC-BY-DESIGN` category. P32 is not a
revoke sweep.

---

## 1 · The scope, measured today on BOTH lanes — and the register's "eight" is not the number

`provolatile='v'` AND `has_function_privilege('anon', oid, 'EXECUTE')`, schema `public`,
2026-09-04, `SELECT` only.

| | production `jtdtehuqtinjxropkkcn` | staging `ztzutckwdhetphwghuzj` |
|---|---|---|
| all VOLATILE + anon-executable | **188** | **188** |
| …of which return `trigger` — **not reachable through PostgREST** | 131 | 131 |
| **callable through the API** | **57** | **57** |
| …of which `SECURITY DEFINER` | 33 | 33 |
| …reachable via an explicit PUBLIC ACL entry | **9** | **33** |
| …reachable because `proacl IS NULL` (built-in default = EXECUTE TO PUBLIC) | **24** | **0** |

### 1.1 ⚠ THE LANE DIVERGENCE IS REAL, AND IT IS HARMLESS — BUT ONLY BECAUSE THE GATE IS PER-FUNCTION

`9 + 24 = 33` on production; `33 + 0 = 33` on staging. **The same 33 functions are PUBLIC-reachable on
both lanes.** The lanes differ only in *how* that is expressed: production carries `proacl IS NULL`
for 24 of them, staging carries an explicit `=X/postgres` entry.

Those 24 are **exactly** the `plpgsql_check` extension functions — counted, not assumed. This is the
same divergence D1 measured before as 222/24 vs 246/0, and it has the same cause: production has no
`pg_default_acl` entry for `supabase_admin` in `public` and staging does.

**Consequence, and it is the whole reason §1 of the frozen list makes the gate per-function:** a
class-based gate proven on staging would not describe production. A per-oid
`has_function_privilege` reading describes both. Nothing here changes that ruling; it re-confirms it
on a second, independent set of objects.

### 1.2 ⚠ TWO DIFFERENT 33s. DO NOT CONFLATE THEM.

- **33 = `SECURITY DEFINER` and callable.** This is every callable function that is *not* a
  `plpgsql_check` extension function.
- **33 = PUBLIC-reachable.** This is the 24 `plpgsql_check` functions **plus** 9 application
  functions.

They have the same cardinality and are **different sets**. C-58's figure of 33 is almost certainly
the first; this file states both so the next reader cannot pick up the wrong one.

### 1.3 Reconciling 8 vs 33 vs 57 — publish the disagreement, do not resolve it silently

| figure | what it appears to count | status |
|---|---|---|
| **8** (register note) | unknown; no instrument recorded with it | **stale — sized for a sweep that leaves 49 behind** |
| **33** (C-58) | callable + `SECURITY DEFINER` | consistent with today's reading |
| **57** (this file) | callable through PostgREST, definer or not | **the scope P32 must actually cover** |
| 188 | includes 131 trigger functions | not the scope — a trigger cannot be invoked through the API |

**The honest scope for P32 is 57**, and the 131 trigger functions are excluded *with a reason*, not
quietly dropped.

---

## 2 · The inventory, grouped by proposed disposition

### Group A — UNGUARDED, WRITES, `SECURITY DEFINER`. The amplification class. **4 functions.**

| function | oid (prod) | args | PUBLIC | notes |
|---|---|---|---|---|
| `_gen_competition_order_no` | 22331 | *(none)* | 0 | writes, no guard, **no arguments** — free to call, repeatedly |
| `increment_managed_page_view` | 25056 | `_page_id text` | 0 | writes, no guard. **§2.2 BLOCKED** on D2's rejection handler |
| `recompute_entry_public_status` | 22848 | `p_entry_id uuid` | 0 | writes, no guard |
| `record_test_agent_run` | 22725 | `p_token text, …` | 0 | writes, no guard, raises. **Also carries the secret-as-SQL-argument finding** — a token passed as an argument lands in query logs and `pg_stat_statements` |

**Proposed disposition: REVOKE** (session or rate-limited edge function), except
`increment_managed_page_view`, which stays **BLOCKED** until D2's handler merges — a revoke today
turns it into an unhandled rejection on a public page.

### Group B — UNGUARDED, no writes, `SECURITY DEFINER`. **4 functions.**

| function | oid (prod) | PUBLIC | notes |
|---|---|---|---|
| `recompute_entry_from_tag_assignments` | 22422 | **1** | ⚠ **F-62 BITES.** Reachable through PUBLIC. `REVOKE … FROM anon` alone would close nothing. D1 previously measured its body as `BEGIN RETURN; END;` — **a no-op stub** |
| `set_write_path` | 22857 | 0 | raises; no write detected |
| `get_broadcast_feed` | 38204, 38205 | 0 | thin overloads that **delegate** to oid 38202, which *is* guarded — the callee carries the identity check |

**Proposed disposition:** `recompute_entry_from_tag_assignments` → **REVOKE, two-step form mandatory**.
`get_broadcast_feed` (38204/38205) → **JUSTIFY WITH A TEST** — a logged-out visitor sees the public
feed and the visibility filter lives in the 4-argument form. `set_write_path` → **read the body before
disposing**; not yet classified.

⚠ **Written disposition still owed** (frozen list §4.3): two `SECURITY DEFINER` functions call that
no-op, one of them a `trg_`-named function attached to no table. Either the recompute was
deliberately disabled and its callers left standing, or it was gutted and something is quietly not
being recomputed. **A feature that has never worked is a decision, not a bug** — it needs a sentence
saying which, and this unit is where that sentence belongs.

### Group C — `plpgsql_check` extension functions. **24 functions.**

All `secdef=false`, no writes, anon-reachable **only** because `proacl IS NULL` on production.
`__plpgsql_show_dependency_tb`, `plpgsql_check_function*`, `plpgsql_coverage_*`,
`plpgsql_profiler_*`, `plpgsql_show_dependency_tb`.

**Proposed disposition: NOT P32's to fix.** These are **P33 clause 4** — *"`plpgsql_check` moved out
of `public`"*. Moving the extension closes all 24 at once and is the correct remedy; revoking them
one by one in P32 would be 24 migrations doing badly what one schema move does properly.
**Recorded here so they are not counted as open P32 items, and not silently dropped either.**

### Group D — GUARDED IN THE BODY. **25 functions.**

`admin_flag_entry_for_review`, `admin_rewind_stage`, `admin_set_photo_rejected`,
`admin_search_users`, `apply_decision_to_remaining`, `backfill_judging_notifications`,
`backfill_tag_decision_drift_admin`, `change_custom_url`, `claim_username`, `clear_custom_url`,
`fix_certificate_readiness_admin`, `fix_gift_drift_admin`, `fix_referral_drift_admin`,
`get_broadcast_feed` (38202), `get_certificate_drift_admin`, `get_derived_status_drift_admin`,
`get_judge_collusion_admin`, `get_judging_tag_assignment_counts`, `judging_write_decision_atomic`,
`log_app_event`, `log_client_error`, `register_push_token`, `request_withdrawal`,
`submit_competition_entry`, `unregister_push_token`.

**Proposed disposition: JUSTIFY WITH A TEST — NOT revoke.** The register is explicit: *"It is not an
open door, and the phase is not to be re-planned as though it were."* The grant posture is untidy;
the door is shut in the body.

⚠ **But the justification must be PROVEN, not asserted.** The proposed test is a per-function
assertion that an anonymous caller is refused — the same shape as the P30/P31 probes, and the same
standard the `PUBLIC-BY-DESIGN` marker is held to. **A guarded function with no test is an assertion,
and this unit does not accept assertions.**

⚠ **Eight of these carry a PUBLIC grant** (`apply_decision_to_remaining`, `change_custom_url`,
`claim_username`, `clear_custom_url`, `log_app_event`, `log_client_error`, `register_push_token`,
`unregister_push_token`). Their bodies guard them, so this is a posture finding rather than an open
door — but if any is ever revoked, **the two-step form is mandatory** or the revoke will silently do
nothing.

---

## 3 · Proposed disposition summary

| disposition | count | |
|---|---|---|
| **REVOKE** | **4** | Group A (3, `increment_managed_page_view` deferred) + Group B (1) |
| **JUSTIFY WITH A TEST** | **27** | Group D (25) + `get_broadcast_feed` ×2 |
| **DEFER — belongs to another unit** | **25** | Group C (24, → P33 clause 4) + `increment_managed_page_view` (blocked on D2) |
| **UNCLASSIFIED — body not yet read** | **1** | `set_write_path` |
| | **57** | |

---

## 4 · What this inventory does NOT establish

- **`set_write_path` is not classified.** Its body has not been read. Stated rather than guessed.
- **`writes` and `guarded` are pattern matches over `prosrc`**, not semantic analysis. A function
  that writes through a helper, or guards by a means these patterns miss, would be mis-grouped. Every
  function in Groups A and B must have its body **read** before any SQL is written.
- **No call-site inventory.** D2 is running that sweep in parallel; the revoke list cannot be frozen
  until the two intersect — the P30/P31 sequencing, unchanged.
- **Nothing was called.** Bodies, ACLs and volatility were read from the catalogue.
