# Addendum A — phase-wise status, measured 2026-09-03

Measured from `origin`, not from anyone's report. `main` = `9c91eeb`, `staging` = `82a5374`.

---

## The one-line answer

**Phase 0 is 6 of 7 deliverables merged and is NOT closed. Phases 1–7 have not started — all 35 gate rows still read `NOT STARTED`.** Everything a member can see that changed today (Authorized Signatory, the 30-day Top Contributors card, the withdrawn "Preview All Types" button) was **Owner-directed work outside the Addendum numbering**, not a phase unit.

---

## Phase 0 · Baseline and instruments — IN PROGRESS

| # | Deliverable | Owner | State | Evidence |
|---|---|---|---|---|
| 0.1 | `scripts/db-baseline.mjs` | D1 | ✅ MERGED | `staging` `f822493` (#129); F-61 fixed, blob `a5d42bf`; 28 subtests pass |
| 0.2 | Addendum re-measurement | D1 | ✅ MERGED | `staging` `48c3d49` (#131); `docs/evidence/d1/baseline/addendum-recheck.md` |
| 0.3 | 1 M-row staging seeder | D1 | ✅ MERGED, gate MET | `staging` `d8aacd0` (#140); production-ref refusal demonstrated in CI run `33721629777` |
| 0.4 | `scripts/web-baseline.mjs` | D2 | ✅ MERGED | `staging` `ca8e989` (#133); F-1 and F-3 corrected |
| 0.5 | Web-Vitals harness, report-only | D2 | ❌ **OPEN — PR #137** | No `d2-web-vitals.yml` and no report script on `staging`. F-67 open. |
| 0-D2-03 | Client inventory | D2 | ✅ MERGED | `staging` `da9d7d2` (#136) |
| 0.6 | Gate Register + kickoff | Auditor | ✅ DONE | `docs/gates/GATE_REGISTER.md`, `phase-0-kickoff.md` |

### Phase 0 exit criteria — 2 of 6 met

| Criterion | State |
|---|---|
| Every unit that claims a number has a timestamped baseline | **PARTIAL** — D1's and D2's instruments landed; the Web-Vitals half is not on `staging` |
| Seeder's production-ref guard demonstrated failing | ✅ **MET** — run `33721629777`, refusal quoted, exit 1 |
| A seeded run's row counts committed | ❌ **BLOCKED on H-4** — the instrument has never reached a database |
| Web-Vitals harness runs on every PR and blocks nothing | ❌ **NOT MET** — 0.5 unlanded; its first CI run (`33746276312`) tripped the F-2 guard correctly (0 samples, Chromium absent at a hard-coded path — **F-67**). D2's fix `bb9e17a3` is authored and courier-limited. |
| Register carries a baseline evidence path for all 35 rows | ✅ **MET** |
| H-4 and H-5 settled by the Owner | ❌ **NEITHER** |

**Consequence: Phase 1 cannot open.** Its entry conditions name H-4 and H-5 explicitly, and neither has moved. H-4 is not a missing secret — it was *tested and failed*: right project `ztzutckwdhetphwghuzj`, wrong password (`FATAL: password authentication failed for user "postgres"`, run `33617572635`).

---

## Phases 1–7 · NOT STARTED

Not "in progress with nothing to show" — **not opened**. Measured:

- All 35 unit rows in the Gate Register read `NOT STARTED`.
- `docs/gates/phase-1-kickoff.md` — **absent**.
- `docs/gates/P1-revocation-list.md` (task 1-AU-02, the frozen list D1 must wait for) — **absent**.
- `docs/evidence/` holds only `d1/baseline`, `d1/tc-v3`, `d2/baseline`, `d2/tc-v3`. No `P1`…`P35` directory exists.

| Phase | Units | State |
|---|---|---|
| 1 · Close the front door | P30 P31 P32 P33 | NOT STARTED — blocked on H-4, H-5, and D2's call-site inventory |
| 2 · Stop the machine talking to itself | P1 P2 P10 | NOT STARTED — needs Phase 1 closed; carries a real seven-day window |
| 3 · Make live features live | P3 P4 P5 P7 P9 | NOT STARTED |
| 4 · Clear out the filing room | P6 P8 P26 P27 P28 P34 P35 | NOT STARTED — P34 also blocked on H-2 (X1/X2) |
| 5 · The part members feel | P11–P18, P21–P24 | NOT STARTED |
| 6 · Certificates, made properly | P25 | NOT STARTED |
| 7 · Prove it at real size | P19 P20 P29 | NOT STARTED — needs the seeder to have actually run |

**Phase 1 method has already been amended before it starts,** which is worth more than it looks: **F-62** (a `REVOKE … FROM anon` is a no-op on 246 of 305 anon-executable functions, because `PUBLIC` holds the grant), **F-64** (a closed function reopens on `DROP`+`CREATE`), and **F-66** (the `ALTER DEFAULT PRIVILEGES` rule *adds to* rather than replaces the built-in `PUBLIC` default, so the trap refills itself). Without those three, P30–P33 would have landed green and closed nothing.

---

## Off-plan work completed today — real, but not Addendum units

| Item | State |
|---|---|
| OWNER-01 · "Authorized Signature" → "Authorized Signatory" | ✅ live on `main` (SIGNATORY 2, SIGNATURE 0) |
| OWNER-RULING-2026-09-03-03 · "Preview All Types" withdrawn | ✅ live on `main` (0 occurrences in the production bundle) |
| TC-v3 · 30-day Top Contributors card (Option B) | ✅ live on `main`; `get_top_contributors_v3` applied to **both** databases; production returns 3 rows; `PUBLIC` denied |
| Android Build #119 | ✅ SUCCESS — `app-release-aab` 8.48 MB, sha256 `01d29918…` |
| F-52 / F-60 · typecheck script and its guard | ✅ landed (#144) |
| F-69 · build trigger paths | ✅ recorded and used (#145) |
| F-70 · versionName reuse | ⚠️ fix on `staging` `82a5374`, **not promoted** |

---

## F-71 — NEW FINDING: the TC-v3 function is live on both databases and its migration is in neither branch

```
git cat-file -e origin/staging:supabase/migrations/20260903090000_top_contributors_v3.sql  -> does not exist
git cat-file -e origin/main:supabase/migrations/20260903090000_top_contributors_v3.sql     -> does not exist
```

`supabase/migrations/` holds 636 files; the newest Top-Contributors migration in it is
`20260811160000_top_contributors_v2.sql`. Meanwhile `get_top_contributors_v3()` exists and is
`anon`-executable on **production** (verified from `pg_proc` after the apply) and on **staging**.

**Three consequences, in order of seriousness.**

1. **The schema is not in version control.** A lane rebuilt from `supabase/migrations/**` comes up without v3 and the Home card breaks. Nothing in CI would notice.
2. **D3's prepared fail-first test asserts that exact path** (`read("supabase/migrations/20260903090000_top_contributors_v3.sql")`). The moment it moves into `src/__tests__/` it throws `ENOENT` — and it fails as though the *rollback rule* were broken, which is the wrong reason. D3's own ⚠ note in that file says the filename was Auditor-attested and never verified against the repository. **The note was right and the file is still missing.**
3. It happened because the apply route and the commit route are different: `apply_migration` is classifier-refused (H-6), so the SQL travelled to the databases through the SQL editor by hand, while `supabase/**` uploads are also courier-refused (D-21). Both halves failed independently, and because the *function works*, nothing complained.

**Owner action:** D1 lands `20260903090000_top_contributors_v3.sql` and its rollback into `supabase/migrations/` from a session with push authority. The bytes are known and blob-verified: migration `7c994d544a46d3a89d3b94d76652fe0b4770b627`, rollback `4c97d125`.

---

## What is actually blocking the plan, ranked

| # | Blocker | Who releases it | What it stops |
|---|---|---|---|
| 1 | **H-4** — staging DB password wrong | Owner | Phase 1 entry; the seeder run; every D1 measurement |
| 2 | **H-5** — no required reviewer on the production Environment | Owner | Phase 1 entry |
| 3 | **No push authority in any session** | Owner | 0.5 (#137), F-67, F-71's migration, P10/P11 units, D3's tests |
| 4 | **H-6** — DDL apply refused by the session classifier | Owner (approval mode) | every future migration |
| 5 | `auth.users` seeding ruling | Owner | P34's scale clause, Phase 7 |

Items 1–3 are one conversation with the Owner, not weeks of engineering. **Nothing in Phases 1–7 can be honestly closed until they move**, and no amount of developer time substitutes for them.

*Auditor · 2026-09-03. Measured from origin at `main` `9c91eeb` / `staging` `82a5374`.*
