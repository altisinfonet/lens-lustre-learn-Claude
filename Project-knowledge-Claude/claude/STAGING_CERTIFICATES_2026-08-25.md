# STAGING RUN — ADMIN CERTIFICATES (7 DEFECTS)

**Project:** `50mmretinaworld-staging` (`ztzutckwdhetphwghuzj`) · **Date:** 2026-08-25
**PR:** [#96](https://github.com/altisinfonet/lens-lustre-learn-Claude/pull/96) into `staging` · branch `certs-admin-staging`
**Migrations:** `certificate_types_and_admin_search` (applied as `20260825060459`), `certificate_delete_removes_notifications`
**Format:** Baseline → Defect reproduced → Apply → Behavioural matrix → Regressions → Could-not-verify → Invariant lock → Abort condition
**Production status:** **UNTOUCHED.** Verified: neither new function present, index absent, constraint still 14 types.

---

## 0. PRE-FLIGHT BASELINE (staging, before any write)

| Surface | Value |
|---|---|
| `certificates` | 2 |
| `profiles` | 513 |
| `certificate_testimonials` | 0 |
| `user_notifications` type `certificate_issued` | 5 |
| …of which already orphaned (certificate already deleted) | **3** |
| `db_audit_logs` where `table_name='certificates'` | 8 |
| profiles named "Zara Kim" | **25** |

The 25 identical names are what make the recipient-search defect measurable rather than theoretical.

### Certificate triggers, enumerated before writing anything

| Trigger | Fires | Side effect |
|---|---|---|
| `trg_generate_certificate_identifiers` | BEFORE INSERT | fills `certificate_id`, `verification_token` |
| `trg_notify_certificate_issued` | AFTER INSERT | writes 1 `user_notifications` row |
| `audit_certificates` | AFTER INSERT/UPDATE/DELETE | writes 1 `db_audit_logs` row |

Every one of these was accounted for in the cleanup. None was assumed absent.

---

## 1. THE DEFECTS, REPRODUCED ON STAGING BEFORE THE FIX

### 1.1 Recipient lookup returned one of twenty-five

The old code was `.from("profiles").ilike("full_name", '%q%').limit(1)` with no email selected.

```
old behaviour  ilike('%Zara Kim%').limit(1)   ->  1 row,  "Zara Kim"
people actually sharing that name              ->  25
the other 24                                   ->  INVISIBLE to the admin
```

The certificate was issued to whichever row Postgres happened to return first. Email is the only
field that separates them, and the old lookup did not select it.

### 1.2 The list capped at 50

Old code: `.order("issued_at", {ascending:false}).limit(50)`, no paging.

```
certificates in the table            60
rows the admin could see             50
rows SILENTLY INVISIBLE              10     no page 2 existed, nothing said they were missing
```

### 1.3 `achievement` and `custom` were offered and refused

The form has carried both options since it was written; the CHECK constraint permitted neither.
Production: 0 of 23 certificates carry either type — none could ever be written.
Measured directly: production's constraint lists 14 values, staging's now lists those same 14
verbatim plus these 2.

---

## 2. APPLY

`apply_migration(ztzutckwdhetphwghuzj, certificate_types_and_admin_search)` → `{"success": true}`
`apply_migration(ztzutckwdhetphwghuzj, certificate_delete_removes_notifications)` → `{"success": true}`

### Post-apply structural verification

| Check | Expected | Actual | |
|---|---|---|---|
| constraint values | 16 = production's 14 verbatim + 2 | exactly that | ✅ |
| `admin_search_certificate_recipients` | SECURITY DEFINER, `search_path=public, auth` | as expected | ✅ |
| `admin_list_certificates` | SECURITY DEFINER, `search_path=public` | as expected | ✅ |
| grants on both | postgres, authenticated, service_role — **no anon, no PUBLIC** | exactly that | ✅ |
| `idx_certificates_issued_at_id_desc` | `(issued_at DESC, id DESC)` | as expected | ✅ |
| `trg_cleanup_certificate_references` | present, BEFORE DELETE, FOR EACH ROW | present | ✅ |

---

## 3. BEHAVIOURAL MATRIX

### 3a. Recipient search — 13 tests

| # | Test | Expected | Actual | |
|---|---|---|---|---|
| R1 | empty query | 0 rows, not everyone | 0 | ✅ |
| R2 | whitespace-only query | 0 | 0 | ✅ |
| R3 | `Zara Kim`, default limit | 20 shown, total 25 | 20 / 25 | ✅ |
| R4 | `Zara Kim`, limit 5 | 5 shown, total **25** | 5 / 25 | ✅ |
| R6 | limit −5 | clamps to 1 | 1 | ✅ |
| R7 | no such person | 0 | 0 | ✅ |
| R8 | broad query, limit 10000 | clamps to 50, total 513 | 50 / 513 | ✅ |
| R9 | every match carries an email | 25 of 25, 25 distinct | 25 / 25 distinct | ✅ |
| R10b | search by email substring | finds exactly that member | 1 | ✅ |
| R11 | `zArA kIm` | case-insensitive | 25 | ✅ |
| R12 | old `.limit(1)` behaviour | 1 of 25 | 1 | reproduced |

R4 is the point of the whole change: the admin is told **25**, not left to assume 5 is everyone.

### 3b. Certificate list — 20 tests

Paging, walked page by page against the real function:

| # | Test | Expected | Actual | |
|---|---|---|---|---|
| P1 | page 1 of 6 (limit 10) | 10 rows, total 60 | 10 / 60 | ✅ |
| P2 | last page (offset 50) | 10 rows, total 60 | 10 / 60 | ✅ |
| P3 | offset past the end | 0 rows, no error | 0 | ✅ |
| P4 | limit 10000 | clamps to 200 | 60 (all) | ✅ |
| P5 | default page size 100 | all 60, the 51st no longer lost | 60 | ✅ |
| L4–L7 | offset/limit clamping (−5 → 1, −50 → 0) | clamps | clamps | ✅ |

**Completeness and disjointness.** All six pages walked and unioned. The seed was built to be
hostile: 58 rows carrying only **6 distinct `issued_at` values**, so every page boundary falls
inside a block of roughly ten rows tied on the sort key.

```
rows returned across all 6 pages     60
distinct ids                         60
DUPLICATES (a row on two pages)       0
certificates in the table            60
NEVER SHOWN (unreachable rows)        0
```

Filters, each compared against ground truth counted directly from the table:

| # | Filter | Function | Table | |
|---|---|---|---|---|
| F1 | `type=achievement` | 11 | 11 | ✅ |
| F2 | `type=custom` | 12 | 12 | ✅ |
| F3 | `type=course_completion` | 13 | 13 | ✅ |
| F4 | `type=competition_top_50` | 12 | 12 | ✅ |
| F5 | achievement, limit 5 offset 5 | 5 shown, total **11** | — | ✅ |
| F6 | title search | 10 | 10 | ✅ |
| F7 | **title search AND type filter together** | 12 | 12 | ✅ |
| F8 | ordering strictly descending across all 60 | yes | — | ✅ |

F1 and F2 are also the proof that the constraint change works: those 23 rows could not have
existed at all before this migration.

F7 matters beyond itself — it is the proof that the two filters **compose** rather than one
silently winning, which is the failure the old client-side filtering produced.

### 3c. Authorization — 6 refusals

| # | Caller | Function | Result | |
|---|---|---|---|---|
| A1 | signed-in **non-admin** | recipients | `Not authorized` | ✅ |
| A2 | signed-in **non-admin** | list | `Not authorized` | ✅ |
| A3 | `anon` claims, no `sub` | recipients | `Not authorized` | ✅ |
| A4 | `anon` claims, no `sub` | list | `Not authorized` | ✅ |
| A5 | no JWT at all | recipients | `Not authorized` | ✅ |
| A6 | no JWT at all | list | `Not authorized` | ✅ |

### 3d. Delete — the root-level test

One probe certificate deleted as the admin through the exact path the browser uses
(`set local role authenticated` + the admin's `sub` in the JWT claims).

**Before:** verifiable by both public paths.

**After, BEFORE the trigger existed:**

| Surface | Result | |
|---|---|---|
| row in `certificates` | 0 | ✅ |
| `verify_certificate('CERT-…')` | 0 — **no longer verifiable** | ✅ |
| `verify_certificate_by_token(…)` | 0 — **no longer verifiable** | ✅ |
| `certificate_testimonials` | 0 (FK cascades) | ✅ |
| token / CERT-id anywhere | 0 | ✅ |
| **`user_notifications` pointing at it** | **1 — ORPHAN** | ❌ |

**⚠ THE SEVENTH DEFECT.** `certificates` is referenced by exactly one FK
(`certificate_testimonials`, ON DELETE CASCADE) and by one column with **no** foreign key at all:
`user_notifications.reference_id`. The member kept a notification reading
*"New Certificate! You've earned: … 🎓"* for a certificate that no longer existed.

Every other loose reference column in the schema was then measured against `certificates`:

| Column | Certificate ids held |
|---|---|
| `admin_notifications.reference_id` | 0 |
| `held_result_notifications.entity_id` | 0 |
| `held_result_notifications.in_app_reference_id` | 0 |
| `notification_emit_log.entity_id` | 0 |
| `certificates.reference_id` | 0 |
| **`user_notifications.reference_id`** | **all of them** |

`user_notifications` is the only leak.

> **⚠ CORRECTION, 2026-08-25.** While reporting this I twice described the production orphan as
> belonging to *"a real member"*. **That was wrong, and I should have read the row before
> characterising it.** All four orphans — production 1, staging 3 — were **my own test probes from
> earlier the same day**, all on the admin account `50mm Retina World`, titled
> `DELETE-PROBE-2026-08-24`, `PROBE achievement` and `PROBE custom`, created between 05:12 and
> 05:40 UTC. No member was ever affected. The **defect is real and the trigger is still the right
> fix** — a delete genuinely did leave the notification behind, which is exactly how my own probes
> produced these rows. What was wrong was the claim about who was holding one.

**After the trigger was applied**, a second probe certificate — this one carrying a child
testimonial — was deleted the same way:

| Surface | Result | |
|---|---|---|
| certificate row | 0 | ✅ |
| child testimonial (FK CASCADE) | 0 | ✅ |
| **`user_notifications` pointing at it** | **0** | ✅ |
| verification by CERT-id and by token | 0 / 0 | ✅ |
| certificates left ↔ notifications matching a live certificate | 57 ↔ 57 | ✅ no collateral deletion |
| `db_audit_logs` DELETE row | 1 — **kept on purpose** | ✅ |

The 55-row bulk cleanup that followed then exercised the trigger at scale.

---

## 4. CLEANUP, VERIFIED AGAINST THE §0 BASELINE

| Surface | Baseline | After cleanup | |
|---|---|---|---|---|
| `certificates` | 2 | 2 | ✅ |
| probe rows by sentinel | 0 | 0 | ✅ |
| `certificate_issued` notifications | 5 | 5 | ✅ |
| …of which orphaned | 3 | 3 (all pre-date today) | ✅ |
| `certificate_testimonials` | 0 | 0 | ✅ |
| `profiles` | 513 | 513 | ✅ |

**One row of residue was found and removed.** The first probe certificate was deleted *before* the
trigger existed, so its notification survived — the leak, demonstrated on my own test data. It was
removed by its exact `reference_id`.

`db_audit_logs` went 8 → 124 (58 inserts + 58 deletes recorded). An audit log is append-only by
design; those rows are the record of this run, not residue.

---

## 5. REGRESSIONS

None observed. The automatic certificate paths were not touched: `generate_certificate_identifiers`
and `notify_certificate_issued` are unchanged, `trg_auto_certificate_r4_award` is unchanged, and
the new trigger fires only on DELETE. Full test suite: **2354 passed, 1 skipped, 0 failed.**
`tsc --noEmit` clean.

---

## 6. COULD NOT VERIFY

1. **Whether the `id` tiebreak is load-bearing at this size.** The six-page walk returned 0
   duplicates and 0 unreachable rows *with* the tiebreak. The same walk *without* it also returned
   0 — because the planner chose one stable plan for all six calls. The tiebreak makes the
   guarantee unconditional across plans, but **this run did not demonstrate the failure it
   prevents.** Recorded rather than dressed up.
2. **The index's benefit at scale.** At 60 rows `EXPLAIN` chooses a Seq Scan plus Sort, correctly.
   Forcing `enable_seqscan=off` gives an **Index Only Scan with no Sort node**, so the index does
   serve the exact ordering — but nothing here measures what it saves at size.
3. **Deep-offset cost at millions of rows.** `OFFSET` is O(n) in the offset. The same trade-off was
   accepted knowingly for the member list on 2026-08-24 and applies here unchanged.
4. **The UI itself.** Only the RPCs and the delete path were exercised. The React pager, the
   recipient chooser, the grouped dropdown and the PDF download are covered by 27 source pins and
   are **not** execution-proven. That needs a browser session against the deployed staging site.

---

## 7. INVARIANT LOCK

- Both new functions must remain SECURITY DEFINER with a pinned `search_path` and the
  `has_role(auth.uid(),'admin')` guard. A1–A6 are what prove the guard holds.
- Neither may ever carry an `anon` or `PUBLIC` grant.
- `count(*) over ()` must remain over the **filtered** set, never the page.
- `ORDER BY issued_at DESC, id DESC` — removing the `id` tiebreak removes the guarantee behind §3b's
  two zeros, whether or not a given run happens to break.
- The constraint must never be dropped without being restated in full; every existing value is
  carried over verbatim.
- `trg_cleanup_certificate_references` must stay BEFORE DELETE, SECURITY DEFINER, and keyed on
  `reference_id = OLD.id` with no branch and no dynamic SQL.
- The certificate type registry in `certificateTypes.ts` must equal the CHECK constraint exactly.
  If they diverge, either the form offers something the database refuses, or a stored type has no
  `<option>` and the `<select>` silently rewrites it.

---

## 8. ABORT CONDITION FOR PRODUCTION

Stop and report if, on production: the constraint's existing 14 values are not carried over
verbatim; the `certificates` row count changes across the apply; A1–A6 do not all return
`Not authorized`; the page-union check yields any duplicate or any unreachable row; or a delete
leaves anything behind on any of the surfaces in §3d.

---

## 9. NOT IN THIS CHANGE — recorded, each needing its own decision

1. ~~**The historical orphan notifications.**~~ **CLOSED 2026-08-25, owner-approved.** All four were
   my own probes on the admin account (see the correction in §3d), not member data. Before deleting,
   every surface that could hold a trace was measured: `push_delivery_log` 0,
   `notification_emit_log` 0, `held_result_notifications` 0, `admin_notifications` 0,
   `email_send_log` 0 — the `user_notifications` row itself was the only copy. Both triggers on that
   table are AFTER INSERT only, so the delete had no side effects. Deleted by exact id: production 1,
   staging 3. After: 0 orphans on both, production `certificate_issued` 12 → 11, certificates 23
   unchanged; staging 2 certificates matched 1:1 by 2 notifications.
   The migration still does not delete anything historical — that stays a human decision, and this
   one was made explicitly.
2. **`admin_search_users` (v1) carries an `anon` EXECUTE grant in production.** Pre-existing,
   flagged 2026-08-24, still open.
3. **`AdminGiftCredit` "All Users"** — a 1,026-round-trip client loop and a `.limit(1000)` cap.
   Diagnosed, not fixed.

---

## VERDICT

**PASS on staging, and one new defect found and fixed in the process.** Seven defects total:
six reported by the owner, plus the orphaned notification that only surfaced because the delete was
verified surface by surface instead of assumed.

Every write to staging was sentinel-tagged and reverted, and the revert was verified against the
§0 baseline rather than asserted.

**Production is NOT applied and must not be until the owner has reviewed the staging site.**
Recommended order when they approve: apply both migrations → re-run §3 read-only against
production → then ship the UI.
