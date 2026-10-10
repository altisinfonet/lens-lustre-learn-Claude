# Decision recorded: `certificates.heading` is KEPT (2026-08-25)

**Owner decision:** keep `heading`. The feature is being built in a separate Claude session.
This session will not remove the column and will not alter `admin_list_certificates`.

## What this changes

The earlier finding stands — the repository and staging disagree — but the resolution is now
"make the repository match staging", not "make staging match the repository".

| Object | Staging (live) | Production | Repository file |
|---|---|---|---|
| `certificates.heading` | present, `text NULL`, 0 values | **absent** | **no file anywhere** |
| `admin_list_certificates` | 12 columns, returns `heading` | absent | 11 columns, no `heading` |

## What the other session must deliver before the next RC can be frozen

1. **A real migration file** for what is recorded on staging as ledger version
   `20260825101651 certificate_custom_heading`, containing both parts it actually performed:
   - `alter table public.certificates add column heading text`
   - the 12-column `admin_list_certificates`, written as **`drop function` then `create function`** —
     `create or replace` cannot change a function's return type and will fail with
     *"cannot change return type of existing function"*.
2. **A rollback file** for it. A draft reconstructed from staging's live schema is attached to
   this session (`DRAFT_certificate_custom_heading_ROLLBACK.sql`); it must be confirmed against
   the real forward migration before it is trusted.
3. **A corrected `UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql`**, or an
   explicit statement that the heading migration supersedes its `admin_list_certificates`.
   As things stand the 060000 file cannot be replayed onto staging at all — it declares 11
   output columns against a deployed 12-column function.
4. **The app wired to `heading`**, or a note that the column is intentionally unused for now.
   Measured on the current staging tip: no file in `src/` reads or writes it, and `CertRow` in
   `AdminCertificates.tsx` has no `heading` field.

Until 1–3 exist, the migration set for the next RC is not a known set, so its expansion order
cannot be certified and nothing may be applied to production.

## Rollback files — written this session

| File | State |
|---|---|
| `UNAPPLIED_20260825060000_certificate_types_and_admin_search_ROLLBACK.sql` | **final** |
| `UNAPPLIED_20260825120000_certificate_delete_removes_notifications_ROLLBACK.sql` | **final** |
| `DRAFT_certificate_custom_heading_ROLLBACK.sql` | **draft** — forward migration has no file |

All three contain zero `INSERT / UPDATE / DELETE / TRUNCATE`. Each names the exact production
baseline it was written against, and each states plainly what it *cannot* undo:

- the 060000 rollback **will refuse** to restore the 14-value CHECK constraint if any
  certificate has since been issued as `achievement` or `custom` — that refusal is correct
- the 120000 rollback cannot bring back notification rows already deleted by the trigger
- the heading rollback destroys any `heading` values (zero today)

They are not committed. This session has read access to the repository but not push
(the platform's own message: *"Use add_repo … with access:\"push\" to attach the repository
with credentials"*), so they are delivered as files.

## Capability boundary, re-measured 2026-08-25

```
gh api user  -> login "altisinfonet"          identity is the owner account
gh api repos/altisinfonet/lens-lustre-learn-Claude
             -> 403  "GitHub access to this repository is not enabled for this session"
git push     -> 403  "not in this session's authorized repository set"
git fetch    -> works
add_repo     -> tool not present in this session
```

The credential exists and the GitHub permission exists. The **session attachment** is
read-only. Push must be attached to the session by the owner, or the work routed through a
session that already holds it.

---

# OWNER ATTESTATION — branch protection on `main` (2026-08-25)

**Owner statement, recorded verbatim:** *"protect-main is created and active."*

Configuration as shown by the owner in the GitHub UI before saving:

| Setting | Value |
|---|---|
| Ruleset name | `protect-main` |
| Enforcement status | **Active** |
| Bypass list | **empty** — no actor may skip the rule |
| Target branches | **Default** — verified from this session as `refs/remotes/origin/main` |
| Restrict deletions | on |
| Require a pull request before merging | **on** — this is the clause that prevents unreviewed direct pushes |
| Required approvals | **0** — changed from 1 on advice, because GitHub does not permit self-approval and the bypass list is empty; with a single reviewer, 1 approval would have made every merge impossible |
| Block force pushes | on |
| Restrict updates | off — deliberately; with an empty bypass list it would have blocked merging a PR as well |
| Require status checks to pass | off — deferred until the schema-guard workflow exists on `main` |

## Classification: OWNER-ATTESTED. Not VERIFIED. Deliberately.

Rev 3.0 §17 line 7 states the check is *"re-attested by the owner at this moment… It is
OWNER-ATTESTED under §3.1 and cannot be read by any session, so it is never recorded as
independently verified."*

This session cannot read it: `gh api repos/altisinfonet/lens-lustre-learn-Claude/rulesets`
returns 403 because the repository is attached read-only. Nor can the consequence be probed —
a direct push to `main` is refused by the session's git proxy before it ever reaches GitHub,
so a refusal would be indistinguishable from the ruleset working. That is hard stop **HS-11**
(*"a probe result that cannot be distinguished from the same result produced by absence,
caching, or a gate carries no information"*), and under HS-11 the correct action is to report
neither way rather than dress an attestation up as a measurement.

**Effect on the gate:** hard stop **HS-12** — *"branch protection on main is absent at the
moment promotion is attempted"* — is **CLOSED**, on the owner's attestation, dated
2026-08-25. §17-7 is satisfied to the maximum standard the document itself permits.

**Re-attestation is required again at the moment of promotion.** §17's preamble: *"Every line
is checked immediately before promotion, on the day of promotion. A line that was true last
week is not checked."*
