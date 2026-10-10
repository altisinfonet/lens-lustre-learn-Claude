# PR #101 — independent verification of what actually shipped, and the §17-9 rollback target (2026-08-25)

Production was not modified by this session. Every statement here is a read or a local test run.

---

## 1. What shipped

```
main   b671e1fb0c5bcf145d442076c229eca888afd674
       tree db8df5679ab812be4f0ba9a3284df7dc2f02c3e1
PR     #101 — "PRODUCTION — certificates: 16 types, live preview, editable Custom heading,
                delete unbroken; admin user list paged"
15 files changed, 2892 insertions, 304 deletions
```

The promotion was made by another session while this one was auditing. It went out **without**
a §12.4 freeze, without an `approved/*` tag, without a §10 RC record and without the §5.3
re-test. Those procedural gaps are real and are recorded in §4 below. The **content**, however,
verifies clean, and that is worth stating with the same precision.

## 2. Verification of the shipped tree — executed, not inspected

Run against `db8df567…` extracted from `origin/main`, reusing the repository's installed
dependencies.

| Check | Command | Result | Status |
|---|---|---|---|
| Typecheck | `npx tsc -p tsconfig.app.json --noEmit` | **exit 0** | VERIFIED |
| Test suite | `npx vitest run` | **167 files passed, 1 skipped · 2345 tests passed, 0 failed** | VERIFIED |
| Schema-guard coverage | revision 3 guard | 105 RPC names · 122 call sites · **122 argument-compatible checks · 0 name-only** | VERIFIED |
| Every RPC vs **live production** | server-side check against `pg_proc` on `jtdtehuqtinjxropkkcn` | **0 MISSING · 0 INCOMPATIBLE** across all 105 | VERIFIED |

The three RPCs that were new to production, checked at argument level:

| RPC | Application sends | Production declares | Verdict |
|---|---|---|---|
| `admin_list_certificates` | `_limit,_offset,_query,_type` | `_query,_type,_limit,_offset` (required 0) | OK |
| `admin_search_certificate_recipients` | `_limit,_query` | `_query,_limit` (required 1) | OK |
| `admin_search_users_v2` | `_badge,_by,_limit,_offset,_query,_role` | `_query,_by,_role,_badge,_limit,_offset` (required 0) | OK |

**Expand-then-deploy held.** Production reached migration `20260825115208` *before* the code
merged, so no call in the shipped bundle could 404 on arrival. That ordering is the single
thing G10 exists to enforce, and it was followed.

## 3. A defect that was caught and fixed before it shipped — recorded because it nearly didn't

At an earlier tip of the promotion branch (`bbae1f7`, tree `b11f7563…`) this session ran the
same checks and found:

```
tsc     exit 0
vitest  2 files failed | 165 passed · 7 tests failed | 2311 passed
```

Cause: the branch was assembled with GitHub's "Add files via upload" rather than merged from
`staging`, and **five files staging had changed were left behind**:

```
src/pages/Certificates.tsx
src/integrations/supabase/types.ts
supabase/migrations/UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql
supabase/migrations/UNAPPLIED_20260825120000_certificate_delete_removes_notifications.sql
supabase/migrations/UNAPPLIED_20260825170000_certificate_custom_heading.sql
```

One failure was a genuine user-facing regression, not a test artefact:

> `member download drops the description: expected … to match /description: cert.description/`

`Certificates.tsx` was the old version, so a member downloading their certificate would have
lost the description. The other six failed with `the certificate_types_and_admin_search
migration is missing`.

The branch advanced to `736e652` with all five files restored before the merge, and the tree
that actually shipped is the clean one. **The lesson is the assembly method:** a file-by-file
upload produces a tree nobody built or tested, and only a full run on that exact tree catches
what it dropped. — VERIFIED (both the failure and its resolution were measured).

## 4. §17-9 — rollback target, identified and verified

```
Rollback target   tree   a0c3f34d724867f0a10fc768f6987e21fd4ddbfa
                  commit 32930e75b1d87d361f44e4b4f90dabf9deeda3e1
```

§17-9 requires the target be *"named by tree, and its verification evidence on file"* — the
target itself verified, not merely named. Evidence:

The entire delta from that tree to `main` at the time of RC-1 was **two `.sql` files and
nothing else**:

```
git diff --name-only 32930e75..origin/main
  supabase/migrations/UNAPPLIED_20260824000000_admin_user_list_pagination.sql
  supabase/rollback/UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql
```

Every build input was byte-identical:

| Path | `32930e75` vs `main` |
|---|---|
| `src/` | **IDENTICAL** — both `89aeae863e6da1be240b383af63d0906d45b5851` |
| `package.json` · `package-lock.json` · `vite.config.ts` · `index.html` | IDENTICAL |
| `public/` · `scripts/` · `functions/` | IDENTICAL |

So rolling `main` back to that tree changes **no application file**; the only difference is SQL
that never reaches the build. That is what makes it a safe target, and it answers hard stop
**HS-8** (*"a rollback target has not itself been verified"*) with evidence rather than
assertion. — VERIFIED.

**Still outstanding on this line:** the Cloudflare **deployment ID** for that tree. Pages is
not readable from this session (the Cloudflare connector exposes R2/KV/D1/Workers only), so it
must be read from the Pages dashboard and recorded before §12.4 step 2 is complete.
— BLOCKED, capability unavailable.

## 5. Still open after this release

| Item | State |
|---|---|
| Rollback files for the 3 certificate migrations | **absent from `main`** — written this session, not committed. §13.1 requires them. |
| Schema-dependency guard | **not committed.** It caught §3 by hand; until it is a required check it catches nothing automatically. |
| §5.3 secret-isolation re-test | never executed |
| §10 RC record for PR #101 | does not exist |
| CI run IDs / job-level results for the shipped tree | not captured |
| Cloudflare deployment ID for the rollback target | not readable from this session |

Branch protection (`protect-main`, Active, PR required, empty bypass list) is OWNER-ATTESTED as
of 2026-08-25, so **HS-12 is closed**. Re-attestation is required on promotion day (§17 preamble).
