# G10 STEP 4.1 — SCHEMA-DEPENDENCY GUARD vs PRODUCTION ON T: **PASS**

**2026-08-26. Read-only against production. T unchanged, `main` unchanged, nothing merged.**

---

## How it was obtained without CI, and why it is authoritative

The guard was believed blocked because it is `workflow_dispatch`-only and not yet on `main`. It is
not: the guard ships an **out-of-band catalog mode** documented in-source for *"runners with no
database egress"* — exactly this session's position.

That mode is safe **because the digest is computed by the database, not by the caller**. The guard
re-reads the file and recomputes md5 itself, failing `[S8]` on mismatch. A catalog that was retyped,
truncated or altered in transit cannot be used.

### Integrity — three independent quantities, all from the database

| Quantity | Database-computed | File as written | |
|---|---|---|---|
| md5 | `2a5d437d82daa8f95295df8376ded98e` | `2a5d437d82daa8f95295df8376ded98e` | **match** |
| bytes (`octet_length`) | 16728 | 16728 | **match** |
| rows | 387 | 387 lines | **match** |

Digest verified **twice** — once by `md5sum`, once inside the guard. The catalog was decoded
mechanically via `json.load`; no character was transcribed by hand.

---

## Result — verbatim

```
SCHEMA-GUARD PASS - target ref jtdtehuqtinjxropkkcn
Scanned src/
Catalog: out-of-band catalog, md5 2a5d437d82daa8f95295df8376ded98e verified against the digest computed by jtdtehuqtinjxropkkcn
Every referenced RPC exists on the target and every call site was checked at
argument level.

COVERAGE
  distinct RPC names: 105
  call sites: 122
  argument-compatible checks: 122
  name-only checks: 0
    (of the argument-compatible checks, 19 are calls that pass no
     arguments and are verified callable with none)
```

**Exit code 0.** No `FAKE CATALOG - NOT AUTHORITATIVE` banner — the run was authoritative.

### Why the coverage line is the part that matters

**`name-only checks: 0`** across **122 call sites**. The guard's own header states that a check
degrading to name-only *"is not a weaker version of this guard — it is the very thing this guard
replaces"*, because PostgREST resolves an RPC by **argument name**. Revision 1 of the guard silently
degraded two call sites — including `AdminUsers.tsx:264`, the very call the gate exists for — and
still printed clean.

**Every one of the 122 call sites in the candidate was checked at argument level against production's
real catalog. Nothing was skipped, and the guard proved it.**

This is the defect class that caused G10 run 1 to be stopped on 2026-08-25: `AdminUsers.tsx` called
`admin_search_users_v2` when production had only v1, and the migration travelled as `UNAPPLIED_…` — a
filename, not a control. **That class of defect is now positively excluded for tree T against
production as it stands today.**

---

## Evidence classification

| Aspect | Status |
|---|---|
| **The substantive check — every RPC the candidate calls exists on production with callable argument names** | ✅ **VERIFIED** — authoritative, exit 0, full argument-level coverage |
| The CI *form* of it (dispatched run with a run ID) | **BLOCKED BY PHASE 8** — the workflow is `workflow_dispatch`-only and unregistered until it reaches `main` |

Step 4.1 asks for the guard to run "either as the required check or as a dispatched run". The
**substance is satisfied and recorded**; the dispatched-run artefact shares §17-4's dependency and
arrives when the workflow reaches `main` at promotion.

---

## Evidence ledger — carry to Phase 9

| Item | Value |
|---|---|
| Candidate tree T | `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` |
| Target | production `jtdtehuqtinjxropkkcn` |
| Catalog digest (DB-computed) | `2a5d437d82daa8f95295df8376ded98e` · 16728 bytes · 387 rows |
| Guard verdict | **PASS**, exit 0, authoritative |
| Coverage | 105 RPC names · 122 call sites · 122 argument-level · **0 name-only** |
| Measured | 2026-08-26 |

*Read-only: the catalog query is a SELECT. `/tmp/mtest` unmodified. Nothing merged or pushed.*
