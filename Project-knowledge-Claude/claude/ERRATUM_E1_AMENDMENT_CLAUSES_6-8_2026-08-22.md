# ERRATUM E-1 — AMENDMENT, CLAUSES 6–8

**Companion to `WWW_DECISION_RECORD_AND_ERRATUM_E1_2026-08-22.md`.**
**Governing plan: Master Execution Plan Rev 3.0 + Erratum E-1. There is no Rev 3.1.**
Owner-issued 2026-08-22. Recorded, not inferred. No mutation accompanies this record.

---

## E-1 clause 6 — Path nomenclature is now mandatory

Production is two paths, and every gate report, RC record, promotion record and
post-deployment verification from this point on must name which it covers:

| | |
|---|---|
| **Path A** | `50mmretina.com` — Cloudflare-controlled |
| **Path B** | `www.50mmretina.com` — independently built, uncontrolled |

An unqualified claim about "production" is incomplete and must be treated as
such by any later reader. Rev 3.0 §12's promotion record and §18's
post-production checklist inherit this requirement.

## E-1 clause 7 — DNS creation does not authorize G7

Creation of `staging.50mmretina.com` and `cdn-staging.50mmretina.com`
authorizes **DNS creation only**. G7 may be designed only when **all three**
hold:

1. The six-part DNS verification passes — three recursive resolvers, the
   authoritative nameservers, the known-absent control **in the same run**,
   target/signature verification, conflicting-record check, and the zone SOA
   serial advanced past the recorded `2410539482`.
2. The `www` decision record is complete — Path B classified.
3. G7's architecture is updated to account for both paths, or records
   explicitly why Path B is excluded.

## E-1 clause 8 — Pre-committed HS-1 trigger for Path B

If investigation establishes that Path B carries production Supabase or R2
credentials, or otherwise constitutes an uncontrolled production path holding
production configuration, the response is fixed **in advance** so it is not
decided under pressure:

- **STOP immediately.** Classify the HS-1 condition (Rev 3.0 §14: a production
  surface outside the controls the live gate authorized).
- **Do not remediate automatically.** No repoint. No deletion. No record change.
- Record scope, evidence and timestamp; the owner rules on the response.

Any eventual `www` repoint or removal is a **separate production change**
requiring its own Change ID, explicit owner authorization, before/after
evidence, a rollback procedure and post-change verification. It is never
housekeeping.

---

## Standing scope corrections carried from E-1

- **G6 remains AMBER.** Its guard-side evidence and any future Pages deploy log
  line cover **Path A only**. Its eventual GREEN must be worded to that scope.
- **G7 remains OPEN / STOPPED** — not started, not designed — until Path B is
  classified.

---

## What happens when the entry-chunk filename arrives

Prepared, not executed. On receipt of the public `assets/index-*.js` filename
from `view-source:https://www.50mmretina.com/`, one pass:

1. Fetch that public chunk by its exact name.
2. Extract, by literal string search only: any `*.supabase.co` origin and the
   project reference within it; any `sb_publishable_*` or JWT-shaped
   publishable key **recorded by comparison, never printed**; any
   `*.r2.dev`, `*.r2.cloudflarestorage.com` or custom CDN hostname; any other
   backend endpoint literal.
3. Compare the recovered reference against `jtdtehuqtinjxropkkcn` (production)
   and `ztzutckwdhetphwghuzj` (staging) — the only two projects in the
   organisation.
4. Confirm the chunk's identity with the same content-hash logic already
   validated: it must be reachable at the given name while a fabricated name
   404s, so the fetch is a genuine content match rather than an SPA fallback.
5. Classify **VERIFIED** or **UNVERIFIABLE-BY-DESIGN**. If the bundle does not
   expose the backend, stop and say so. **Do not infer.**
6. If clause 8's condition is met, stop at that point and classify HS-1 rather
   than continuing the investigation.

No bypass, credential discovery, scanning, exploitation or invasive probing
will be used at any step. The filename and the bundle are public.

---

## Status at the time of recording

G0 GREEN · G1 GREEN · G2 GREEN · G3 **AMBER** · G4 GREEN · G5a GREEN ·
G5b **OPEN** · G6 **AMBER (Path A only)** · G7 **OPEN / STOPPED** ·
G8 **OPEN** · G9 **OPEN** · G10 **BLOCKED**.

Workspace clean at `9aea8a30916fee06a741c52ef34914e4a2788f96`;
`origin/main` untouched at `32930e75b1d87d361f44e4b4f90dabf9deeda3e1`.
No DNS, Cloudflare, `www`, Supabase, R2 or repository mutation.
