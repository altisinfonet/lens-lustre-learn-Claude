# F-16 – F-20: corrections, exact figures, and two raised findings

> ⚠ **Two statements in this document were themselves corrected by F-24 and F-25 — see the marked
> blocks below and `FINDINGS_F21-F26_RESPONSE.md`.**

**Nothing in this document closes a §25 row.**

---

## F-16 — the 14/7/50 split is NOT a B13 15b re-measurement. Relabelled.

Accepted without qualification. The 2026-08-26 baseline compared all 71 production functions
against **the candidate tree, staging @ `702e5ce` — the repository**. What I measured compares
production **deployment** against staging **deployment**. Deployed-to-deployed, not
deployed-to-repo: a different population answering a different question. Presenting it in a report
that also discusses B13 15a invited exactly the conflation you caught.

**Relabelled.** The 14 / 7 / 50 classification is hereby designated:

> **LANE-COMPARISON-2026-08-30 — a NEW measurement.** Population: the 71 slugs deployed on **both**
> production `jtdtehuqtinjxropkkcn` and staging `ztzutckwdhetphwghuzj`, as deployed, on 2026-08-30.
> It measures **deployment-to-deployment** divergence between two live lanes. It is **not** a drift
> measurement against any repository state, and it establishes **nothing** about how either lane
> relates to `702e5ce` or to any other commit.

**B13 condition 15b status:**

| Item | Status | Reason |
|---|---|---|
| B13 15a — capture and hash all 71 production functions | **SATISFIED** (this run) | 71/71 captured, hashed under a documented deterministic construction, independently recomputed |
| **B13 15b — production-vs-repo drift re-measurement** | **BLOCKED** | requires read access to the repository at `702e5ce`. No provider read can substitute. Not started, not partially done, not approximated by LANE-COMPARISON-2026-08-30 |

Nothing in this pack may be cited as evidence toward 15b.

---

## F-17 — both errors restated

### (a) The superset claim was wrong, and the direction of risk is not what I said

What I wrote — "staging is a slug-level superset of production, so the exposure runs toward what
promotion would add, not drop" — reasons from **slug names** to **content**. Those are different
populations. Slug-level containment says nothing whatever about whether the code behind a shared
slug matches: **50 of the 71 shared slugs differ in content.**

**Corrected, and measured.** In **three** shared slugs, **production carries behaviour that staging
does not**. A deploy of staging's code over production would **remove** it:

| Slug | What production has that staging lacks | Evidence |
|---|---|---|
| `send-gift-credit` | An indexed RPC lookup, `admin_lookup_user_id_by_email`, replacing a `listUsers()` + in-JS `find()` scan. Production's own comment records that the old approach **"broke once"** when `auth.users` passed 50 rows. Staging still carries the old scan. | 25 lines only in production, 6 only in staging; production entrypoint 730 B larger; production `updated_at` also later than staging's |
| `analyze-gallery-image` | A per-function API-key fallback chain `IMAGE_ANALYSIS_AI_KEY → AI_API_KEY → legacy`, giving the function its own credit limit and tracking. Staging resolves `AI_API_KEY` only. | 2 lines only in production, 1 only in staging |
| `detect-ai-image` | The same per-function key pattern, `AI_DETECTION_AI_KEY → AI_API_KEY → legacy`. Staging resolves `AI_API_KEY` only. | 2 lines only in production, 1 only in staging |

**How that number was reached, including the attempts that failed.** Three cheap proxies were tried
first and each gave a different answer: total bundle bytes larger on production → **2**; own-code
bytes larger on production → **5**; production `updated_at` later than staging's → **1**. None gave
three. Rather than pick whichever matched your figure, the five candidates were opened and read.
Two of the five are **not** production-ahead: `auth-email-hook` differs only in domain constants
(`www.50mmretina.com` vs `50mmretina.com` — lane configuration), and in `create-payment-session` it
is **staging** that is ahead, using the newer `_shared/laneConfig.ts` `siteOrigin()` abstraction
where production hardcodes origins. That leaves exactly the three above. The byte proxies were the
wrong instrument; the count is three on the evidence, which is also what you said.

**Recorded limit:** "ahead" here means *one lane carries substantive behaviour the other lacks*,
determined by reading the diffs. Which lane is chronologically newer is **not** established —
staging's `updated_at` values are bulk-redeploy artifacts, and settling chronology needs the
repository. That is UNDETERMINED, not decided.

### (b) Merging PR #104 deploys no functions

Also accepted. "What promotion would add" describes a **future deploy**, not the merge. Merging
PR #104 moves repository state; it does **not** deploy an edge function, does not alter either
lane's deployed inventory, and does not by itself add or remove anything from the 71 or the 74.
Every risk described in (a) is a risk of **a subsequent deploy of staging's code to production** —
an action that is separately gated and that B13 condition 2 excludes from this release entirely.
Nothing in the lane delta is a consequence of the merge, and the delta must not be read as an
argument for or against merging.

---

## F-18 — the approximations, replaced with exact figures

No tildes. The three figures you asked for:

**1. Functions whose delta lies ONLY in shared modules** (own entrypoint code byte-identical
across lanes, divergence entirely in `_shared/`): **22**

**2. Functions that ALSO differ in their own entrypoint code: 28**

22 + 28 = 50, the whole `CONTENT-DIFFERS` population. The 28 are: `analyze-gallery-image`,
`ask-anything`, `auth-email-hook`, `backfill-image-dims`, `backfill-thumbnails`,
`create-payment-session`, `dashboard-init`, `delete-my-account`, `delete-user`, `detect-ai-image`,
`hard-delete-competition`, `measure-post-media`, `media-register-upload`, `migrate-post-media`,
`migrate-storage`, `preview-transactional-email`, `process-email-queue`, `purge-s3-orphans`,
`s3-delete`, `s3-presign-upload`, `s3-signed-url`, `s3-upload`, `send-gift-credit`,
`send-reengagement-emails`, `send-transactional-email`, `seo-crawler-verify`, `seo-route-metadata`,
`sitemap`, `submit-judge-decision`.

**3. The arithmetic behind "the mass is three modules":**

    sum over the 50 CONTENT-DIFFERS slugs of |staging bundle bytes - production bundle bytes|
      = 360,715 bytes
    portion attributable to secureHeaders.ts, s3.ts, laneConfig.ts
      = 317,966 bytes   = 88.1%
    remainder, all other causes
      =  42,749 bytes   = 11.9%

And the specific claim behind the modal delta:

    secureHeaders.ts   production 1,507 B  ->  staging 6,963 B   = +5,456 B
    present in: 27 production functions, 28 staging functions
    functions whose ENTIRE bundle delta is exactly +5,456 B: 21

So the earlier "~28 functions" was wrong in the sense that mattered: `secureHeaders.ts` appears in
**27** production functions, and the number whose *whole* delta is accounted for by it alone is
**21**. Both figures are now stated exactly, and 88.1% is a share of byte-delta mass — it is not a
claim that 88.1% of *functions* are explained by three modules.

**A correction found while computing these.** The first census I ran reported `index.ts` as a shared
module with four deployed variants. That was **false — an artifact of my own path normaliser**.
A `user_fn_<ref>_<id>_<n>/` prefix is baked into some `files[].name` values, so those entrypoints
were misfiled as shared modules. The normaliser was fixed to strip that prefix and every figure
above was recomputed. Had it shipped, it would have been a fabricated finding.

> ⚠ **CORRECTED by F-24.** This paragraph originally said the prefix was on `dashboard-init`
> "unlike every other function". **False** — repeated from the capture agent's summary without
> checking. A full survey of all 395 `files[].name` values shows **four** production functions carry
> it, on every file: `auth-email-hook` (8/8), `dashboard-init` (2/2), `process-email-queue` (21/21),
> `send-transactional-email` (22/22) — **53 files, not 2.** The normaliser strips it generically, so
> the figures are unaffected; the description of scope was wrong.

---

## F-19 — closed by re-fetch, not left open

Done, not deferred. All **50** reduced-record production captures were re-fetched verbatim into
`WO2_prod_capture/raw_full/`, with the original `raw/` left untouched for comparison.

| Control | Result |
|---|---|
| WS-HASH-v1 of re-fetched bundle == original capture | **50 / 50** |
| `version` matches | 50 / 50 |
| `ezbr_sha256` matches | 50 / 50 |
| `entrypoint_path` now present | 50 / 50 |
| `entrypoint_path` carries `user_fn_jtdtehuqtinjxropkkcn_` | **50 / 50** |
| `updated_at` now present | 50 / 50 |

**Consequences.** (1) The provenance control that could not run now runs on the full population:
**71/71 production captures carry the correct project ref**, 0 wrong, **0 absent**. The
"absence of evidence" gap is closed by evidence, not by wording. (2) All 50 hashes are unchanged,
so the original captures were **correct** — the defect was in what was *stored*, not in what was
*measured*, and no function was redeployed between captures. (3) `updated_at` became available for
all 71, which is what made the F-17(a) chronology check possible at all.

**Two incidental facts recorded rather than smoothed over:** `handle-email-suppression` and
`handle-email-unsubscribe` return 13 top-level fields where the other 48 return 12 (an extra
`import_map_path`); and production `entrypoint_path` shapes are not uniform — four functions carry a
doubled `source/source/` segment, seven a bare `source/index.ts` with no slug directory. Any future
control that parses `entrypoint_path` must not assume one shape.

**Residual limitation, named:** the re-fetch is a **2026-08-30** capture. It cannot retroactively
prove what the provider returned during the earlier sweep; it proves the same bytes are there now
and that both captures agree. Closing that gap entirely is not possible from here and is not
claimed.

---

## F-20 — raised to numbered findings

### FINDING C-1 (severity: HIGH) — no single deployed source of truth for shared modules in production

Production deploys **multiple simultaneous, mutually-different versions of the same shared module**
across different functions. Each function bundles its own copy at deploy time, so copies drift and
nothing reconciles them.

Full census — every shared module deployed in production, by number of distinct variants:

| Shared module | Variants in production | Bytes per variant | Function carrying it |
|---|---|---|---|
| `s3.ts` | **4** | 7,590 | `purge-s3-orphans` |
| | | 7,777 | `media-register-upload` |
| | | 9,143 | `backfill-image-dims` |
| | | 9,980 | `detect-orphan-files` |
| `imageDims.ts` | **4** | 2,542 | `measure-post-media` |
| | | 2,766 | `media-register-upload` |
| | | 4,041 | `migrate-post-media` |
| | | 5,156 | `backfill-image-dims` |
| `registry.ts` | **2** | 2,211 | `preview-transactional-email`, `process-email-queue` |
| | | 2,315 | `send-transactional-email` |

**3 of 34** distinct shared modules in production carry more than one deployed variant. In `s3.ts`
and `imageDims.ts` **no two functions agree** — four functions, four different versions, in both
cases.

> ⚠ **CORRECTED by F-25 — the explanation above was written from memory, not from the file, and
> misdescribed my own prior measurement.** The three-count was **NOT** "staging files absent by
> content from the production bundle." The WO-1 record reads: `_shared/imageDims.ts` fetched from
> all three named functions (`backfill-image-dims` v5, `measure-post-media` v6, `migrate-post-media`
> v6), all three byte-distinct — i.e. **a variant census over the three functions named in the
> 2026-08-26 finding**. Correct restatement, both figures preserved with their scopes:
> **3** = variants among those three named functions; **4** = variants across all functions carrying
> the module, the fourth being `media-register-upload` (2,766 B). Both correct at their stated
> scope; C-1's table quotes the 4. See F-25 in `FINDINGS_F21-F26_RESPONSE.md`.

**Why HIGH.** These are not cosmetic. `s3.ts` is the storage-access layer that `purge-s3-orphans`
and `detect-orphan-files` — both **destructive-path** functions — depend on, and they carry copies
differing by 2,390 bytes. A fix applied to one copy does not reach the others, and nothing in the
deployment model surfaces the divergence: each function looks internally consistent. This is a
standing correctness hazard, independent of any lane comparison or of PR #104.

**Bounded:** measured on production's deployed bundles on 2026-08-30. Whether these variants are
intentional (per-function forks) or accidental drift is **not** decidable from deployment state —
that needs the repository. The finding is that they are simultaneously deployed and mutually
different, which is measured.

### FINDING C-2 (severity: MEDIUM) — the divergence is one-sided, and the contrast is itself evidence

**Staging has 34 distinct shared modules and 0 with more than one variant.** Every shared module on
staging is deployed at exactly one version across every function using it.

Production: 3 of 34 divergent. Staging: 0 of 34.

So the condition in C-1 is **specific to production**, not a property of the platform's bundling or
of the codebase generally. Staging demonstrates that single-version consistency across all 74
functions is achievable on this platform. MEDIUM rather than HIGH because it introduces no new
hazard of its own — its weight is that it removes "the platform forces this" as an explanation for
C-1.

**Not claimed:** that staging's uniformity results from any particular process, or that it will
persist. Staging's bundles were largely deployed in one bulk operation, which is a plausible cause
of uniformity that has nothing to do with discipline. Cause is UNDETERMINED.
