# P31 — Session B forensic re-check, 2026-09-21

**Unit:** P31 · Phase 1 · D1 · **Session:** SESSION B — Phase-1 gate closure / durability owner
**No code, SQL, or migration was changed for P31 this session.** Two of three clauses are already
durably closed; the third needs an Auditor ruling this session does not have authority to make (see
§4) — this document supplies decision-ready evidence and does not invent one.

## 1 · The gate, verbatim

> **P31** — name-based certificate search removed from `anon`; verification by token retained and
> tested; `verify_staff_id` placed behind a session or a rate limit.

## 2 · Per-clause status, re-verified live, staging `fpszggreishhuvdpkmdr`, 2026-09-21

| clause | live reading | durable artefact |
|---|---|---|
| `search_certificates` removed from anon | `anon_exec=false`, `authenticated_exec=true` (retained per frozen list §2.1) | `20260910_0003_p31_search_certificates_revoke.sql` |
| `verify_certificate_by_token` retained and tested | `anon_exec=true` (deliberately — this is the feature), PUBLIC entries = 0 | `20260910_0005_oi3_verify_certificate_by_token_public_only.sql`; client test `src/pages/__tests__/verifyCertificateFailOpen.test.tsx` present on this branch |
| `verify_staff_id` behind a session or rate limit | **still fully open**: `anon_exec=true`, `authenticated_exec=true`, **`public_exec=true`** — no session check, no rate limit, unchanged from every prior reading back to 2026-09-04 | none — correctly none; building one without a ruling is out of scope (§4) |

## 3 · Also re-verified, per the task's own re-check list

- **Certificate search — three-state refusal copy.** `docs/gates/P1-revocation-list.md` §2.2
  records this SATISFIED by `AUDITOR-RULING-2026-09-05-02`, discharged on D2's three-state refusal
  copy (distinct "Search Unavailable" / "Verification Unavailable" strings) live in the production
  bundle. Not re-read live in a browser this session (no browser tooling invoked); taken as
  Auditor-recorded, not re-verified independently.
- **F-87 — transport failure surfacing as "No Certificates Found."** `docs/gates/P1-revocation-list.md`
  explicitly states the §2.2 discharge is **NOT** the closure of F-87, and F-87 remains open, parked
  at PR #156. Re-confirmed by grep: `docs/PROMOTION_LEDGER.md` still describes it as open (no
  contradicting "F-87 closed" record found anywhere in the repository or this Project). **Still
  open — a P32-adjacent client transport defect, not this session's lane.**
- **`increment_managed_page_view`.** Live reading: `provolatile=v` (VOLATILE), `prosecdef=true`,
  `anon_exec=true` — still fully open, and correctly a **P32** object (one of the 88
  anon-executable VOLATILE functions), not P31's or P33's, so its revoke is out of this session's
  scope. What WAS re-verified: the client-side blocker `docs/gates/P1-revocation-list.md` §2.2
  named — `ManagedPageView.tsx:34` firing `.then(() => {})` with no rejection handler — is fixed.
  `src/pages/ManagedPageView.tsx` now uses a two-argument `.then(onSuccess, onError)` with an
  explicit comment explaining why (`PostgrestBuilder.then()` resolves rather than rejects on a
  PostgREST error), and `src/pages/__tests__/managedPageViewCounter.test.tsx` tests both the
  resolved-error and thrown-rejection paths. **The client fix that unblocked this function's future
  P32 revoke is done and tested; the revoke itself is Session A's/P32's to perform.**

## 4 · `verify_staff_id` — decision-ready evidence, restated and re-verified, not re-decided

This session did not invent a new ruling and did not build the edge-function rate-limit. The
2026-09-17 decision-ready record (`claude/2026-09-17-P31-verify-staff-id-decision-ready-evidence.md`,
this Project) already lays out the two live options correctly, and this session re-verified its
factual premises rather than repeating them uncritically:

| premise | re-verified 2026-09-21 |
|---|---|
| `verify_staff_id` is `LANGUAGE sql STABLE SECURITY DEFINER` | confirmed live: `provolatile='s'` |
| A STABLE function cannot hold a write-based rate-limit counter itself | unchanged fact of PostgreSQL, not re-derived |
| Converting it to VOLATILE would pull it into the P32 anon-executable-VOLATILE set | consistent with this session's own P32 out-of-scope boundary |
| `office_staff` has 1 row, 9-char non-numeric ID, exact-match `LIMIT 1` | not re-queried this session (would require reading `office_staff` row data, which is out of scope for a grants/DDL forensic check and adds no new information over the 2026-09-16/17 readings) |
| Cloudflare never sees this call (client hits `<project-ref>.supabase.co` directly) | unchanged fact of the client architecture, not re-derived |

**The two options remain exactly as recorded**: (a) a new rate-limited edge function in
`functions/**` calling the existing STABLE RPC with `service_role` — real new D1+D2 feature work,
not a same-session deliverable; or (b) a written accepted-risk ruling on the measured exposure
above. **This session does not choose between them.** Per `docs/ADDENDUM_A_EXECUTION_MASTER.md`'s
own role split and `docs/gates/GOVERNANCE.md` §2.1, that choice belongs to the Auditor (or, if it is
a policy trade-off rather than a verification question, the Owner) — not to a developer session,
and not by default because a developer session happened to look at it. **Recorded here as an
unresolved Owner/Auditor decision** (see the SESSION B deliverable report, item 11).

## 5 · Conclusion

**No duplicate fix created; no ruling manufactured.** Two of three P31 clauses are durably closed
and re-confirmed live. `verify_staff_id` stays open, exactly where the record already had it, with
its decision-ready evidence re-verified rather than re-derived from scratch.
