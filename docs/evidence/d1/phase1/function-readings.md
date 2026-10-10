# D1 · §4.3 — FUNCTION BODY READINGS, SETS A AND B

**Author:** D1, 2026-09-22. **All readings 2026-09-22T05:31Z–05:34Z.**
**Instrument:** `pg_get_functiondef(oid)` on staging `fpszggreishhuvdpkmdr`, `SELECT` only.
**No function was called.** A function is never invoked to prove it is exposed; the catalogue says
so without touching the body.

**Lane note, and it matters for Set A.** Staging and production hold the *same* body but *different*
grants. Production is not attached to any connector available to this session (BLOCKER-1), so every
body below is read on **staging** and the *exposure* statements are taken from the Auditor's
published two-lane baseline, not re-derived. Where a body decides a question, the body is the same
on both lanes; where a grant decides it, the lane is named.

Column `writes` is `true` when the definition contains an `INSERT`/`UPDATE`/`DELETE` at any depth.

---

## SET A — open on PRODUCTION, closed on STAGING

### A1 · `claim_username(candidate text)` → `jsonb` · writes: **yes** · read 05:32Z

```sql
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  …
  UPDATE public.profiles SET custom_url = candidate, custom_url_changed_at = now()
   WHERE id = uid AND custom_url IS NULL;
```

**Guards:** `auth.uid()` — and it *returns* the refusal rather than raising it. For an `anon`
caller `uid` is `NULL`, so the function exits on its first branch having read nothing and written
nothing. **Self-guarded.**
**Returns:** `{ok:false, reason:'not_authenticated'}` to an unauthenticated caller — no
information about any member, so no enumeration oracle.
**Writes:** bounded twice over — `WHERE id = uid` and `AND custom_url IS NULL`. Unreachable at
`uid IS NULL`.
**Verdict:** production's open grant is **untidy, not exploitable**. Grant-only closure.

### A2 · `change_custom_url(_new_url text)` → `jsonb` · writes: **yes** · read 05:32Z

```sql
  _user_id := auth.uid();
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
```

**Guards:** `auth.uid()`, hard `RAISE`. **Self-guarded.**
**Returns:** `jsonb` — either `{success:true,…}`, or the F-97 refusal
`{ok:false, reason:'change_window_not_elapsed', next_change_at:<timestamptz>}`. The body carries an
instructing comment explaining why the instant travels raw rather than formatted; that comment and
the code agree (Standing Rule 21 check: **no finding**).
**Writes:** `custom_url_history` ×2 and `profiles`, all `WHERE user_id = _user_id`.
**Verdict:** grant-only closure. Calls `clear_custom_url`'s sibling logic inline, not the function.

### A3 · `clear_custom_url()` → `void` · writes: **yes** · read 05:32Z

```sql
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.custom_url_history SET is_current = false, released_at = now()
   WHERE user_id = auth.uid() AND is_current = true;
```

**Guards:** `auth.uid()`, hard `RAISE`. **Self-guarded.**
**Returns:** nothing.
**Writes:** `custom_url_history`, `profiles`, both keyed on `auth.uid()`.
**Verdict:** grant-only closure. Staging already holds no `authenticated` grant on this one, which
is consistent with the Owner's written removal of its only caller
(`src/pages/EditProfile.tsx:563-578`). **Production's grant is the outlier, not staging's.**

---

## SET B — open on BOTH lanes · 28 names, 30 rows

### B-GROUP 1 — `has_role()`-guarded admin functions (14 rows)

Every one of these reads `auth.uid()` and refuses outside `admin` (two also allow `judge` /
`super_admin`). Quoted excerpts, one line each, all read 05:33Z:

| object | args | returns | writes | guard, quoted verbatim |
|---|---|---|---|---|
| `admin_flag_entry_for_review` | `_entry_id uuid` | void | yes | `IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Permission denied: admin role required';` |
| `admin_rewind_stage` | `_entry_id uuid, _to_stage_key text, _reason text` | void | yes | `SELECT public.has_role(auth.uid(), 'admin') INTO _is_admin; IF NOT COALESCE(_is_admin,false) THEN RAISE EXCEPTION 'admin_rewind_stage requires admin role'` |
| `admin_search_users` | `search_query text, search_by text` | TABLE(…email…) | no | `IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized';` |
| `admin_set_photo_rejected` | `_entry_id uuid, _photo_index int, _rejected bool, _reason text` | jsonb | yes | `SELECT public.has_role(auth.uid(), 'admin'::app_role) INTO _is_admin; IF NOT COALESCE(_is_admin,false) THEN RAISE EXCEPTION 'forbidden: admin role required'` |
| `apply_decision_to_remaining` | `_competition_id uuid, _round_number int, _decision text` | TABLE(3 ints) | yes | `IF _caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;` … `IF NOT (_is_admin OR _is_assigned_judge) THEN RAISE EXCEPTION 'Permission denied: not a judge for this competition';` |
| `backfill_judging_notifications` | `_window_days int, _dry_run bool` | TABLE(3 bigints) | no | `IF NOT has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin_only';` |
| `backfill_tag_decision_drift_admin` | — | TABLE(2 ints, jsonb) | yes | `v_caller uuid := auth.uid(); IF v_caller IS NULL OR NOT public.has_role(v_caller,'admin'::app_role) THEN RAISE EXCEPTION 'admin only';` |
| `fix_certificate_readiness_admin` | `_entry_id uuid` | jsonb | yes | `v_admin uuid := auth.uid(); IF NOT has_role(v_admin,'admin') THEN RAISE EXCEPTION 'Forbidden: admin role required';` |
| `fix_gift_drift_admin` | `_announcement_id uuid` | jsonb | yes | same shape as above |
| `fix_referral_drift_admin` | `_referral_id uuid` | jsonb | yes | same shape as above |
| `get_certificate_drift_admin` | `p_competition_id uuid` | TABLE(15 cols) | no | `IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden: admin only';` |
| `get_derived_status_drift_admin` | — | TABLE(8 cols) | no | `IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN RAISE EXCEPTION 'forbidden: admin role required';` |
| `get_judge_collusion_admin` | `p_competition_id uuid, p_min_overlap int, p_min_correlation numeric` | TABLE(7 cols) | no | `IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden: admin only';` |
| `get_judging_tag_assignment_counts` | — | TABLE(uuid, bigint) | no | `IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN RAISE EXCEPTION 'permission denied: admin role required' USING ERRCODE = '42501';` |

**Technical determination (mine, per §4.4):** these fourteen are **body-guarded**. An `anon` caller
gets `42501`/`P0001` and nothing else — no row, no timing signal worth the name, no enumeration.
`P1-revocation-list.md` Revision 2 §2.4 says the same and adds: *"It is not an open door, and the
phase is not to be re-planned as though it were."* **Agreed on the evidence.**
**And the grant is still untidy.** Body-guarded is not grant-closed: an `anon` `EXECUTE` on an
admin function is a defect of hygiene and a second line of defence that is currently absent. The
correct record is *grant-only closure, low urgency*, not *no action*.

### B-GROUP 2 — **UNGUARDED**. No identity check of any kind. (7 rows)

These are the findings. Each was read in full, not sampled.

#### B2.1 · `judging_write_decision_atomic(p_entry_id uuid, p_stage_key text, p_current_round text)` → `jsonb` · writes: **yes** · read 05:34Z

```sql
  IF p_entry_id IS NULL THEN RAISE EXCEPTION '… p_entry_id required' USING ERRCODE='22023'; END IF;
  …
  SELECT stage_key … FROM public.v3_stage_catalog WHERE stage_key = p_stage_key;
  IF NOT FOUND THEN RAISE EXCEPTION '… unknown stage_key %' …
  SELECT stage_key INTO v_old_stage_key FROM public.competition_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION '… entry % not found' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.db_audit_logs (table_name, operation, row_id, new_data, changed_by)
  VALUES ('competition_entries', 'judging_write_decision_atomic', …, auth.uid());
```

**Guards:** *argument validity only.* `auth.uid()` appears **once, as a value written into the
audit row**, never as a control. There is no `has_role`, no judge-assignment check, nothing.
**Returns:** `jsonb`, and — separately — distinguishes *unknown stage_key* (`22023`) from
*entry not found* (`P0002`) from success. That is an **oracle**: a caller with `anon` can test
whether an arbitrary `competition_entries.id` exists, and can enumerate `v3_stage_catalog` keys.
UUID entropy makes the first weak; the second is free.
**Writes:** an unbounded append to `public.db_audit_logs` with `changed_by = NULL`. Anyone holding
`anon` can inflate the audit log at will and *poison the audit trail with forged rows that look
like judging decisions*. The in-body comment says the entry write is deliberately suppressed
(BUG-053) — so the audit row is the *only* effect, and it is the whole exposure.
**Verdict:** **body-level fix required**, not grant-only. Set B, open on **both** lanes. The
present grant means the audit log of a judging system is writable by an unauthenticated caller.

#### B2.2 · `increment_managed_page_view(_page_id text)` → `void` · writes: **yes** · read 05:34Z

```sql
  UPDATE public.site_settings
     SET value = ( SELECT jsonb_agg(CASE WHEN (elem->>'id') = _page_id
                     THEN jsonb_set(elem,'{view_count}', to_jsonb(COALESCE((elem->>'view_count')::int,0)+1))
                     ELSE elem END) FROM jsonb_array_elements(value) elem ),
         updated_at = now()
   WHERE key = 'managed_pages' AND jsonb_typeof(value) = 'array';
```

**Guards:** none.
**Returns:** nothing.
**Writes:** and this is stronger than the "counter inflation" reading in the D2 inventory §4E.
The statement **rewrites the entire `managed_pages` row and bumps `updated_at` on every call,
whether or not `_page_id` matches anything.** Three consequences the caller-side analysis could not
see:
1. `site_settings` is the table behind `siteSettingsCache`. An unauthenticated loop is a **cache
   invalidation storm across every client**, not merely a wrong number on one page.
2. Read-modify-write of a whole JSON array with no row lock: concurrent legitimate increments
   **lose updates** silently. The counter is already unreliable under load.
3. `_page_id` is unvalidated and unused when it matches nothing, so the write is free to the
   attacker and costs the database a full array rebuild each time.
**Verdict:** the Owner decision D2 raised (*should signed-out visitors be counted?*) still stands
and is still the Owner's. But the *technical* record should say **body-level fix required**
regardless of which way that decision goes — a matching-row `WHERE` clause and a rate limit are
owed either way.

#### B2.3 · `_gen_competition_order_no()` → `text` · writes: no (but **consumes a sequence**) · read 05:34Z

```sql
  _seq := nextval('public.competition_order_no_seq');
  RETURN 'ORD-' || to_char(now() AT TIME ZONE 'UTC','YYYYMMDD') || '-' || lpad(_seq::text,5,'0');
```

**Guards:** none. **Returns:** the next order number. **Writes:** no table, but `nextval` is not
rollback-able and is not free: an `anon` caller can **advance the competition order sequence
arbitrarily**, so real order numbers jump, and `lpad(…,5,'0')` overflows its formatting past
99999. Human-visible identifiers are the damage.
**Callers:** none in the application tree; called internally by `submit_competition_entry`, which
does not need the grant.
**Verdict:** `internal/service-role only`. Grant-only closure, and it is a **real** exposure, not
a hygiene item.

#### B2.4 · `recompute_entry_public_status(p_entry_id uuid)` → `void` · writes: **yes** · read 05:34Z

No guard. `UPDATE public.competition_entries SET public_*_derived = v.* FROM public.entry_public_status v
WHERE ce.id = p_entry_id AND … IS DISTINCT FROM …`. The write is idempotent — it copies the view's
own values — so the exposure is **unbounded compute on an arbitrary entry id**, not corruption.
Reached in production only from four trigger functions. **`internal/service-role only`.**

#### B2.5 · `recompute_entry_from_tag_assignments(p_entry_id uuid)` → `void` · writes: no · read 05:34Z

```sql
BEGIN
  RETURN;
END;
```

**The body is a no-op.** It does nothing at all. It is still `SECURITY DEFINER`, still
`anon`-executable, still called by `trg_recompute_entry_after_tag_change`.
Per the skill — *"a feature that has never worked is a decision, not a bug"* — this is owed a
**written disposition: restore it or remove it honestly.** A silent revoke would leave a dead
definer stub in the catalogue and a trigger calling into nothing. Note `0027`'s own header records
`_0002` as *"owed a re-cut, `recompute_entry_from_tag_assignments`"* — that re-cut never happened
(see BLOCKER-3).

#### B2.6 · `log_app_event(16 args)` → `void` · writes: **yes** · read 05:34Z
#### B2.7 · `log_client_error(6 args)` → `void` · writes: **yes** · read 05:34Z

Both begin `_uid uuid := auth.uid();` and use it **as data on the inserted row**, never as a
control. Neither has a rate limit. `src/lib/errorCodes.ts:24` records that the database enforces a
code shape for `log_app_event` and drops anything outside it — a real, if narrow, body-level
control; `log_client_error` has no equivalent.
**Verdict:** `intentional public — justification owed`, exactly as D2 framed it, and the two must
be ruled on **together**: closing `anon` blinds the signed-out and sign-in-failure paths silently,
because both call sites are fire-and-forget.

### B-GROUP 3 — partially guarded / guarded by something other than identity (9 rows)

| object | returns | writes | reading |
|---|---|---|---|
| `get_broadcast_feed(uuid[], int)` | TABLE(15) | no | **thin wrapper**: `SELECT * FROM public.get_broadcast_feed(_exclude_ids,_limit,0,NULL::text[])`. No guard of its own. `SECURITY DEFINER` → the inner call runs as definer, so closing the 4-arg alone leaves this open. |
| `get_broadcast_feed(uuid[], int, int)` | TABLE(15) | no | same wrapper shape, delegating with `_newest_first` |
| `get_broadcast_feed(uuid[], int, int, text[])` | TABLE(15) | no | the real body (4 668 chars). Contains `WHERE fe.user_id = auth.uid()` and a per-hour-per-viewer shuffle seed `to_char(now(),'YYYYMMDDHH24') \|\| coalesce(auth.uid()::text,'anon')` — **it has an explicit `'anon'` branch, i.e. an anonymous viewer is a designed-for case.** Whether the privacy predicate is complete for `auth.uid() IS NULL` is **not settled by this reading** and is owed a dedicated pass (BLOCKER-4). |
| `log_app_event` / `log_client_error` | see B2.6/B2.7 | | |
| `record_test_agent_run(15 args)` | uuid | yes | **token-guarded, and the token comes from Vault**: `SELECT decrypted_secret INTO v_expected_token … WHERE name='test_agent_ingest_token'; IF v_expected_token IS NULL OR p_token IS NULL OR p_token <> v_expected_token THEN RAISE EXCEPTION 'invalid_token';`. Genuinely authenticated, by a secret rather than a session. ⚠ **and the secret is passed as an SQL argument** — skill §7: *"never pass a secret as an SQL argument — it lands in query logs and `pg_stat_statements`."* `intentional public — justification owed`, **plus a recorded defect**. |
| `register_push_token(_token text,_platform text)` | void | yes | `IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated';` + token and platform validation. **Self-guarded.** |
| `unregister_push_token(_token text)` | void | yes | no `IF`, but `DELETE FROM public.push_tokens WHERE token=_token AND user_id = auth.uid()` — for `anon`, `auth.uid()` is `NULL` and the predicate matches nothing. **Guarded by predicate, not by branch.** Worth stating explicitly: it is safe *by the shape of the WHERE clause*, which is the skill §7 rule — *"the WHERE clause is the only control"* — used correctly. |
| `request_withdrawal(numeric, jsonb)` | uuid | yes | `v_user_id uuid := auth.uid(); … RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000';` **Self-guarded.** |
| `submit_competition_entry(8 args)` | jsonb | yes | `_user_id := auth.uid(); … RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000';` **Self-guarded.** |
| `set_write_path(p text)` | void | no | format validation only (`1..64 chars`, `^[a-z0-9_-]+$`), then `set_config('app.write_path', p, true)` — **transaction-local**. An `anon` caller can only mislabel the write path of its own transaction's audit rows. Low, and the `true` (LOCAL) is the thing that makes it low. |

---

## Summary of body verdicts, Sets A and B

| verdict | rows |
|---|---|
| self-guarded on `auth.uid()` (branch or predicate) | 3 (Set A) + 4 (`register_push_token`, `unregister_push_token`, `request_withdrawal`, `submit_competition_entry`) |
| body-guarded on `has_role` | 14 |
| token-guarded from Vault | 1 |
| **unguarded, body-level fix required** | **2** — `judging_write_decision_atomic`, `increment_managed_page_view` |
| unguarded, internal-only, grant-only closure | 3 — `_gen_competition_order_no`, `recompute_entry_public_status`, `recompute_entry_from_tag_assignments` (no-op body) |
| unguarded by design, justification owed | 2 — `log_app_event`, `log_client_error` |
| unguarded wrappers over a guarded body | 2 — `get_broadcast_feed` 2-arg and 3-arg |
| validated but not identity-guarded, low | 1 — `set_write_path` |
| privacy predicate not settled by this reading | 1 — `get_broadcast_feed` 4-arg |

3 + 30 = 33 rows. Reconciles with the Auditor's baseline.
