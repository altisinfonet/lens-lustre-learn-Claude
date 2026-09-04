# P1 · THE FROZEN REVOCATION LIST — task 1-AU-02

**Auditor-owned. D1 does not write revocation SQL before this file exists, and does not vary from it.**

**REVISION 2 — 2026-09-04, and it withdraws an item.** Revision 1 listed `verify_staff_id`'s
`blood_group` column as a thing to remove. **The Owner challenged it and the Owner was right.**
See §2.3 and correction **C-60**, recorded against the Auditor. Revision 1 is superseded on that
one item and unchanged on every other.

---

## 0 · Why this file is short and the readings behind it are long

Three inputs, and the disagreements between them are the reason this list exists rather than the Addendum's
original four bullet points:

| input | delivered | classification |
|---|---|---|
| D2 · call-site inventory (1-D2-01), 7 sites, commit `24db97a`, blob `ef20a31a` | 2026-09-04 | **OWNER-RELAYED** — read in chat, not yet on origin (courier-blocked). Re-classify VERIFIED when it lands. |
| D1 · function bodies (1-D1-01), commit `5593f4e`, blob `d90bbd78` | 2026-09-04 | **OWNER-RELAYED**, same reason |
| Auditor · production catalogue reads | 2026-09-04 | **VERIFIED** — `SELECT` only, quoted in §3 |

**Two register counts are undercounts and the list is sized to the measurement, not to the register.**
D1 measured **33** VOLATILE anon-executable functions where the register says eight, and **5** SECURITY DEFINER
views where it says four. A sweep sized for eight leaves twenty-five behind. Corrections **C-58** (8 → 33) and
**C-59** (4 → 5) are recorded against the Auditor, not against D1.

---

## 1 · THE RULE EVERY ITEM ON THIS LIST IS GATED BY

> **A closure is proved per function, by
> `has_function_privilege('anon', <oid>, 'EXECUTE') = false`, on the lane it is claimed for.**
> No gate on this list may be written against a *class* (`TRAP-BOTH`, `TRAP-PUBLIC-ONLY`, `ANON-NAMED-ONLY`).

D1 measured the class split as **222 / 24** on production and **246 / 0** on staging — the same 246 total, a
different split, because production has no `pg_default_acl` entry for `supabase_admin` in `public` and staging
does. A class-based gate proven on staging would not describe production. D1 then **bounded** it: all 21 named
Phase 1 objects carry the *identical* class on both lanes, and the divergence is entirely the 24
`supabase_admin`-owned `plpgsql_check` functions. So the ruling costs nothing and protects against the case
where it would have mattered. That is the right shape for a rule.

**And per F-62 / F-64 / F-66, a `REVOKE … FROM anon` is a no-op wherever `PUBLIC` holds the grant, and a
closed function reopens on `DROP`+`CREATE`.** Every revoke on this list is written `REVOKE ALL … FROM public`
followed by the named grants, and every closure is re-proved after any later migration that recreates the object.

---

## 2 · THE LIST

### 2.1 · Revoke now — one item, and only one

| object | action | why it is safe today |
|---|---|---|
| `email_exists(text)` | `REVOKE ALL … FROM public, anon` | **D2 measured the only call site as fail-open**: `ForgotPassword.tsx:39` is wrapped in try/catch, any error sets `exists = null`, and the page falls back to the generic reset flow. The screen loses the "no account with that email" message — **which is exactly what P30 requires**. D1 measured its class as `ANON-NAMED-ONLY` on both lanes, so a plain revoke actually closes it. |

Nothing else is cleared for revocation in this issue of the list.

### 2.2 · BLOCKED on a client change — do not revoke

| object | blocker |
|---|---|
| `search_certificates(...)` | **D2's finding, and it is the most important thing in the inventory.** All four verification pages collapse error and empty into one branch (`VerifyCertificate.tsx:81`, `:103`, `CertificateVerifyByToken.tsx:46`, `IDVerification.tsx:63`). On revoke day a real certificate holder is told, calmly and confidently, that their certificate could not be verified — which reads as a forgery and gets reported by nobody. **A silent wrong answer is worse than an error.** D1 already holds the fix as `d1-P31-client-half-20260903.patch` (`5689cfb`); it is D2's lane to land. |
| `increment_managed_page_view(...)` | `ManagedPageView.tsx:34` fires `.then(() => {})` with no rejection handler. A revoke turns it into an unhandled rejection on a public page. Client handler first. |

### 2.3 · NOT a revocation — these need a design decision, and the list will not pretend otherwise

| object | what is actually wrong |
|---|---|
| ~~`verify_staff_id(text)`~~ | **WITHDRAWN — C-60. See §2.5.** The Addendum's original gate for it stands unchanged: *placed behind a session or a rate limit.* Nothing about its return type is to be altered. |
| `entry_vote_counts` | Publishes **`adjustment_votes`** — `sum(admin_vote_adjustments.adjustment_value)` per entry — to anon. It is a **materialized view**, so there is no RLS to enable and `security_invoker` is not an available option. Remedies are exactly two: revoke `SELECT`, or drop the column and publish `final_votes` only. |

### 2.5 · C-60 — the Auditor called a designed feature a leak

Revision 1 said `blood_group` "should not be in the return type" of `verify_staff_id`, and called
its presence there medical information leaking to anonymous callers. **That was wrong, and the
Owner caught it by asking the obvious question: why would you remove the blood group from a staff
ID?**

Read from the code before writing this correction:

- `src/pages/IDVerification.tsx:189-196` renders **Blood Group as a deliberate stat tile** — its own
  card, a `Droplets` icon in red, a bold value. That is a designed feature, laid out with care.
- `src/components/admin/AdminEmployee.tsx:44,144,267` — an administrator **types it in** on the
  employee form and it is shown in the staff list.
- The page's whole purpose is: somebody is handed a staff card and types the printed ID number in
  to check the card is genuine. **The blood group is printed on the card they are already holding.**
  Showing it back is not disclosure; it is the verification doing its job.

And blood group is deliberately low-secrecy information by its nature. It is put on ID cards,
bracelets and dog tags **precisely so a stranger can read it in an emergency**. Treating it as
confidential inverts the reason it is collected.

**What went wrong in the Auditor's reasoning.** A column name that pattern-matches to "medical
data" was classified from the name alone, without reading the page that displays it — the exact
failure this project has a standing rule against. `50mm-security-reviewer` says to judge a
`SECURITY DEFINER` function by its `WHERE` clause and by what it actually exposes. The `WHERE`
clause here is `id_number = $1` on a number printed on the artefact being verified. Had that rule
been applied instead of a keyword reaction, Revision 1 would not have contained the item.

**It is the same error class as C-49 and C-53** — a figure or a finding written down without its
instrument — and it is worth naming plainly because the Auditor has recorded that class against
others twice this week.

**What the real risk is, and it is smaller and different.** `verify_staff_id` has no rate limit and
no session check. If the staff table grows and ID numbers turn out to be guessable, the function
becomes a **staff-directory harvester** — names, designations, photos, `about`, and yes, blood
groups, but as one field among several, and the harvesting is the problem, not the field.
Measured today: `office_staff` holds **1 row** with a **9-character non-sequential** ID, so this
is not exploitable now.

**Which is exactly what the Addendum already asked for**: *"`verify_staff_id` placed behind a
session or a rate limit."* The original gate was right and needed nothing added to it.

### 2.4 · Deferred with a reason, not silently

`get_public_role_user_ids` — D1's triage rule classified it unguarded; the body raises `42501` for any role
outside `('admin','judge')`, a genuine allow-list the rule cannot see. **D1 reported the rule's limitation rather
than quietly widening it**, which is the correct handling and is recorded here so the next argument-guard that
*is* missing still gets found.

The fourteen `admin_*` / `fix_*_admin` / `backfill_*` / `get_*_admin` functions are anon-executable **and guarded
in the body** (`has_role` + `RAISE`, measured on every one). The grant is still wrong and Phase 1 still fixes it.
**It is not an open door, and the phase is not to be re-planned as though it were.**

---

## 3 · THE AUDITOR'S OWN READINGS — production `jtdtehuqtinjxropkkcn`, `SELECT` only, 2026-09-04

D1's two most serious findings, re-measured independently before they were written into this list.

```
verify_staff_id  prosecdef=true  provolatile=s  anon_exec=true
  returns TABLE(id_number text, full_name text, designation text, photo_url text,
                blood_group text, about text, active_from date, expires_on date, job_status text)
  body: SELECT … FROM public.office_staff WHERE upper(trim(id_number)) = upper(trim(coalesce($1,'')))
        LIMIT 1     — no rate limit, no session check

entry_vote_counts  relkind=m (materialized view)  anon_select=true  rls_enabled=false
  columns: entry_id, real_votes, adjustment_votes, final_votes
```

**Both readings confirmed.** But a reading is not a finding: `entry_vote_counts` is a finding,
and `verify_staff_id` is a designed feature that was misread as one — see §2.5. D1 reported both
accurately; the Auditor's *classification* of the first was the error, not D1's measurement.

### And the scale, because a finding without its scale is not a measurement

```
office_staff:        1 row,  1 with a blood_group,  id_number 9 chars, non-sequential
entry_vote_counts:   0 rows
```

**Ruled: neither is an emergency today, and both are must-fix before they are used.** One employee's blood group
is exposed behind a 9-character non-enumerable key; the vote view discloses nothing because it is empty. Calling
either a live breach would be wrong, and so would filing them behind twenty other items — the day a second staff
card is issued or the first competition runs, the exposure is real and nothing will announce it. This is the
C-49 / C-53 discipline applied to a security finding: **the defect is confirmed, the blast radius is stated, and
the two are not allowed to stand in for one another.**

---

## 4 · What D1 does next

1. **`email_exists` only.** One PR, apply + rollback, `20260910_0001`.
2. **Re-cut `20260910_0002`.** D1 reported that its header claims an anonymous caller "can make the database do
   unbounded write work for free" and that `recompute_entry_from_tag_assignments(uuid)` is measurably
   `BEGIN RETURN; END;` — a no-op stub. The revoke stays correct; the justification is false. **A file whose
   comment is wrong is a Standing Rule 21 finding against itself.** It is unapplied, so the re-cut is cheap.
3. **Written disposition owed:** two SECURITY DEFINER functions call that no-op, one of them a `trg_`-named
   function attached to no table. Either the recompute was deliberately disabled and its callers left standing,
   or it was gutted and something is quietly not being recomputed. **A feature that has never worked is a
   decision, not a bug** — it needs a sentence saying which.

*Auditor · 2026-09-04. Frozen. Amendments are a new revision of this file, dated, superseding nothing silently.*
