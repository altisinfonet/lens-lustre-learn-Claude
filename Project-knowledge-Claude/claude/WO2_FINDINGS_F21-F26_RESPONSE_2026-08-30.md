# F-21, F-24, F-25, F-26 — scope declarations, a corrected reconciliation, and finding C-3

**Nothing in this document closes a §25 row.**

---

## F-21 (carried) — search scope, now declared AND widened

You were right that it was undeclared, and right about what it was. The five candidates were the
**union of three proxies** — production total bundle bytes larger (2), production own-code bytes
larger (5), production `updated_at` later (1). A function where production is ahead but **smaller
and older** is invisible to all three. "Three" was therefore a **lower bound over a proxy union**,
not a total, and I presented it as though it were a total.

**Rather than declare the limit, the limit was removed.**

> **SCOPE, as executed: all 71 shared slugs. For every one, the function's own code (all files not
> under `_shared/`) was diffed line-by-line against the other lane. No proxy filter was applied at
> any stage.** 28 slugs have own-code differences; of those, 20 have at least one production-only
> line, and **all 20 were read**, not sampled.

**Result: exactly 3, and it is now a total over the declared scope, not a lower bound.**

| Slug | Production-ahead behaviour | prod-only / staging-only lines |
|---|---|---|
| `send-gift-credit` | Indexed RPC `admin_lookup_user_id_by_email` replacing a `listUsers()` + in-JS `find()` scan that production's own comment records **"broke once auth.users passed 50"**. Staging still carries the scan. | 25 / 6 |
| `analyze-gallery-image` | Per-function key chain `IMAGE_ANALYSIS_AI_KEY → AI_API_KEY → legacy` | 2 / 1 |
| `detect-ai-image` | Per-function key chain `AI_DETECTION_AI_KEY → AI_API_KEY → legacy` | 2 / 1 |

**The 17 other slugs with production-only lines, and why each is not production-ahead** — stated so
the exclusions are auditable rather than asserted:

- **Lane configuration only** (apex vs `www` host, site URL, sender domain): `seo-crawler-verify`,
  `sitemap`, `seo-route-metadata`, `create-payment-session`, `auth-email-hook`,
  `send-transactional-email`, `backfill-thumbnails`.
- **Comments/documentation only, code identical**: `media-register-upload`, `measure-post-media`,
  `migrate-post-media`, `ask-anything`, `process-email-queue`, `backfill-image-dims`,
  `purge-s3-orphans`.
- **Comment-only, and the fix itself is on BOTH lanes — checked, not assumed**:
  `send-reengagement-emails`. Production carries a `BUG FIX 2026-07-25` comment staging lacks, but
  the fix it describes is present on both: `is_suspended` ×2 and `is_banned` ×2 on each lane.
  Comment-ahead, not code-ahead.
- **Comment-only, and staging is ahead overall**: `delete-user` (production +1 comment line,
  staging +22 code lines).
- **Staging is ahead, materially**: `submit-judge-decision`. Production carries a **local wildcard
  `corsHeaders` object**; staging calls **`getSecureHeaders`** (`getSecureHeaders` ×2 on staging,
  ×0 on production). **The CORS remediation exists on staging and not on production for this
  function.** This connects directly to C-3 below.

**Shared modules — scope stated, direction NOT claimed.** The above covers own code. The 22
remaining `CONTENT-DIFFERS` slugs have byte-identical own code and diverge only inside `_shared/`.
At module level: 33 shared modules exist on both lanes, `laneConfig.ts` is staging-only, none is
production-only. Production variants carry non-comment lines absent from every staging variant in
**31** module-variant cases — but these are dominated by lane configuration (apex-vs-`www` URLs, a
logo asset host) and by C-1's fork variants of `s3.ts` and `imageDims.ts`, where production's copies
also differ **from each other**. **A behavioural adjudication of shared-module direction was NOT
performed. It is UNDETERMINED and needs the repository.** The figure "3" is a total over **own
code**, and that boundary is part of the claim.

---

## F-24 (carried, narrowed) — shape survey run on `files[].name`, the field the instrument reads

Correct: I surveyed `entrypoint_path`, but the normaliser feeding C-1 consumes `files[].name`, and
that field had no survey. Run now.

> **SCOPE: every `files[].name` value in every captured bundle on both lanes — 183 values across 71
> production bundles, 212 across 74 staging bundles. 100%, none sampled.**

**Production — 5 distinct shape classes:**

| Shape | Count | Example |
|---|---|---|
| `_shared/…` | 61 | `_shared/secureHeaders.ts` |
| `<slug>/…` | 58 | `cast-photo-vote/index.ts` |
| `user_fn_<ref>_<id>_<n>/` + `_shared/…` | 48 | `user_fn_jtdtehuqtinjxropkkcn_350f09fa…_20/_shared/…` |
| bare filename | 11 | `index.ts` |
| `user_fn_…/` + `source/` + bare | 5 | `user_fn_…_20/source/index.ts` |

**Staging — 4 distinct shape classes:** `functions/_shared/…` (131), `functions/<slug>/…` (52),
`<slug>/…` (28), bare (1).

**This survey corrected an error I had already published.** In the F-18 response I wrote that
`dashboard-init` carries the `user_fn_…/` prefix "unlike every other function" — inherited from the
capture agent's report and not checked. **It is false. Four production functions carry it, on every
file in their bundle: `auth-email-hook` (8/8), `dashboard-init` (2/2), `process-email-queue`
(21/21), `send-transactional-email` (22/22) — 53 files, not 2.** The normaliser strips the prefix
generically, so C-1's figures are unaffected and were recomputed to confirm it; but the published
description of the anomaly's scope was wrong and is corrected here. This is the third time in this
engagement that repeating a claim from memory or from another party's summary, instead of from the
artefact, has produced a false statement.

**Normaliser coverage against the survey:** all 9 observed shape classes across both lanes are
handled — `user_fn_…/` prefix stripped by regex, then `source/`, `supabase/functions/`, `functions/`
stripped repeatedly, then `_shared/` vs `<slug>/` vs bare classified. No observed shape falls
through. **Limit:** this is coverage of shapes **observed on 2026-08-30**; a shape not present in
these 395 values is not handled by evidence, only by construction.

---

## F-25 (new) — the imageDims reconciliation, restated from the file

Accepted, and the fault is exactly as you name it. I wrote that the three-count "was a different
metric — staging files absent by content from the production bundle." **That is not what the WO-1
record says.** The record reads:

> `_shared/imageDims.ts` fetched from all three named functions (`backfill-image-dims` v5,
> `measure-post-media` v6, `migrate-post-media` v6). All three are byte-distinct.

That is a **variant census over a named subset** — the three functions named in the 2026-08-26
finding — not a staging-absence metric. I described my own prior measurement from memory instead of
opening the file, which is the same fault class as F-9, F-14 and the `dashboard-init` error above.

**Correct restatement — both numbers, both scopes, both preserved:**

| Figure | Scope | Result |
|---|---|---|
| **3** | Variants of `_shared/imageDims.ts` among **the three functions named in the 2026-08-26 finding**: `backfill-image-dims` (5,156 B), `measure-post-media` (2,542 B), `migrate-post-media` (4,041 B) | 3 distinct — all three byte-distinct |
| **4** | Variants of `_shared/imageDims.ts` across **all production functions carrying the module** — the three above plus `media-register-upload` (2,766 B) | 4 distinct — no two agree |

**Both are correct at their stated scope.** The subset census is 3 because it was scoped to three
named functions; the full census is 4 because a fourth function, `media-register-upload`, carries a
fourth distinct variant. Neither supersedes the other; the difference is scope, and it must be
carried with each figure whenever either is quoted. C-1 quotes the **4**, and now says so.

---

## FINDING C-3 (severity: HIGH) — B13's CORS residual risk describes a uniform population; the measured population splits four ways

**The reconciliation you asked for. B13's accepted residual risk reads:**

> "Pre-G9 CORS in production — ALL 71 functions … deployed `secureHeaders.ts` byte-identical across
> every function that bundles it."

**That wording is quoted here as B13's wording. It is not restated as measurement.** The measurement
below is mine, and it does not match the shape of the risk as described.

> **SCOPE: all 71 production functions, every file in every bundle. None sampled.**

| CORS mechanism | Count | Behaviour |
|---|---|---|
| Bundles `_shared/secureHeaders.ts` and calls `getSecureHeaders` | **27** | Origin **allowlist** — 5 named origins plus `*.lovable.app` |
| **Local `corsHeaders` object literal in the function's own code** | **39** | **`Access-Control-Allow-Origin: "*"` — wildcard, all 39** |
| Imports `corsHeaders` from an external package specifier | **2** | `npm:@supabase/supabase-js@2/cors` — value **not determinable from the deployed bundle** |
| No CORS handling of any kind | **3** | no `Access-Control` header, no `OPTIONS` branch |
| | **71** | |

**The 44 that do not bundle `secureHeaders.ts`, enumerated by mechanism:**

- **Local wildcard `corsHeaders` object (39):** `ad-reward-credit`, `analyze-gallery-image`,
  `ask-anything`, `auth-email-hook`, `backfill-image-dims`, `backfill-image-hashes`,
  `backfill-thumbnails`, `delete-my-account`, `delete-user`, `detect-ai-image`,
  `detect-orphan-files`, `diagnose-brevo-key`, `fix-cache-headers`, `ga-report`,
  `handle-email-unsubscribe`, `hard-delete-competition`, `judge-session-resume`,
  `judging-invariants-nightly`, `measure-post-media`, `media-register-upload`, `migrate-post-media`,
  `migrate-storage`, `preview-transactional-email`, `publish-round`, `publish-scheduled-posts`,
  `purge-s3-orphans`, `send-broadcast-push`, `send-push`, `send-reengagement-emails`,
  `send-transactional-email`, `seo-crawler-verify`, `seo-route-metadata`, `sitemap`,
  **`submit-judge-decision`**, `submit-judge-score`, `test-smtp`, `translate-text`,
  `verify-email-provider`, `verify-image-hash`.
  **All 39 serve `Access-Control-Allow-Origin: "*"`.**
- **External-specifier import (2):** `submit-judge-comment`, `submit-judge-tag` — both
  `import { corsHeaders } from "npm:@supabase/supabase-js@2/cors"`. The served policy is whatever
  that specifier resolves to and **cannot be read from the deployed bundle**. Whether that subpath
  resolves at all is **not verified here** — it is flagged as unauditable-from-deployment, not
  asserted broken.
- **No CORS handling (3):** `brevo-webhook`, `handle-email-suppression`, `process-email-queue` —
  zero occurrences of `Access-Control`, `cors` (case-insensitive) or an `OPTIONS` branch in any file
  of the bundle. Consistent with webhook/cron entry points that no browser calls, though intent is
  not measurable.

**Why this is material to a signed ruling.** B13's residual risk is phrased over "ALL 71 functions"
with the uniformity qualifier attached to `secureHeaders.ts`. The measured population is not
uniform: **27 allowlist, 39 serve a wildcard from their own local object, 2 delegate to an
unauditable external specifier, 3 do nothing.** The owner signed against a risk described as one
condition holding across 71; the measurement says the 71 split four ways, and **the largest group —
39 — is the wildcard group, which is the condition the risk was about.** A remediation reasoned
about as "update the shared helper" reaches **27 of 71** and does not touch the 39.

**Two supporting measurements, both run rather than assumed:**

1. `secureHeaders.ts` defaults `origin` to `"*"` when called with no request argument. **All 27
   callers pass a request** (27/27), so the wildcard fallback is not exercised in production. The
   27 genuinely allowlist. That part of B13's description holds **for the 27**.
2. Within the 27, `secureHeaders.ts` is byte-identical — **one variant, 1,507 bytes, across all 27**.
   So B13's "byte-identical across every function that bundles it" is **TRUE as written**. The
   defect is not in that clause; it is that the clause is scoped to "every function that bundles
   it" (27) while the risk headline is scoped to "ALL 71".

**And the lane comparison bears on it:** for `submit-judge-decision`, **staging calls
`getSecureHeaders` while production carries the local wildcard object.** The remediation exists on
staging and not on production for at least this one function.

**Bounded.** This is a measurement of **deployed source** on 2026-08-30. It does not establish what
any function returns at runtime (no request was issued to any endpoint — provider mutation and live
probing are out of scope), nor what the repository says any of them should be. Whether the 39
wildcards are intended is **not decidable from deployment state**. The finding is the population
split, which is measured, and its mismatch with the shape of the signed residual risk.
