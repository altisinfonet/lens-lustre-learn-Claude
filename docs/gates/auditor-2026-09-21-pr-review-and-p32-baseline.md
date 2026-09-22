# AUDITOR REVIEW — PR #272, #274, #275, #276 · and the P32 execution baseline

**Authored 2026-09-21 by the Auditor session. NOT COMMITTED — read-only git access.**
All readings 2026-09-21 14:31Z–14:35Z. main `96c9d91d` · staging `f0377afa`.
Reviews below are **1-AU-04** reviews, citing the reject rule applied where one is.

---

## 1 · PR #272 — REJECT AND CLOSE

**Head** `2609fbdd` · **base** `main` · merge-base `c424285a` (**not** staging tip) ·
228 ahead / 21 behind staging · **302 files, +49,145 / −958**.

**Reject rules applied:**
- Auditor §4 — *carries more than one unit of work.* Twenty-one commits spanning F-105de, UI-gate
  re-records, resolver fixes and P32.
- Security §6.7 — its payload reintroduces
  `UNAPPLIED_20260911101721_new_project_full_schema_bootstrap.sql` (21,510 lines). The 2026-09-16
  reconciliation proved the un-prefixed twin **sorts last among all dated migrations**, becoming
  "the newest word" on every function it defines, and returns to `apply-migration.yml`'s allowlist.

**Unique required work: none.** Its intended payload is superseded by #274, which carries the same
three P32 migrations (`0027`, `0028`, `0029`) and the same three probes on a clean staging base.
Verified by comparing the two file sets.

**Ruling: CLOSE as superseded by #274.** Do not merge. Do not dispatch.
**Auditor could not execute this** — no write access. Action passes to a writer.

---

## 2 · PR #274 — REVIEW COMPLETE, MERGE BLOCKED ON AUTHORITY

**Head** `a2a1d393` · base staging · merge-base **exactly staging tip** · 1 commit · 9 files ·
**+1,354 / −0**. Structurally clean; verified to the line.

**Technical quality: sound.** Three migrations, three probes, fixture setup, fixture transcript and
an evidence file. Ordinals `0027`–`0029` are unclaimed elsewhere.

**BLOCKING FINDING — authority, not quality.** It closes 18 functions where the signed authority
clears one.

| Group | Functions | Revision 2 position |
|---|---|---|
| money / account-control (`0027`) | `admin_delete_auth_user`, `admin_purge_orphan_user_data`, `admin_reject_wallet_transaction`, `admin_wallet_credit`, `approve_deposit`, `create_pending_deposit`, `expire_gift_credit`, `request_withdrawal`, `soft_void_wallet_transactions`, `wallet_ledger_apply_v2`, `wallet_transaction` | §2.4 — the `admin_*` family is *"guarded in the body … not an open door"* |
| identity group 2 (`0028`) | `admin_list_certificates`, `admin_search_certificate_recipients`, `admin_search_users`, `admin_search_users_v2`, `generate_custom_url` | §2.4, same |
| auth hook (`0029`) | `get_public_role_user_ids`, `password_verification_hook` | §2.4 — `get_public_role_user_ids` **explicitly deferred** |

Revision 2 §4 directs D1's next step as *"`email_exists` only. One PR, apply + rollback,
`20260910_0001`."* #274 is not a defect of Session A's work; it is work that ran ahead of an
authority which has not moved since 2026-09-05.

**Status: EVIDENCE FILED. Not authorised for dispatch.** Unblocks on Owner Decision 1 + a signed
Revision 3 covering these three groups.

---

## 3 · PR #275 — REJECT ON LANE, RE-CUT REQUIRED

**Head** `2bc2e394` · base staging · merge-base **exactly staging tip** · 3 commits · 11 files ·
**+936 / −0**.

**Reject rule applied — Auditor §4, first bullet: *touches a path outside its owner's lane.***

A D1 branch (`d1/P1-session-b-p30-p31-p33-20260921`) adds
**`src/__tests__/p33DefinerViewPredicates.test.ts`**. Addendum A §3.1 assigns `src/**` to **D2
only**, and closes: *"Not even a typo. A session never edits a file it does not own."*

**Auditor ruling on the substance, so the re-cut is not wasted.** The test's subject matter (definer
view predicates) is genuinely D1's, but its tree is D2's. Ruling, by analogy with 1-AU-02's
"where the replacement lives": **the test file moves to a D2 PR; the migrations, rollbacks, probes
and evidence stay in the D1 PR.** Two PRs, one unit each.

**Second finding — undeclared payload.** Session B reported this branch as *"two evidence-only
markdown files, no implementation, no migration."* It carries **two migrations** (`0040`,
`0041`), **two rollbacks**, **two probes**, one TypeScript test and a 192-line evidence README.
The report and the branch disagree; the branch is the fact. Recorded as a finding against the
reporting, not against the work.

**Third finding — the work itself is corroborated.** Commit `3f6ec5e` claims to make durable two
clauses applied live-only on 2026-09-15. **Confirmed independently:**
`schema_migrations` holds `p33_get_primary_admin_user_id_revoke_anon` and
`p33_retire_leftover_rls_tables_behaviour` at `20260915`, and the catalogue reads
`get_primary_admin_user_id` `anon_exec = false`. This is correct and valuable work.

**Status: REJECTED on lane; re-cut as two PRs. Substance accepted pending that.**

---

## 4 · PR #276 — REVIEW COMPLETE, STRONGEST OF THE THREE, MERGE BLOCKED ON AUTHORITY

**Head** `c2462668` · base staging · merge-base **exactly staging tip** · 1 commit · 6 files ·
**+848 / −0**.

**Passes the security reject rules that matter here.** Security §6.1 requires a DEFINER change to
carry an owner-isolation test; §4.3 requires the `WHERE` clause to be the control. This PR
**redefines four function bodies** with **15 `auth.uid()` occurrences**, ships a rollback and a
probe, and does not rely on grants alone. That is the difference between proving a grant state and
proving a body — Risk J in the capacity study, answered correctly.

**Targets verified open on the live catalogue 2026-09-21T14:32Z** — `acquire_judge_lock`,
`heartbeat_judge_lock`, `release_judge_lock`, `judge_apply_single_tag`, each
`=X/postgres | anon=X/postgres`. The vulnerability is real and currently exploitable by an
anonymous caller.

**Minor finding — rollback path convention.** #276 places its rollback under
`supabase/migrations/`; #275 and staging's fifty existing rollbacks live under `supabase/rollback/`.
**Auditor ruling: `supabase/rollback/` is the convention.** Move on re-cut; not a reject.

**BLOCKING FINDING — same authority gap as #274.** The four judging-lock functions are not among the
eight named in 1-D1-05 and are not cleared by Revision 2.

**Status: EVIDENCE FILED. Not authorised for dispatch.** Unblocks on Owner Decision 1 + signed
Revision 3.

---

## 5 · THE P32 EXECUTION BASELINE — authoritative as of 2026-09-21T14:32Z

One baseline, replacing five circulating counts.

### 5.1 · The number

**75.** Predicate, published so it can be contradicted:

```sql
schema = 'public' AND prokind = 'f' AND provolatile = 'v'
AND prorettype <> 'trigger'::regtype
AND has_function_privilege('anon', oid, 'EXECUTE')
-- → 75 rows · 75 prosecdef · 75 carrying =X/postgres · 0 closed-then-regranted
```

### 5.2 · The disagreement, published unresolved

| Source | Count | Lane · date |
|---|---|---|
| Gate Register Rev 7 | 8 | — |
| C-58 (D1) | 33 | production, 2026-09-09 |
| **Revision 3 draft §3.1** | **88** | staging, 2026-09-16 |
| **This Auditor session** | **75** | staging, 2026-09-21 |
| Session A ("remaining") | 53 | = 75 − 18 (#274) − 4 (#276) |

Session A's 53 **reconciles exactly** with 75 and is arithmetically correct; it describes the world
after #274 and #276 merge *and* dispatch, neither of which has happened.

**The 88 does not reconcile.** Six predicate variants were tried against the live catalogue:
75 (oid, non-trigger) · 73 (distinct name) · 75 (including procedures) · 68 (args > 0) ·
75 (SECDEF non-trigger) · 192 (SECDEF including triggers). **None yields 88.** No migration was
dispatched between 2026-09-16 and today (`schema_migrations` unchanged, latest row `20260915130151`),
so the population should not have moved.

**Ruling, Auditor standard §8: the disagreement is published and acted on by neither.** Revision 3
§3.1 is **not signable as written**. D1 owes a re-derivation that publishes its predicate, on both
lanes. Until then no P32 work is sized against 88.

### 5.3 · What is already closed, and by what

Closure state is **not derivable from the migration tree** (§4.1 of the proposed kickoff). Of the
objects checked: `email_exists`, `search_certificates`, `process_referral_reward` (both overloads),
`get_primary_admin_user_id`, `enqueue_email`, `read_email_batch`, `media_quarantine` read closed;
`delete_email`, `emit_notification`, `move_to_dlq`, `set_write_path` and all 75 read open — including
four whose revoke migrations are **merged on staging**.

`verify_certificate_by_token` reads `postgres=X | anon=X | authenticated=X | service_role=X` — no
`PUBLIC`. That is the shape of a deliberate public endpoint and is **correct as it stands**; it is
not a P32 item.

### 5.4 · Correction to the population's membership

`entry_vote_counts` is a **materialized view**, not a function. It was never in the 75 and must not
be counted in P32's function population. It remains an Owner decision (Owner Decision 4) under
P1-revocation-list §2.3.

### 5.5 · Standing instruction to D1

**No new P32 revoke SQL is authorised.** Permitted now: read bodies, trace callers across `src/**`,
`functions/**` and `supabase/functions/**`, re-derive the count with a published predicate on both
lanes, and draft dispositions. The object reservation (1-D1-02) is posted against the reconciled set,
not against 75 or 88.
