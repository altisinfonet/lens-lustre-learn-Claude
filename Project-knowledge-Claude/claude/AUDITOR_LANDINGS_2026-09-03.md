# Auditor landings — 2026-09-03

## THE PROMOTION LANDED. `main` = `8ef3cf0` ("Staging (#142)")

Measured from origin immediately after the merge:

| Check | Result | Class |
|---|---|---|
| `AUTHORIZED SIGNATORY` in `src/lib/generateCertificatePdf.ts` on `main` | 2 | VERIFIED |
| `AUTHORIZED SIGNATURE` (superseded wording) on `main` | **0** | VERIFIED |
| `recent_score` in `src/hooks/useTopContributors.ts` on `main` | 5 | VERIFIED |
| `Preview All Types` in `src/pages/Certificates.tsx` on `main` | **0** | VERIFIED |
| `git diff --name-only origin/main origin/staging` | **0 files** | VERIFIED — Standing Rule 20 satisfied **on content** |
| `git rev-list --left-right --count origin/main...origin/staging` | `1  91` | expected squash artefact, not a content divergence (see F-50/F-55) |

`Web build #417` (main) green in 1m01s. `Android Build #118` running on `8ef3cf0` — the new app build from main that the Owner asked for.

---

## Order of landings this session

| # | What | Commit |
|---|---|---|
| 1 | D3 — TC-v3 client half, Home card shows the 30-day score (Option B) (#143) | `4d3a4bb` (staging) |
| 2 | D1 — F-66 evidence, `ALTER DEFAULT PRIVILEGES` makes the F-62 trap self-replenishing (#141) | `1632685` (staging) |
| 3 | Auditor — conflict resolution of `main` into `staging` for the promotion | `cd715eb` (staging) |
| 4 | **Promotion `staging` → `main` (#142)** | **`8ef3cf0` (main)** |

---

## C-55 — how the four promotion conflicts were resolved, and why the resolution is provable

The promotion had four add/add or content conflicts: `docs/PROMOTION_LEDGER.md`, `docs/gates/GATE_REGISTER.md`,
`src/__tests__/certificatePalette.test.ts`, `src/lib/generateCertificatePdf.ts`.

**The ruling was: take the `staging` side on every hunk.** That is not a preference, it is a measured fact.
A local trial merge (`git merge origin/staging` onto `origin/main`) resolved with `--theirs` on all four produced a
tree with **zero diff against `origin/staging`** — so `main`'s 21 "ahead" commits contribute no unique content and
nothing was discarded by taking staging.

Every one of the three source hunks was the same single edit: `AUTHORIZED SIGNATURE` → `AUTHORIZED SIGNATORY`.

### The decoy-marker trap, and the parser rule that survives it (N-9)

`docs/PROMOTION_LEDGER.md` on `main` still carries the **un-indented** five-line conflict-marker EXAMPLE inside a
code fence (`78fed3a` indented it, but that commit only ever existed on `staging`). GitHub's web conflict editor
therefore presented a region containing three column-0 decoy lines:

```
397: <<<<<<< staging (Current change)      ← taken
399: =======
401: >>>>>>> main (Incoming change)        ← discarded
```

alongside the two real markers at 377/395/402.

**N-9 — the rule.** A conflict-marker parser must match the open and close markers by **exact string equality**
(`<<<<<<< staging`, `>>>>>>> main`), never by prefix. The decoys carry trailing text and so cannot be mistaken for
real markers. The `=======` separator is genuinely ambiguous — a decoy `=======` is byte-identical to a real one —
so the separator must be taken as the **first** one inside the region when the kept side is known to be
marker-free, and the transform must then be **verified against the known-good file**, not trusted.

### The verification (this is the part that makes the resolution evidence, not a claim)

For each of the four files, after transforming the editor's text in place, the resulting string was hashed in the
page (FNV-1a over UTF-16 code units) and compared with the same hash computed in the container over
`git show origin/staging:<path>`:

| File | UTF-16 units | FNV-1a | Match |
|---|---|---|---|
| `docs/PROMOTION_LEDGER.md` | 267403 | `24e17008` | ✅ |
| `docs/gates/GATE_REGISTER.md` | 59334 | `9619c9fa` | ✅ |
| `src/__tests__/certificatePalette.test.ts` | 5966 | `0e7d205a` | ✅ |
| `src/lib/generateCertificatePdf.ts` | 29665 | `dd262585` | ✅ |

**C-56 — a length mismatch that was a measurement bug, not a content bug.** The first comparison read 267403
(browser) against 267368 (container) and looked like 35 characters of lost content. It was not: JavaScript
`String.length` counts UTF-16 code units and Python `len()` counts code points, and the ledger contains exactly
**35 astral-plane characters** (🔴 ×31, 📕 ×2, 🆕 ×2). Re-hashing over UTF-16 units reconciled both sides exactly.
**Standing discipline: before reporting a diff, prove the two measurements are of the same thing.**

**Post-hoc confirmation.** `git diff --stat 1632685 origin/staging` after `cd715eb` is **empty** — the merge commit
changed no staging content, which is the only correct outcome for a take-staging resolution.

---

## H-7 (NEW, OWNER ACTION REQUIRED) — production Top Contributors is code-live but function-absent

`main` now calls `get_top_contributors_v3`. Measured on production `jtdtehuqtinjxropkkcn`
(cluster `7656985631720456337`), read-only, at the time of the promotion:

```
v3_present = false   v2_present = true   helper_present = true
```

So the Home page Top Contributors card on www.50mmretina.com will render empty until D1's production pack
(`claude/d1-phase0/tc-v3/v3_PRODUCTION_paste.sql`) is applied. Nothing else on the site is affected: the
certificate wording and the withdrawn "Preview All Types" button need no database change.

**The Auditor cannot apply it.** Both `mcp__Supabase__apply_migration` (×4 today) and `mcp__Supabase__execute_sql`
against the production ref are refused by the session's auto-approve classifier. This is the same barrier recorded
as **H-6**, now demonstrated on the read/write tool as well as the migration tool. It is not a repository or gate
problem and no check was disabled; it is an approval-mode property of the session.

**Two accepted routes, both owner-side:** (a) leave auto-accept mode so the refusal becomes a one-key approval and
the Auditor applies it; or (b) the Owner pastes the delivered file into the production SQL editor. The delivered
file begins `DO $lane$` — no leading `--` — because the editor previously swallowed a leading comment line and
produced `ERROR: 42601 syntax error at or near "-"`; and it carries a cluster-fingerprint lane guard so a paste
into the staging project refuses and applies nothing.

**Rollback if needed:** revert the Home card to `get_top_contributors_v2` — a client-only change. Do **not** run
D1's rollback SQL first; client first, database second (D1's own ordering note).

---

## Ruling on D2's blocking question (P31)

D2 asked for one of two things: courier D1's `5689cfb` client half, or an instruction to write it fresh.

**Measured:** `5689cfb` is not reachable on origin (`git cat-file -t` → *Not a valid object name*), and the client
half **has already landed** from D3 as `4d3a4bb`, covering `useTopContributors.ts`, `Index.tsx`,
`SidebarTopContributors.tsx` and `ContributorScore.tsx`, all four blob-verified and now on `main`.

**Ruling (OWNER-RULING-2026-09-03-04, Auditor-issued under the TC-v3 freeze):** D1's P31 client half is
**superseded, not adopted**. D2 must not re-write it and must not wait for it. D2's remaining TC-v3 obligation is
its own prepared fail-first test — moved from `docs/evidence/d2/tc-v3/topContributorsV3.home.test.ts.prepared`
into `src/__tests__/`, shown failing against the pre-`4d3a4bb` component per C-34, then passing. That unit sits in
the courier-limited batch until a push-authorised session exists.

---

## Still courier-limited (no push authority in any session)

F-58 (Node pin + typecheck workflow), F-60 (typecheck assertion), F-67 (`d2-web-vitals.yml` Chromium path),
P10 timer-discipline test, P11 img loading/decoding rule, and D3's three `src/__tests__/` files with the C-34
transcript. Uploads into `.github/workflows/**`, `src/__tests__/**` and `supabase/**` are all classifier-refused
from this session.

## Open owner items, unchanged

H-4 (staging `SUPABASE_DB_URL` password), H-5 (production Environment reviewer), F-59 acknowledgement, push
authority per session, the `auth.users` seeding ruling.
