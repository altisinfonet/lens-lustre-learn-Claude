# G10 — reconciliation run (owner decisions D1–D4 = YES) — 2026-08-26

Read-only against both databases. Nothing applied, committed, promoted, tagged, merged,
deployed, revoked or deleted. All prepared files live in this session's sandbox only.
Every figure below was measured in this run.

## Owner decisions of record
D1 = YES (bring `admin_user_lookup_by_email` into controlled history) · D2 = YES (staging ACLs
must match production) · D3 = YES (bring production `send-gift-credit` v23 into the repository,
after reconciling the diff) · D4 = YES (candidate tree = staging `702e5ce`).

---

## 1. Candidate tree — VERIFIED unchanged

| | Declared | Measured now |
|---|---|---|
| staging HEAD | `702e5ce` | `702e5ceb6d40b6f487cedf2378aae835bd18621f` |
| staging tree | `30ed9e58…` | `30ed9e585c13d493ad253adc3de1d9e9152405e7` |
| commits since declared candidate | — | **0** |
| tags in repository | — | **0** |
| divergence vs `main` | — | main +2 / staging +24, **98 files** |
| **migration + rollback files differing between `main` and `staging`** | — | **NONE** |

That last line is new and load-bearing: the entire 98-file delta is application/CI/SEO
source. `supabase/migrations/` and `supabase/rollback/` are already byte-identical across
the two lanes.

---

## 2. D1 — `admin_user_lookup_by_email`

Blob `e25c3e7ebb338274e9b1518579755ba7239078a3` re-confirmed present, carried by exactly one
ref tip (`origin/gift-credit-user-lookup`), md5 `09948baf…`. No rollback anywhere.

Repository file, both live ledgers and the prepared copy all normalise to
`8d3ec4b1eaf882f324b441bdde3f67df` (1281 chars). Live function definitions identical on both
lanes: `admin_lookup_user_id_by_email` `6c64b6f0…`, `admin_emails_for_user_ids` `8a3cf2ef…`,
both SECURITY DEFINER, STABLE, `search_path = public, auth`, owner `postgres`,
ACL `postgres=X, service_role=X`.

**Production dependency PROVEN in this run**, not inferred: the deployed source of
`send-gift-credit` v23 (`ezbr_sha256 60aed4c759fa04…`) contains
`supabase.rpc("admin_lookup_user_id_by_email", { _email: target_email })` and
`supabase.rpc("admin_emails_for_user_ids", { _ids: resolvedUserIds })`.

**Migration identity preserved.** Filename, `20260824145345`, and content are kept exactly as
they are. No timestamp was invented, and the migration was not recreated under a new stamp.

---

## 3. D3 — `send-gift-credit` v23, and a wider finding

| | Production | Staging | Repo `main`/`staging` | Repo branch |
|---|---|---|---|---|
| version | **23** | 4 | — | — |
| `ezbr_sha256` | `60aed4c759fa042127e8dfb84dc9da0ca16ae066f160dba49437a753b1d6330c` | `16236ecf9612f1f3e5005cbb1f67bd59b87bcec84aa10c5c9a70b0db3f782236` | — | — |
| `index.ts` blob | — | — | `bcbc98dd…` (no RPC) | `4c704d83…` (RPC) |
| `_shared/secureHeaders.ts` blob | old impl | hardened impl | main `0fcaef13` / staging `6d805c66` | `0fcaef13` |
| deployed at (UTC) | **2026-08-24 15:00:42** | 2026-08-24 13:30:40 | — | — |

Only two commits ever touched this function: `da0184a` (2026-08-24, the indexed-lookup fix) and
`09bf190` (2026-07-09, the Supabase migration).

### Timeline finding — the CORS hardening has never reached production

- Hardened `_shared/secureHeaders.ts` was authored in `9f3d20a`, **2026-08-24 11:53 UTC**
  (*"G9: CORS refuses unknown origins…"*). It exists only on `staging`.
- Staging's function was deployed **13:30:40 UTC** — after that — and bundles the hardened file.
- Production's function was deployed **15:00:42 UTC** — also after — yet bundles the **old
  prefix-matching** implementation, because it was deployed from `gift-credit-user-lookup`,
  which is based on old `main` and carries blob `0fcaef13`.
- Across all **71** production edge functions, the next most recent deployment is
  **2026-08-20 11:03:32 UTC** (`media-register-upload`). Every other function predates the
  hardening.

**Therefore no production edge function carries the hardened CORS implementation.** This is
established from deployment timestamps plus the authoring commit date; the sources of the other
70 functions were not individually read.

### Smallest controlled change (prepared as a plan, not written)

Take **only** `supabase/functions/send-gift-credit/index.ts` (blob `4c704d83…`) onto the
candidate tree. Do **not** take `_shared/secureHeaders.ts` from that branch — the branch copy is
the old implementation and the candidate tree already carries the hardened one. Do not merge the
branch: it is based on `32930e7` and its diff against current `main` deletes every migration
merged since.

---

## 4. D2 — ACL reconciliation, and a defect in my own control

Grouping every public function by exact ACL, both lanes, this run:

| Staging pattern | n |
|---|---|
| `=X/postgres, postgres=X, anon=X, authenticated=X, service_role=X` | **222** |
| `postgres=X, anon=X, authenticated=X, service_role=X` | 134 |
| `=X/supabase_admin, supabase_admin=X, postgres=X, anon=X, authenticated=X, service_role=X` | 24 |
| `postgres=X, authenticated=X, service_role=X` | 3 |
| `postgres=X, service_role=X` | 3 |
| `postgres=X, anon=X, authenticated=X, service_role=X, supabase_auth_admin=X` | 1 |

Production shows 12 distinct patterns, including **54** functions at `postgres=X,
service_role=X` only and **24** with a NULL `proacl`.

| Measure | Production | Staging |
|---|---|---|
| explicit-ACL functions denying `anon` | 82 | 6 → **delta 76** |
| explicit-ACL functions denying `authenticated` | 55 | 3 → **delta 52** |
| EXECUTE to PUBLIC | 222 explicit + 24 implicit = **246** | 246 explicit + 0 = **246** |
| NULL `proacl` | 24 | 0 |

### ⚠ The prepared remediation was defective and has been replaced

A leading `=X/…` aclitem is a grant to **PUBLIC**, and PUBLIC includes `anon`. Revision 1 of
`GENERATE_staging_acl_remediation.sql` emitted only `revoke … from anon` / `… from
authenticated`, which **removes nothing** on any function that also carries a PUBLIC grant —
and 246 staging functions do. Revision 1 would have produced a remediation that looked applied,
changed the effective privilege of only a subset, and still failed to converge the fingerprints.

**Revision 2** (md5 `2e92762d923cdf38ff69f8bd80544bd0`) abandons incremental patching: for every
function with an explicit ACL it revokes ALL from PUBLIC, anon, authenticated and service_role,
then re-grants exactly the roles production holds. `postgres` and `supabase_admin` entries are
left alone as ownership/platform grants. It is generated from live production at the moment of
use, so it cannot go stale.

Because production keeps 24 NULL-`proacl` extension functions and staging keeps explicit ones,
the two full ACL fingerprints will **not** become byte-equal. The correct post-remediation
assertion is the **explicit-ACL** fingerprint, and the file carries both that query and an
aclitem-ordering caveat.

### Root cause

**MEASURED:** both lanes carry the stock Supabase rule
`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated,
service_role`; staging additionally carries a duplicate rule from grantor `supabase_admin`.
The repository documents this in `PHASE_0_DESIGN_REVIEW.md:26`. So staging does not have extra
grants — **production accumulated ~76 explicit REVOKEs through its hardening migrations that
staging never received**, staging's project having been created 2026-08-21 with a ledger
beginning 2026-08-24.

**NEED EVIDENCE:** how staging's schema was seeded. `harness/cg2/01_schema_seed.sql:992`
contains `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;` and sits on
both branches, but no artefact shows it was ever run against the staging project. Candidate,
not cause.

---

## 5. Schema guard

**Harness executed this run: `41/41 cases passed, 0 failed`, exit 0.** That covers planted
missing RPC, renamed parameter, overload mismatch, omitted required parameter, unreadable
argument object, spread, computed key, dynamic RPC name, empty inventory, empty catalog, absent
credential, tampered catalog, coverage printed on both PASS and FAIL, and the fake-catalog
self-announcement.

**The guard-vs-target run is BLOCKED.** Running it needs either database egress from the runner
(`SUPABASE_DB_URL` from the target Environment) or the out-of-band catalog path with a digest
the database itself computed. This session has neither, and hand-transcribing a 387-row catalog
would defeat the integrity check the path exists to provide. The 103 RPC names / 120 call sites
figures in earlier records belong to tree `3515b9a6…` and are **VOID** for the candidate tree.
This is precisely what `.github/workflows/verify-schema-dependencies.yml` exists to run once it
is committed.

---

## 6. Certificate rollbacks — corrected

All three forward migrations re-verified: repository file, both stored ledger statements and
live objects agree; `certificates` = 18 columns and the constraint/index/trigger fingerprints
are identical across lanes.

Corrections made to the prepared rollbacks this run:

1. **Heading rollback** — added an explicit
   `drop constraint if exists certificates_heading_only_for_custom` as a new step 2. The
   constraint's `conkey` covers `(type, heading)`, so `DROP COLUMN` removed it implicitly; a
   rollback relying on an implicit side effect is not readable. Idempotent either way.
2. **All three** — re-measured baselines appended, with the 2026-08-25 figures retained
   unaltered as evidence of that date.
3. **All three** — dependency-impact sections added, naming which application screens break and
   confirming that no production edge function calls `admin_list_certificates`,
   `admin_search_certificate_recipients` or `cleanup_certificate_references`.
4. The `…120000` orphan-count contradiction is recorded in the file as **NEED EVIDENCE** and
   deliberately left unresolved.
