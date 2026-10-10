# Tranche 4 — the last 43 files, and the production leg of the central finding VERIFIED at the provider

Issued 2026-08-31 by the compiler/audit session. All measurements taken today, in this container against a **freshly fetched** clone, and in the owner's browser read-only.

**No commit, push, tag, merge, deployment, migration or provider write. One provider page was opened and read; nothing was changed.**

---

## 0. Two results that matter more than the file review

1. **The true merge scope equals the reviewed scope exactly** — measured, not assumed. §5 below.
2. **The `production` GitHub Environment holds `SUPABASE_DB_URL`, and admits `main` only.** The chain the ledger predicted at §2d is now verified end to end **from the live provider**. §1 below. **This makes the replacement RC a precondition of the merge, not an improvement to it.**

---

## 1. THE PRODUCTION LEG — verified live, 2026-08-31

Read at `https://github.com/altisinfonet/lens-lustre-learn-Claude/settings/environments/20410256671/edit`. **Names only. No value was viewed, typed or copied.**

| Property of the `production` environment | Measured |
|---|---|
| Environment secrets | **`SUPABASE_DB_URL` — PRESENT** |
| Deployment branches and tags | **`main` only** — 1 branch, 0 tags |
| Required reviewers | none listed |
| Wait timer | not set |
| Administrator bypass | checkbox present; recorded **ON** at 2026-08-30T13:52:07Z |
| Environment variables | none |

### What this closes

Until now the production half of the finding was **INFERRED**: I had reasoned that the `production` environment must hold the credential, without opening the page. It is now **VERIFIED**.

The chain, every link measured:

| # | Link | Status |
|---|---|---|
| 1 | `production` holds `SUPABASE_DB_URL` | **VERIFIED** — read today |
| 2 | `production` admits `main` and nothing else | **VERIFIED** — read today |
| 3 | On `main` today, `environment:` is **commented out** → no environment binds → the secret resolves **empty** → line 122 `if [ -z "$DB_URL" ]` **exits 1** | **VERIFIED** — read from source at `b671e1fb` |
| 4 | At the candidate, `environment: ${{ inputs.target }}` is **live** | **VERIFIED** — read from source at `a42b209e` |
| 5 | `DB_URL` is set at **job** level, so it is in the environment of **every step**, including the first | **VERIFIED** — lines 92–93 |
| 6 | Line 174 interpolates free-text `inputs.migration` into shell **above** the step's own allowlist, `..` refusal, existence test and confirm-match | **VERIFIED** — read line by line |
| 7 | Nothing pauses a `production` deployment — no reviewers, no timer | **VERIFIED** — read today |

### Stated plainly, because this is the sentence the owner has to weigh

**Today, `main` is safe because the job dies sixty lines before the injection point. The merge is what removes that protection.** After the merge, any actor with repository write access can dispatch `apply-migration.yml` from `main` with `target=production` and execute arbitrary shell on the runner **with the production database URL already present in the job environment**, before a single one of that workflow's careful validations runs.

**Threat class: authenticated repository-write actor. NOT anonymous, NOT internet-facing.** `workflow_dispatch` requires write access. The realistic actors are a collaborator, a compromised account, or a leaked token. That bound is part of the finding and must travel with it.

**But the bound does not rescue it.** The entire purpose of the two-input confirmation and the allowlist is to make a *mistaken or deliberate* dispatch safe. Neither survives, because neither runs.

### The two ways to close it, and their cost

| | Action | Closes it? | Cost |
|---|---|---|---|
| **A** | **Adopt the replacement RC** — the owner's recorded ruling | **Yes, properly** | Developer 1 must push. Three files, `+36 / −7`, all inside the reviewed 138 |
| **B** | **Delete `SUPABASE_DB_URL` from the `production` environment** before merging | Yes, by restoring the line-122 exit | `apply-migration.yml target=production` stops working — and **D-10 / AF-17 is a post-merge production migration that needs it**. The secret would have to be re-added to run D-10 and removed again after, with the exposure live for that window |

**A is better and it is already ruled. B is recorded only so the owner knows a same-day option exists if the push cannot happen.** I have not performed either; deleting a provider secret is an account-settings change and is not mine to make.

---

## 2. Tranche 4 — the remaining 43 files, all reviewed. **My half of the 138 is now complete.**

Neither developer owns the 43 files outside `src/` and `supabase/functions/`. Correction **C-29** recorded that twelve of the 138 had no owner. **They were all in this set, and I have now taken all 43.**

```
138  =  51 src/ (Developer 2)  +  44 supabase/functions/ (Developer 1)  +  43 (me)
```

### 2a. `public/_headers`, `public/robots.txt`, `public/sitemap.xml` — templated. **The byte-identity claim was EXECUTED, not read.**

All three lose their production host literals and gain `__CDN_HOST__` / `__SITE_ORIGIN__` / `__SITE_DISPLAY_ORIGIN__` placeholders. `scripts/generate-headers.mjs` and `scripts/generate-seo-assets.mjs` fill them at build time; `package.json`'s `build` script now chains both.

`generate-headers.mjs` makes an explicit claim in its own comments — that the generated **production** file is byte-identical to what `main` committed. **A claim in a comment is not evidence. I ran it.**

| Artefact | Generated production output | `main`'s committed copy | Result |
|---|---|---|---|
| `_headers` | `sha256 40b681e53735875f42dbb5746a91b9f08fca4d693698df0bf75fc4f0ee9109f0`, 2,928 B | **same hash, same size** | **BYTE-IDENTICAL** |
| `robots.txt` | `sha256 2149c780953795d41c083c143642d60befb0a0d8093ddde1f6412fcd761d9d4f` | **same hash** | **BYTE-IDENTICAL** |
| `sitemap.xml` | `sha256 11b27c08065afe6c4d7fb481f12b40a34311d1c43f31b338296481b89e8c24f8` | **same hash** | **BYTE-IDENTICAL** |

Run reported: `generate-headers OK: 12 rules, 25 headers; cdn=cdn.50mmretina.com serving-origin=https://www.50mmretina.com acao=https://50mmretina.com` and `generate-seo-assets OK: 2 files; origin=https://50mmretina.com`.

**Result: the merge changes no production security header, no CSP directive, no CORS origin, no robots rule and no sitemap URL.** That is now a measured fact rather than a hope, and it is the single most reassuring thing in this tranche.

**Staging lane, same scripts:** output contains **zero production hostnames** — no `cdn.50mmretina.com`, no `www.50mmretina.com`, no `https://50mmretina.com`. Lane separation holds in the generated artefacts.

**Guard behaviour, tested rather than trusted:**

| Input | Result |
|---|---|
| `VITE_CDN_HOST=""` | **build FAILS**, exit 1 — the G4 item 3 "empty is not a default" rule fires |
| `VITE_SITE_ORIGIN=""` | **build FAILS**, exit 1 |
| `VITE_SITE_ORIGIN=http://evil.example.org` | **REJECTED** — "is not an https origin" |
| `VITE_CDN_HOST=evil.example.org/x` | **REJECTED** — "is not a bare hostname" |
| leftover `__PLACEHOLDER__` in output | script exits 1 rather than shipping the literal into a live header |

**One honest limit, recorded so nobody over-reads the table above:** these are **shape** checks, not an allowlist. `VITE_SITE_ORIGIN=https://evil.example.org` is well-formed and **would be accepted**. The value comes from the build environment, which is repository-controlled — so this is the same authenticated-actor class as the workflow finding, not a new one. **Recorded as an observation, not a finding.**

### 2b. `index.html`, `vite.config.ts`, `vitest.config.ts`, `package.json` — **CLEAN**

- `index.html`: the hard-coded `50mmretina.com` → `www.` redirect becomes lane-derived from `%VITE_SITE_ORIGIN%`, with the apex computed by stripping a leading `www.` — **empty when the origin is already an apex, so a redirect loop cannot be built.** `og:url` templated the same way.
- `vite.config.ts` / `vitest.config.ts`: add `define: laneDefine()`. `vitest` pins the production constants explicitly, matching the hermetic-env convention — a test never depends on the ambient environment.
- **`package.json`: `scripts` only. ZERO dependency additions, removals or version changes.** Worth saying explicitly: **this promotion introduces no new supply-chain surface.**

### 2c. The six `functions/` route files — **CLEAN, and mechanically uniform**

`competitions/[id].ts`, `courses/[slug].ts`, `featured-artist/[slug].ts`, `journal/[slug].ts`, `page/[slug].ts` all make the same two changes:

```diff
-import { …, SITE, … } from "../_seo";
+import { …, site, … } from "../_seo";
+  const SITE = site(context.env);
-  const c = await sbGet(`…`);
+  const c = await sbGet(`…`, context.env);
```

A module-level constant becomes a per-request, environment-derived call. **That is the G5b fix — removing production defaults from Pages Functions — and it is applied identically in all five.**

Every user-controlled path parameter reaching a PostgREST query is wrapped in **`encodeURIComponent`**. No new sink, no shell, no `eval`. `pages-runtime.d.ts` is a new ambient type declaration for `HTMLRewriter` — types only, no runtime code.

### 2d. `supabase/migrations/20260824145345_admin_user_lookup_by_email.sql` — **CLEAN, and correctly locked down**

Two `SECURITY DEFINER` functions that read `auth.users`. This is the highest-privilege thing in the change set, so it was read in full rather than skimmed:

- `set search_path to 'public', 'auth'` — **pinned**, which is the defence against search-path hijacking of a `SECURITY DEFINER` function.
- Explicit `revoke all … from public`, `from anon`, `from authenticated` — **all three**, on both functions.
- `grant execute … to service_role` **only**.
- Returns a `uuid` and an email for ids already supplied. **No password hash, no token, no metadata.**
- Already applied to both lanes (production `20260824145345`, staging `20260824145121`, 2026-08-24). **No migration action is needed for this file.**

**One property recorded rather than glossed:** `admin_lookup_user_id_by_email` is an *email-existence oracle* — it reveals whether an address is registered. It is reachable only by `service_role`, and the gift form's own 404 already disclosed the same fact to an admin. **Correctly bounded. Not a finding.** The migration's own header says so, which is the right way to write one.

### 2e. `docs/DECISIONS.md` — **not a code change, but the owner should see it**

`+49 / −6`. It records that on 2026-08-29 the `PrivacyGapNotice` copy was **shortened**, removing the sentence telling a member that a photo behind an "Only me" or "Friends" post is still fetchable by direct link.

**Nothing in the code changed. `post-images` is still a public bucket; its SELECT policy is still `(bucket_id = 'post-images')` with no privacy condition; D-002 remains ACTIVE.**

The document says all of that in its own words, and says the disclosure was dropped while the gap was not — so it is **honestly recorded, not hidden**, and the pinning test was narrowed to the new copy rather than deleted. **This is the owner's decision, already made and already written down.** I record it here only so that it is not discovered for the first time by a member.

### 2f. Files reviewed in earlier tranches, unchanged

`.github/workflows/` (8, tranche 1) · `.gitleaks.toml` (tranche 2) · `scripts/` (10, tranche 2) · `supabase/config.toml` (tranche 2) · `supabase/migrations/20260828082136` (tranche 2) · `supabase/rollback/` (5, tranche 2) · `functions/_seo.ts` (tranche 2) · `docs/PROMOTION_LEDGER.md` (read in full, frozen at `f00f612a…5943`).

---

## 3. Coverage — the 138-file review is now fully owned

| Owner | Files | Status |
|---|---|---|
| **Me** | **43** — everything outside `src/` and `supabase/functions/` | **COMPLETE. 43 of 43 reviewed with a stated claim.** |
| Developer 1 | 44 — `supabase/functions/` | outstanding: publish `A15_CLAIMS_138.tsv` for the completeness check |
| Developer 2 | 51 — `src/` | outstanding: Task 3 claim rows |

**C-29 is resolved. No file in the 138 is unowned.**

**Findings added by this tranche: none.** The two live findings in this release remain the two already known — the workflow injection and the `_seo.ts` JSON-LD sink — and both are in the reviewed set. Four tranches, four population scans, and no third defect.

---

## 4. Live repository state, measured today

Fetched from `origin` in this container, and cross-read in the browser.

| | |
|---|---|
| `origin/main` | `b671e1fb0c5bcf145d442076c229eca888afd674` — **unmoved** |
| `origin/staging` (**current head**) | `9ac4524d703035e6d2debd9e97ab9a0e73de3bc9` — REV-16 |
| Frozen application RC | `a42b209e4f70a6efed4f3dcdb654e0f994416594` |
| Remote branches | `main`, `staging`, `altisinfonet-patch-35` — **and nothing else** |
| **`rc-replacement/option2-2026-08-30`** | **NOT PRESENT ON `origin`. The replacement RC is still unpushed.** |
| Tags | **0** |
| PR #104 | Open · "Ready to merge" · 49 commits · 138 files · **+10,159 / −1,293** |
| PR #104 checks | **17 — 15 successful, 2 skipped. No conflicts. "Merging can be performed automatically."** |
| Cloudflare Pages staging | Deploy successful at `9ac4524` |

**Open item for Developer 1:** the two **skipped** checks are not named in the checks summary. §24.1 step 6a says read conclusions, not tick colours. **Name them at the new head.**

---

## 5. THE SCOPE QUESTION — the frozen candidate is not staging's head, and it does not matter. Measured.

`a42b209e` is **ten commits behind** `origin/staging`. All ten are `docs(ledger)` commits, REV-7 through REV-16. So the merge does **not** merge the frozen candidate — it merges `9ac4524d`.

**That is the kind of gap this engagement exists to catch, so it was measured rather than reasoned about.**

```
git diff --name-only b671e1fb a42b209e | sort  >  set_rc     (138 lines)
git diff --name-only b671e1fb 9ac4524d | sort  >  set_head   (138 lines)
diff set_rc set_head                           →  EMPTY
```

**Symmetric difference: EMPTY. The two file sets are identical, member for member.**

```
git diff --name-status a42b209e 9ac4524d
  → M   docs/PROMOTION_LEDGER.md          (and nothing else)
  → 1 file changed, 1254 insertions(+), 155 deletions(-)
```

**The entire difference between the reviewed object and the object that will merge is one documentation file: the ledger itself.** That is exactly what §3.1's layered identity and §28's documentation freeze provide for, and the PR body states the same test. **It holds.**

### And the line arithmetic composes — which it was not obliged to do

| Measurement | Value |
|---|---|
| `main → a42b209e` | +9,060 / −1,293 |
| `main → 9ac4524d` | **+10,159 / −1,293** |
| difference | **+1,099 / −0** |
| ledger insertions at `a42b209e` (status **A**) | 1,173 |
| ledger insertions at `9ac4524d` (status **A**) | 2,272 |
| 2,272 − 1,173 | **1,099** ✔ |

**Standing rule 14 is why this needed checking and why it comes out this way.** `docs/PROMOTION_LEDGER.md` is **added** (`A`) relative to `main` — it does not exist there — so its 155 intra-staging deletions never appear in the `main`-relative diff, and the deletion total stays at 1,293. Line counts compose here **only because** the one changed file is an addition at both endpoints. **Had it been a modification, the naive sum would have been wrong.**

**Independent confirmation:** GitHub's own PR #104 page reports **+10,159 / −1,293 across 138 files** — computed by GitHub, matching my `git diff` exactly. Two instruments, same figures.

### One item for the owner, small but real

The PR #104 body states *"the same 138 files · +9,494 / −1,293 — the extra ~434 lines are the ledger itself."* Measured at `fe63e944`, and the body says so — **so it is honest, not an error.** But the true figure at today's head is **+10,159**, and the ledger's contribution is **+1,099**, not ~434.

**The PR body is part of the merge record.** It should be refreshed to the freeze head before the merge, or carry an explicit as-of line. Standing rule 13: a measured figure carries its as-of time.

---

## 6. Standing

**Nothing in this document closes a row.** §25.4: *"No row below may be marked closed by the compiler. The compiler is not a second party."*

**What changed today:** the production leg of the central finding moved from INFERRED to **VERIFIED at the provider**; my 43 files went from partly reviewed to **complete**; the byte-identity of production's shipped headers, robots and sitemap moved from a comment in a script to an **executed comparison**; and the frozen-candidate-versus-head question moved from unexamined to **measured, with an empty symmetric difference**.

**What did not change:** no commit, no push, no tag, no merge, no deployment, no migration, no provider write. The only state change in this entire engagement remains the owner's own creation of `SUPABASE_DB_URL` on the `staging` environment at ~07:35Z today.
