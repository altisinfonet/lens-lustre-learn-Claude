# REV-17 — PREPARED CORRECTION SET · **NOT COMMITTED, NOT APPLIED**

**Status: PREPARED FOR OWNER RULING.** Nothing here has been written to
`docs/PROMOTION_LEDGER.md`. The ledger is untouched — sha256
`f00f612a057477146f4047f5af9235337f857d31887bb10e5bb56c98a9cd5943`, 182,502 bytes, unchanged.
**Nothing in this correction set closes a §25 row.**

These are **material facts about the release**, which §28 permits committing. **The owner rules on
whether to commit; the compiler does not.** Every prior value is **preserved and struck through**,
never replaced.

---

## ⚠ C-12 — THE DRAFTED PREMISE IS FALSE. CORRECTED VERSION BELOW.

**WO-4 drafted C-12 as:** *"§3.2/§5.0 commit counts. Recorded 45/43 as `main…a42b209e`; measured
39/37."*

**The ledger does not record that.** Measured against the live document:

- **§3.2 (a) is headed "Application scope — `main…a42b209e`" and records NO commit count at all.**
  Its four figures — 138 files, 2 docs, 136 non-docs, +9,060/−1,293 — are **all correct today**,
  re-measured this run.
- **§3.2 (b) is headed "Total promotion scope — `main…fe63e944`"** and records 45/43 commits and
  +9,494/−1,293. **Both are exactly correct for `fe63e944`**, measured:
  `main..fe63e944` = **45 / 43** commits, **+9,494 / −1,293**. `fe63e944` is REV-12.

So §3.2 is **not** mislabelled, and 45/43 was **never** attributed to `main…a42b209e` in the ledger.
Writing C-12 as drafted would introduce a false correction into a document whose whole purpose is
that corrections can be trusted. It is not written.

**Where the drafted error is real:** in **`facts_rev16.json`**, not the ledger. See C-17.

**My own W3-1 also needs correcting** and is corrected here: I described the 45/43 figure as a
label defect of the `main…staging`-on-staging class. For §3.2(b) that was wrong — it carries a
frozen endpoint label, which is exactly what `POST_PROMOTION_PLAN` C1 prescribes. The label defect
is real only in §5.0.

### C-12 (corrected) — §5.0's counts are labelled `main…staging` and are stale; §3.2 is sound

**Proposed diff — §5.0, the table at lines ~420–432:**

```diff
 | Metric | Value | Basis |
 |---|---|---|
 | **Files changed, `main…staging`** | **138** — **31 added · 107 modified · 0 deleted** | `compare/main...staging.diff`, compiler |
-| Lines, total | **+9,680 / −1,293** | same |
-| Commits ahead of `main` | **46 counting merges · 44 excluding** | PR #104 Commits tab · `compare/main...staging.patch` |
+| Lines, total | ~~**+9,680 / −1,293**~~ **superseded — see below** | ~~same~~ |
+| Commits ahead of `main` | ~~**46 counting merges · 44 excluding**~~ **superseded — see below** | ~~PR #104 Commits tab · `compare/main...staging.patch`~~ |
+|  |  |  |
+| **C-12 · Lines, `main…staging`, AS AT REV-13 (`393bc55`)** | **+9,680 / −1,293** — correct for that endpoint, **stale as a `main…staging` figure** | `git diff --numstat b671e1fb...393bc55`, compiler, 2026-08-30 |
+| **C-12 · Commits, `main…staging`, AS AT REV-13 (`393bc55`)** | **46 counting merges · 44 excluding** — correct for that endpoint, **stale as a `main…staging` figure** | `git rev-list --count b671e1fb..393bc55`, compiler, 2026-08-30 |
+| **C-12 · Lines, `main…staging`, MEASURED 2026-08-30 at `9ac4524` (REV-16)** | **+10,159 / −1,293** | `git diff --numstat b671e1fb...origin/staging`, live repo, compiler, 2026-08-30 |
+| **C-12 · Commits, `main…staging`, MEASURED 2026-08-30 at `9ac4524` (REV-16)** | **49 counting merges · 47 excluding** | `git rev-list --count b671e1fb..origin/staging`, live repo, compiler, 2026-08-30 |
+| **C-12 · Commits, `main…a42b209e` (application scope) — NEWLY RECORDED, never previously stated** | **39 counting merges · 37 excluding** | `git rev-list --count b671e1fb..a42b209e`, live repo, compiler, 2026-08-30 |
```

**Both figures, both endpoints, both instants — the full series, measured this run:**

| staging HEAD | Revision | Commits (with / without merges) | Lines |
|---|---|---|---|
| `a42b209e` | code RC | **39 / 37** | +9,060 / −1,293 |
| `d06b037` | REV-7 | 40 / 38 | +9,099 / −1,293 |
| `a39d135` | REV-8 | 41 / 39 | +9,221 / −1,293 |
| `d93c2b8` | REV-9 | 42 / 40 | +9,267 / −1,293 |
| `a87538a` | REV-10 | 43 / 41 | +9,284 / −1,293 |
| `47f0f84` | REV-11 | 44 / 42 | +9,367 / −1,293 |
| **`fe63e94`** | **REV-12** | **45 / 43** ← §3.2(b)'s figure, correct | **+9,494 / −1,293** ← §3.2(b)'s figure, correct |
| **`393bc55`** | **REV-13** | **46 / 44** ← §5.0's figure, correct for REV-13 | **+9,680 / −1,293** ← §5.0's figure |
| `daaf4c1` | REV-14 | 47 / 45 | +9,906 / −1,293 |
| `de518c6` | REV-15 | 48 / 46 | +10,035 / −1,293 |
| `9ac4524` | REV-16 | **49 / 47** ← today | **+10,159 / −1,293** ← today |

**File count is stable at 138 across every endpoint**, because the only path changing after
`a42b209e` is `docs/PROMOTION_LEDGER.md`, which is already one of the 138.

**On PR #104's description.** §3.2(b)'s instrument column cites *"GitHub PR #104 'Commits' tab = 45"*,
and §5 row 2 records *"PR #104 head = staging HEAD ... `fe63e944` = `fe63e944`"*. **At the instant
those were taken, both were correct** — PR #104's head was `fe63e944`, for which 45/43 is the true
count. PR #104's head has since advanced with REV-13…REV-16, so **any figure in the PR description
sourced from that tab now reads 49/47**. Whether the PR body was edited is **not measurable from a
read-only clone** — the PR description is GitHub API state, not repository content. **Recorded as
UNVERIFIED, for the owner to check in the PR UI**, not asserted either way.

---

## C-13 — B13's basis has changed for one function, and NOT for the other two

**Measured against the frozen RC `a42b209e`** (classification by hash-verified
`07_ws4_reference_impl.py`, after `10_verify_pack.sh` PASS=30 FAIL=0 and mutation control
UNDETECTED=0):

```diff
+### C-13 · B13 finding 1 — re-measured against `a42b209e`, 2026-08-30
+
+| Function | vs `702e5ce` | vs `a42b209e` | Still true of the frozen RC? |
+|---|---|---|---|
+| `send-gift-credit` | DRIFT | **HEADER-ONLY** | **NO — no longer true** |
+| `analyze-gallery-image` | DRIFT | **DRIFT** | **YES** |
+| `detect-ai-image` | DRIFT | **DRIFT** | **YES** |
```

**`send-gift-credit` — B13 finding 1 is no longer true of this function against the frozen RC.**
The indexed-RPC lookup `admin_lookup_user_id_by_email`, which replaced a `listUsers()` + in-JS
`find()` scan, **is present in `a42b209e`** (2 occurrences) and **absent from `702e5ce`** (0). Against
`a42b209e` the function classifies **HEADER-ONLY** — the only differing path is
`_shared/secureHeaders.ts`. Production is **not** ahead of the frozen RC here.

**What remains true, stated specifically against `a42b209e`:**

- **`analyze-gallery-image` — still DRIFT.** Differing path: `analyze-gallery-image/index.ts`.
  Production resolves `IMAGE_ANALYSIS_AI_KEY ?? AI_API_KEY ?? LOVABLE_API_KEY`; **the frozen RC
  resolves only `AI_API_KEY ?? LOVABLE_API_KEY`** (line 58). The per-function key — and with it that
  function's own credit limit and usage tracking — **exists in production and not in the RC**.
- **`detect-ai-image` — still DRIFT.** Differing path: `detect-ai-image/index.ts`. Production
  resolves `AI_DETECTION_AI_KEY ?? AI_API_KEY ?? LOVABLE_API_KEY`; **the frozen RC resolves only
  `AI_API_KEY ?? LOVABLE_API_KEY`** (line 52).

**Consequence, and its bound — read both sentences together.** Deploying `a42b209e` over production
would **remove the per-function API-key indirection from both functions**, collapsing them onto the
shared `AI_API_KEY`. That is a behavioural regression, and it is the live residue of B13 finding 1.

> ⚠ **THIS IS NOT A BLOCKER ON THIS PROMOTION, AND MUST NOT BE READ AS ONE.**
> **B13 condition 2 excludes all function deployment from this release.** Merging PR #104 moves
> repository state; it **deploys no edge function**, alters neither lane's deployed inventory, and
> changes nothing about the 71 or the 74. The regression described above is a risk of the **future
> G9 deploy** — a separately gated action outside this release — not of this promotion. Carry it
> into the G9 deploy plan, not into the merge decision.

*(Bounded to match C-15, per WO-5 C. The same bound applies to every deploy-consequence statement in
this correction set.)*

**DIRECTION** is **not** claimed for either. §4.6 permits it only on a digest match to an
attributable revision or on deployment metadata naming a SHA; neither was established.
**DIRECTION = UNKNOWN.**

---

## C-14 — `s3.ts`: none of production's four deployed variants exists in the tree

**Sharpens B13 finding 2. Does not replace it.**

```diff
+### C-14 · `_shared/s3.ts` — deployed variants absent from the source tree
+
+The repository holds **ONE** copy: `supabase/functions/_shared/s3.ts`,
+sha256 `cb6dd4ae8d13…`, **15,400 bytes**, at `a42b209e`.
+
+Production deploys **FOUR mutually-different variants, and NOT ONE of them is that file:**
+
+| Deployed variant | Bytes | Carried by |
+|---|---|---|
+| `11aa68448f00…` | 7,590 | **`purge-s3-orphans`** — destructive path |
+| `f313511204f1…` | 7,777 | `media-register-upload` |
+| `fd1f863616db…` | 9,143 | `backfill-image-dims` |
+| `42044002f8a0…` | 9,980 | **`detect-orphan-files`** — destructive path |
+
+**The two destructive-path functions are `purge-s3-orphans` and `detect-orphan-files`.** Both
+run storage-access code that does not exist anywhere in the source tree, and their two copies
+differ from each other by 2,390 bytes.
+
+Cause, now DETERMINED (was UNDETERMINED at C-1): the repository holds one copy of each shared
+module, so these are **accumulated deployment drift, not intentional per-function forks** — each
+function carries a snapshot of `_shared/s3.ts` as it stood when that function was last deployed.
+
+`_shared/imageDims.ts` shows the same pattern: repo holds one copy (`29499a56d639…`, 5,156 B);
+production deploys four variants, of which exactly one (`backfill-image-dims`) matches the tree.
```

**Why this sharpens rather than replaces B13 finding 2:** finding 2 concerns shared-module
divergence. The new fact is its *direction and reach* — the divergence is not merely between
functions, it is between **every deployed copy and the source of truth**. A fix landed in
`_shared/s3.ts` today reaches **zero** of the four deployed functions until each is redeployed.

---

## C-15 — "promotion fixes CORS" is FALSE as a general claim

```diff
+### C-15 · CORS mechanism census — the frozen RC does not satisfy B13's residual-risk description
+
+B13's accepted residual risk reads: *"Pre-G9 CORS in production — ALL 71 functions … deployed
+`secureHeaders.ts` byte-identical across every function that bundles it."* Quoted as B13's
+wording. NOT restated as measurement.
+
+Measured 2026-08-30, all 71 production slugs, both sides:
+
+| CORS mechanism | Production, deployed | **Repo @ `a42b209e`** |
+|---|---|---|
+| Bundles `_shared/secureHeaders.ts` (origin allowlist) | 27 | **28** |
+| **Local `corsHeaders` object — wildcard `*`** | **39** | **38** |
+| Imports `corsHeaders` from `npm:@supabase/supabase-js@2/cors` | 2 | 2 |
+| No CORS handling at all | 3 | 3 |
+| | **71** | **71** |
+
+**Deployed mechanism vs repo mechanism: 70 of 71 agree. Exactly one differs —
+`submit-judge-decision`**, deployed with a local wildcard object, `getSecureHeaders` in the RC.
+
+**Therefore: deploying `a42b209e` changes the CORS mechanism of exactly ONE function.** The other
+38 wildcard functions carry a local wildcard object **in the frozen RC itself** and would remain
+wildcard after promotion.
+
+**"Promotion fixes CORS" is FALSE as a general claim.** A remediation reasoned about as "the
+shared helper is correct, so promoting the RC fixes CORS" reaches **1 of 39**.
+
+What B13's inner clause DOES hold: `secureHeaders.ts` is byte-identical across all 27 deployed
+functions that bundle it (one variant, 1,507 B), and all 27 pass a request, so the helper's `"*"`
+no-argument default is never exercised. The clause is true as written; it is scoped to "every
+function that bundles it" (27) while the risk headline is scoped to "ALL 71".
+
+Bounded: deployed source and repository source only. No endpoint was called; nothing here
+establishes runtime response headers.
```

---

## C-16 — the 2,475-test figure has one invariant unverified

**The test is NOT fixed. That would be a code change, and Track R is not started.**

```diff
+### C-16 · Independent test-suite run, 2026-08-30 — one test BLOCKED, not skipped
+
+Run from a detached checkout at `a42b209e`, dependencies from the committed lockfile, under
+`env -i` with a printed scrub proof: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
+SUPABASE_DB_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, R2_ACCESS_KEY_ID,
+R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, AWS_ACCESS_KEY_ID,
+AWS_SECRET_ACCESS_KEY, GH_TOKEN, GITHUB_TOKEN, CRON_SECRET — all unset, and an environment-wide
+regex sweep returned nothing.
+
+| | |
+|---|---|
+| Test files | 179 |
+| Tests total | 2,476 |
+| Passed | **2,475** |
+| Failed | **0** |
+| **BLOCKED — requires live provider credentials** | **1** |
+
+**The BLOCKED test, named:** `src/test/judging-invariants.test.ts` →
+*"Phase R3 — judging data invariants › judging_invariants_check returns all 'ok'"*.
+Gated by `describe.skipIf(!canRun)` where `canRun = Boolean(URL && SERVICE_KEY)`. With those
+variables it constructs a **service-role** client and calls `judging_invariants_check()` **against
+the live database**. It was NOT run with real credentials: doing so would be a live production
+reach, which this release forbids.
+
+**Consequence for the record: wherever 2,475 passing tests is cited as evidence, ONE judging
+invariant is unverified.** The suite reports it as "1 skipped" inside an all-green summary, so
+nothing in `Tests 2475 passed | 1 skipped` distinguishes "not applicable" from "the one test that
+touches production data did not run".
+
+**NOT FIXED.** Changing the test is a code change under Track R, which is not started.
```

---

## C-17 — NEW: `facts_rev16.json` carried a wrong commit count for the `main…a42b209e` range

This is where WO-4's drafted C-12 error actually lives — and it is real.

```diff
+### C-17 · The guard's attested fact source was circular for one figure, and wrong
+
+`facts_rev16.json` (ledger-guard v3 pack) records, for the range
+`b671e1fb…..a42b209e…`:
+
+    "files": 138, "added": 9060, "deleted": 1293,
+    "commits": 45, "commits_no_merges": 43
+
+**`files`, `added` and `deleted` are correct. `commits` is WRONG: measured `main..a42b209e` is
+39 / 37.** The 45/43 pair belongs to `main…fe63e944`; it was transcribed from the ledger's §3.2(b)
+and attached to the a42b209e range.
+
+**Why no run could catch it.** Under `--facts` the guard compares the ledger against a file whose
+figures were transcribed from that same ledger — circular, so a shared error is invisible. Under
+`--repo` the guard computes live, but **no ledger line claims a commit count for `main…a42b209e`**
+(§3.2(a) has no commit row), so LG-05 has nothing to compare and stays silent. **The error was
+undetectable by both forms** and surfaced only when the figure was measured directly.
+
+**Amended 2026-08-30 (WO-5 B).** An earlier draft closed: *"This does not weaken the live run:
+`main…staging` in `facts_rev16.json` (49/47, +10,159/−1,293) is correct, which is why the six LG-05
+findings are identical under both forms."* That sentence is **true and beside the point**, and is
+struck. **THREE OF THOSE SIX FINDINGS ARE WRONG UNDER BOTH FORMS** — lines 120 (×2) and 122 — because
+the defect producing them is **endpoint attribution inside the guard (LG-05-DEF-1)**, not the fact
+file. Identical output under `--facts` and `--repo` shows only that both inherit the same
+attribution bug; it is not corroboration.
+
+**The circularity finding is unaffected and stands on its own.** C-17 is about a wrong value
+(`commits: 45/43` recorded against the `main…a42b209e` range where measured is 39/37) and about why
+neither guard mode could detect it. That is a defect in the fact file. LG-05-DEF-1 is a separate
+defect, in the guard's row-attribution logic. **Two distinct defects, one shared root cause** — a
+figure moved between contexts without its endpoint travelling with it.
```

---

## What this correction set does NOT change

- **No §25 row is closed.** §25.4 is unchanged by repo access.
- **The code RC is untouched.** `a42b209e` remains the last non-docs commit; only
  `docs/PROMOTION_LEDGER.md` has changed after it (10 commits, REV-7…REV-16, zero merges) —
  re-verified this run.
- **§3.2(a)'s four application-scope figures are all confirmed correct** and are not amended.
- **Ledger-guard's other findings stand:** LG-01 WARN (4 live SHAs in the code-RC field), LG-08
  FAIL ×2 (`§16.4` and `§8.6` do not resolve). Not addressed here; they are documentation defects,
  not material facts about the release.

**Prepared by the compiler, 2026-08-30. Awaiting owner ruling. Not applied.**
