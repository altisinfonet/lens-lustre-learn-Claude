# G10 PHASE 0 — BASELINE CAPTURE AND PRODUCTION SURFACE INVENTORY

**Executed 2026-08-26, 10:54–11:01 UTC. Entirely read-only. Production was not written.**
Runbook: `G10_COMPLETION_RUNBOOK_2026-08-26.docx` Revision 2.1, Phase 0.
This document is items **15 and 16** of the release evidence bundle (control C7).

> Result vocabulary: VERIFIED · OWNER-ATTESTED · BLOCKED · NOT APPLICABLE. Nothing else.
> Rule zero: no evidence by inference.

---

## SUMMARY OF RESULTS

| Step | What | Result |
|---|---|---|
| 0.0 | Ten-surface production inventory | **DRAFTED — needs owner confirmation** |
| 0.1 | Pages variables, build command, production branch | **VERIFIED** |
| 0.2 | robots.txt + `_headers` | **VERIFIED** (bodies) · sitemap.xml and apex redirect **BLOCKED** |
| 0.3 | Production schema fingerprints (11) | **VERIFIED** |
| 0.4 | Error-rate baseline, two windows | **VERIFIED** |
| 0.5 | Deployment ID, source commit, tree | **VERIFIED** |
| 0.6 | 71-row edge function baseline | **VERIFIED** |
| 0.7 | GitHub ruleset / environments / secret names | **NOT YET CAPTURED** |
| 0.8 | DNS + Zero Trust | **PARTIAL** — domains captured, records and ZT policies not |
| 0.9 | R2 configuration | **PARTIAL** — buckets captured, CORS/custom domains not |

---

## 0.5 — REPOSITORY AND DEPLOYMENT STATE (re-measured 2026-08-26 11:01:07Z)

| | Commit | Tree |
|---|---|---|
| `main` | `b671e1fb0c5bcf145d442076c229eca888afd674` | `db8df5679ab812be4f0ba9a3284df7dc2f02c3e1` |
| `staging` | `702e5ceb6d40b6f487cedf2378aae835bd18621f` | `30ed9e585c13d493ad253adc3de1d9e9152405e7` |

**Tags in the repository: 0.** The approved tag at step 8.4 will be the first.

**Current production deployment (C2 chain link 5 baseline):**

- Deployment ID: **`6a383d3b-f6cb-45c5-9417-a469d50689ea`**
- URL: `https://6a383d3b.lens-lustre-learn-claude.pages.dev`
- Aliases: `50mmretina.com`, `www.50mmretina.com`
- Source: branch `main`, commit `b671e1f`
- Status: **success**, 2026-08-25 18:18 (dashboard local), duration 1m 3s

**Rollback target (§17-9, re-confirmed present):** `9c0c1201-41b4-4abf-9b5f-18598b5189d7`

**Freeze status observed:** `staging` is still at `702e5ce` and PR #102 (`claude/50mm-retina-g10-exec-6u7eej`, head `7b9d707`) is **still unmerged**. No other session has pushed. The candidate base is unchanged since the last measurement.

---

## 0.1 — PAGES CONFIGURATION (§17-8 baseline)

Project `lens-lustre-learn-claude` · account `a7810011a99de537a210130f86306785`

- **Build command:** `npm run build && node scripts/verify-bundle-isolation.mjs`
- **Build output:** `dist` · Root directory: (repo root) · Build system: **Version 3**
- **Production branch:** `main` · Automatic deployments: **Enabled** · Build watch paths: `*`
- **Compatibility date:** 2026-07-09 · Placement: Default · Fail open
- **Deploy hooks:** none defined
- **Preview access:** restricted by a Cloudflare Access policy (production pages.dev and custom domains managed separately in Zero Trust)

### The ten variables — all type **Text**

| # | Name | Value |
|---|---|---|
| 1 | `ISOLATION_EXPECTED_HOST` | `cdn.50mmretina.com` |
| 2 | `ISOLATION_FORBIDDEN_HOSTS` | `cdn-staging.50mmretina.com,staging.50mmretina.com` |
| 3 | `ISOLATION_FORBIDDEN_REFS` | `ztzutckwdhetphwghuzj` |
| 4 | `NODE_VERSION` | `20` |
| 5 | `SITE_ORIGIN` | `https://www.50mmretina.com` |
| 6 | `SUPABASE_ANON_KEY` | **JWT — present, deliberately not transcribed (HS-10)** |
| 7 | `SUPABASE_PROJECT_REF` | `jtdtehuqtinjxropkkcn` |
| 8 | `VITE_SUPABASE_PROJECT_ID` | `jtdtehuqtinjxropkkcn` |
| 9 | `VITE_SUPABASE_PUBLISHABLE_KEY` | **JWT — present, deliberately not transcribed (HS-10)** |
| 10 | `VITE_SUPABASE_URL` | `https://jtdtehuqtinjxropkkcn.supabase.co` |

**Directly actionable for runbook step 4.3.** The production Pages project **does** carry all three
isolation variables with real values. `main`'s `web-build.yml` sets `ISOLATION_FORBIDDEN_REFS: ""`
and no host variables — so the production lane's guard is **armed on Cloudflare and disarmed in CI**.
Step 4.3 must copy exactly the three values above into the workflow. §17-4 requires "with host rules
active" and is not satisfied until it does.

**Observation, not a verdict:** both JWTs are stored as type **Text**, not **Secret**, so their values
render in the dashboard. Supabase anon/publishable keys are designed to be client-visible and ship in
the browser bundle, so this is not asserted as an exposure — but it is recorded because HS-10 concerns
secret handling and the owner should rule on whether these belong in the Secret type.

---

## 0.2 — PRODUCTION EDGE ARTEFACTS

### `_headers` as configured for deployment `6a383d3b…` — VERIFIED

Read from the deployment's own Headers tab, so this is the configuration that deployment shipped with.

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  X-XSS-Protection: 1; mode=block
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  Content-Security-Policy: <full policy captured — default-src 'self'; object-src 'none';
    base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests>
  Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
  Access-Control-Allow-Origin: https://50mmretina.com
  X-Permitted-Cross-Domain-Policies: none
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: cross-origin
  Cross-Origin-Embedder-Policy: unsafe-none

/assets/*   Cache-Control: public, max-age=31536000, immutable
/images/*   Cache-Control: public, max-age=2592000, immutable · Vary: Accept
/*.webp     Cache-Control: public, max-age=31536000, immutable
/*.woff2    Cache-Control: public, max-age=31536000, immutable
# Edge caching for public/read-heavy pages
/competitions /discover /journal /courses /featured-artist /winners
            Cache-Control: public, max-age=300, s-maxage=600, stale-while-revalidate=86400
/certificates/*
            Cache-Control: public, max-age=600, s-maxage=1800, stale-while-revalidate=86400
```

**Observation for the owner:** `_headers` sets `Access-Control-Allow-Origin: https://50mmretina.com`
(apex) while `SITE_ORIGIN` is `https://www.50mmretina.com` (www). Both are live aliases of the same
deployment. Whether the apex/www mismatch is intended is **NEED EVIDENCE** — it is recorded, not judged.

### `robots.txt` on the production lane — VERIFIED (body)

Fetched 2026-08-26. Identical on both `www.50mmretina.com` and `50mmretina.com`. Production is
**indexable**, which is correct for this lane (the staging lane is the one that must be non-indexable).

Four agent blocks — `Googlebot`, `Bingbot`, `Twitterbot`, `facebookexternalhit` — plus `User-agent: *`.
Googlebot, Bingbot and `*` each `Allow: /` then `Disallow:` twelve private paths: `/admin`,
`/edit-profile`, `/dashboard`, `/wallet`, `/judge`, `/photos`, `/referrals`, `/friends`, `/settings/`,
`/reset-password`, `/forgot-password`. Twitterbot and facebookexternalhit are `Allow: /` only.
Trailer: `Sitemap: https://50mmretina.com/sitemap.xml`.

### BLOCKED items in 0.2

- **Byte-exact sha256 of `robots.txt` / `_headers` as served.** Both bodies above came through a
  content-rendering fetch, so hashing them would hash a transcription, not the served bytes. Recording
  such a hash as "the served sha256" would be evidence by inference. **Needs** a byte-exact fetch
  (browser devtools raw response, or the owner running `curl -s <url> | sha256sum`).
- **`sitemap.xml` body** — not captured.
- **Apex → www redirect status code** — not captured. The apex serves `robots.txt` directly and no
  redirect was reported, which is *consistent with* there being no apex→www redirect, but the fetch
  tool does not report status codes reliably, so this is **NEED EVIDENCE**, not a finding.

---

## 0.3 — PRODUCTION SCHEMA FINGERPRINTS

Measured read-only on `jtdtehuqtinjxropkkcn` and, for comparison, `ztzutckwdhetphwghuzj`, schema
`public`. **The exact SQL recipe is recorded below and must be reused verbatim for every later
comparison** — a different expression produces a different hash for identical state.

| # | Fingerprint | Count | Production md5 | Staging md5 | Equal? |
|---|---|---|---|---|---|
| 01 | tables | 146 | `167cf07cd43e77346cacb449875ff52e` | same | ✅ |
| 02 | columns | 1483 | `11a8a7add998602a5a1ca74b633d81f7` | same | ✅ |
| 03 | function signatures | 387 | `49e2fd0b2f865ec689e9b8d64aa4c54d` | same | ✅ |
| 04 | indexes | 439 | `1bd2725c5c3e0b4cf422d1cf2550d401` | same | ✅ |
| 05 | triggers | 149 | `8649e012385d4041cdccc6bddc95f24f` | same | ✅ |
| 06 | policies | 686 | `51e29bf1204b9f3289fec62fb62309e2` | same | ✅ |
| 07 | constraints | 382 | `e3251f20a7c1a2daf48ca8ee3f7bf775` | same | ✅ |
| 08 | RLS flags | 146 | `785c0a00681a9eac2c6f5fa7196ad1f6` | same | ✅ |
| 09 | function bodies | 387 | `47985c88d071578c2bd1b9b1dff1af5f` | same | ✅ |
| 10 | function ACLs (all) | 387 | `5857e29ed9d9f0e259ea5973952d0eb2` | `9beca76404e04ddb5196e079b113b03d` | ❌ |
| 11 | function ACLs (explicit only) | 363 / 387 | `06fbc76c92f63b45f1a686a10240b3f5` | `9beca76404e04ddb5196e079b113b03d` | ❌ |

**Ten of eleven fingerprints are byte-identical across the two lanes.** Schema, functions, policies,
constraints and RLS are the same. The only divergence is function privileges — exactly as the ACL
remediation generator (revision 2) predicted.

### A hash discrepancy, investigated rather than smoothed over

The earlier ACL generator header recorded `production 98cf2cebc05a12a86d538401c030f770` and
`staging 9beca76404e04ddb5196e079b113b03d` for the function-ACL fingerprint. Today's staging value
**reproduces exactly**; today's production value **does not**.

That is two instruments disagreeing about production, which is HS-4 territory. It was resolved by
measuring five independent counters that do not depend on the hash expression at all:

| Counter | Production today | Earlier record | Staging today | Earlier record |
|---|---|---|---|---|
| NULL `proacl` | 24 | 24 | 0 | 0 |
| explicit ACL | 363 | (363) | 387 | (387) |
| explicit denying `anon` | **82** | 82 | **6** | 6 |
| explicit denying `authenticated` | **55** | 55 | **3** | 3 |
| explicit EXECUTE to PUBLIC | **222** | 222 | **246** | 246 |

**All five reproduce.** Production's ACL state is therefore unchanged since the earlier measurement,
and the differing hash is an artefact of a different aggregation expression — not drift.
**HS-4 does not fire.** Delta confirmed: **anon 82 − 6 = 76 functions · authenticated 55 − 3 = 52.**

**Consequence for step 4.6:** the ACL remediation target is unchanged and the generator revision 2 is
still correct as written. The post-remediation assertion remains the **explicit-only** fingerprint
(row 11), because production's 24 NULL-`proacl` extension functions make row 10 unable to converge.

### The recipe (reuse verbatim)

Each fingerprint is `md5(string_agg(<expr>, ',' ORDER BY <key>))` over `nspname='public'`:
tables `relname` for `relkind in ('r','p')` · columns `table.column:type:nullable:default` ·
functions `proname(identity_args)` · indexes `indexname:indexdef` · triggers `tgname:relname`
(non-internal) · policies `policyname:tablename:cmd:qual:with_check` · constraints
`conname:contype::text:constraintdef` · RLS `relname:relrowsecurity:relforcerowsecurity` ·
bodies `pg_get_functiondef(oid)` for `prokind in ('f','p')` · ACLs
`proname(args)=array_to_string(proacl,',')`, with `coalesce(…,'DEFAULT')` for row 10 and
`proacl is not null` for row 11.

---

## 0.4 — ERROR-RATE BASELINE

Two one-hour windows, production project, so §18 has a real comparison rather than a judgement.

| Source | 2026-08-26 09:00–10:00Z | 2026-08-25 09:00–10:00Z (same hour, previous day) |
|---|---|---|
| `edge_logs` total | 1637 | 2432 |
| `edge_logs` 2xx/3xx | 200×1618, 204×14, 201×5 | 200×2347, 204×34, 201×19, 304×6 |
| `edge_logs` 4xx | **0** | **27** (403×25, 401×1, 409×1) |
| `edge_logs` 5xx | 0 | 0 |
| `function_edge_logs` total | 440 | 456 |
| `function_edge_logs` 5xx | **3 × 502** | **3 × 502** |
| `postgres_logs` total | 2322 | 2323 |
| `postgres_logs` severity | LOG ×2322, ERROR ×0 | LOG ×2320, **ERROR ×3** |

The extractor was validated before these numbers were recorded: a status-code distribution was pulled
first to confirm that "0 × 4xx" is a real count and not a failed key lookup.

**Standing item:** `function_edge_logs` carries **3 × 502 in both windows**. That is a pre-existing
condition, not something this release introduces — but it means "3 × 502" is the baseline, and §18
must not read three 502s after promotion as a new fault.

---

## 0.6 — EDGE FUNCTION BASELINE (71 rows)

All 71 production edge functions are status **ACTIVE**. `verify_jwt`: 45 true, 26 false.

### The G9 / CORS question is now closed on the evidence, not by inference

The hardened `_shared/secureHeaders.ts` was authored **2026-08-24 11:53 UTC** (commit `9f3d20a`).

**Exactly one** production function has been deployed at or after that instant:

- `send-gift-credit` v23, deployed **2026-08-24 15:00:42Z** — and its deployed source was read directly
  in an earlier session and confirmed to carry the **old prefix-matching** implementation, because it
  was deployed from a pre-G9 branch.

**Every other function was last deployed on or before 2026-08-20 11:03:32Z** — four days before the
hardened file existed. A deployment cannot contain a file that had not yet been written. That is a
logical impossibility, not a timestamp inference, so the earlier "1 read, 70 inferred" caveat is
retired.

> **Finding: 71 of 71 production edge functions run a pre-G9 CORS implementation. Zero carry the
> hardening.** If decision 1.3 rules **(A) INCLUDED**, Phase 10 must redeploy, and step 4.11's
> inventory must be filled by reading deployed sources *after* that redeploy. If it rules
> **(B) EXCLUDED**, this is the residual risk the §14 ruling has to name explicitly.

### Full baseline — sorted newest deployment first

| Function | Version | Deployed (UTC) | verify_jwt |
|---|---|---|---|
| send-gift-credit | 23 | 2026-08-24 15:00:42Z | yes |
| media-register-upload | 6 | 2026-08-20 11:03:32Z | no |
| migrate-post-media | 6 | 2026-08-20 07:43:46Z | yes |
| measure-post-media | 6 | 2026-08-20 06:09:13Z | yes |
| publish-scheduled-posts | 27 | 2026-08-20 05:35:43Z | yes |
| detect-orphan-files | 28 | 2026-08-19 18:01:25Z | yes |
| backfill-image-dims | 5 | 2026-08-14 17:49:50Z | yes |
| purge-s3-orphans | 24 | 2026-08-14 16:39:41Z | yes |
| delete-user | 27 | 2026-08-10 13:22:00Z | yes |
| delete-my-account | 11 | 2026-08-10 13:19:37Z | yes |
| seo-route-metadata | 23 | 2026-08-09 16:38:21Z | no |
| dashboard-init | 24 | 2026-08-05 02:21:00Z | no |
| send-broadcast-push | 6 | 2026-08-01 09:25:26Z | no |
| ask-anything | 29 | 2026-07-30 09:36:24Z | no |
| translate-text | 6 | 2026-07-29 02:45:57Z | yes |
| send-reengagement-emails | 25 | 2026-07-25 09:06:35Z | yes |
| send-transactional-email | 26 | 2026-07-25 07:46:04Z | yes |
| auth-email-hook | 23 | 2026-07-25 03:17:47Z | no |
| process-email-queue | 27 | 2026-07-25 03:07:54Z | yes |
| ad-reward-credit | 6 | 2026-07-23 15:18:46Z | no |
| ga-report | 8 | 2026-07-23 13:22:26Z | no |
| submit-judge-comment | 23 | 2026-07-22 14:07:25Z | yes |
| submit-judge-tag | 25 | 2026-07-22 14:07:23Z | yes |
| submit-judge-decision | 23 | 2026-07-22 14:04:38Z | yes |
| submit-judge-score | 25 | 2026-07-22 14:04:37Z | no |
| complete-round | 27 | 2026-07-20 16:34:11Z | no |
| preview-transactional-email | 24 | 2026-07-19 18:22:18Z | no |
| send-push | 11 | 2026-07-19 12:33:55Z | no |
| sitemap | 25 | 2026-07-19 07:50:49Z | no |
| autoscale-ad-traffic | 23 | 2026-07-17 12:00:25Z | yes |
| hard-delete-competition | 23 | 2026-07-17 11:52:52Z | yes |
| rank-feed | 25 | 2026-07-17 11:47:42Z | no |
| moderate-comment | 25 | 2026-07-17 10:21:51Z | yes |
| backfill-thumbnails | 25 | 2026-07-17 10:21:49Z | yes |
| s3-signed-url | 23 | 2026-07-17 10:21:48Z | yes |
| manage-notifications | 23 | 2026-07-17 10:21:46Z | yes |
| fix-cache-headers | 23 | 2026-07-17 10:21:24Z | yes |
| apply-scheduled-boosts | 23 | 2026-07-16 08:28:15Z | yes |
| expire-gift-credits | 23 | 2026-07-15 14:03:06Z | yes |
| publish-round | 23 | 2026-07-15 10:25:00Z | yes |
| backfill-image-hashes | 23 | 2026-07-15 07:40:31Z | yes |
| brevo-webhook | 13 | 2026-07-13 12:58:47Z | no |
| detect-ai-image | 24 | 2026-07-13 08:38:40Z | no |
| analyze-gallery-image | 24 | 2026-07-13 08:38:39Z | yes |
| admin-export-db | 24 | 2026-07-12 16:20:31Z | yes |
| entry-final-votes | 23 | 2026-07-11 04:23:11Z | yes |
| verify-image-hash | 22 | 2026-07-09 11:04:00Z | yes |
| verify-email-provider | 22 | 2026-07-09 11:03:59Z | yes |
| test-smtp | 22 | 2026-07-09 11:03:58Z | yes |
| submit-deposit | 22 | 2026-07-09 11:03:51Z | yes |
| seo-crawler-verify | 22 | 2026-07-09 11:03:47Z | yes |
| s3-upload | 22 | 2026-07-09 11:03:38Z | no |
| s3-presign-upload | 22 | 2026-07-09 11:03:35Z | no |
| s3-delete | 22 | 2026-07-09 11:03:33Z | no |
| razorpay-verify-payment | 22 | 2026-07-09 11:03:31Z | yes |
| paypal-capture-order | 22 | 2026-07-09 11:03:14Z | yes |
| migrate-storage | 22 | 2026-07-09 11:03:12Z | no |
| judging-invariants-nightly | 22 | 2026-07-09 11:03:10Z | yes |
| judge-session-resume | 22 | 2026-07-09 11:03:05Z | no |
| handle-email-unsubscribe | 22 | 2026-07-09 11:03:02Z | no |
| handle-email-suppression | 22 | 2026-07-09 11:03:00Z | no |
| get-wallet-transactions | 22 | 2026-07-09 11:02:58Z | yes |
| get-wallet-summary | 22 | 2026-07-09 11:02:55Z | yes |
| get-payment-gateways-public | 22 | 2026-07-09 11:02:54Z | no |
| evaluate-round2 | 22 | 2026-07-09 11:02:49Z | yes |
| diagnose-brevo-key | 22 | 2026-07-09 11:02:46Z | yes |
| create-payment-session | 22 | 2026-07-09 11:02:32Z | no |
| cast-photo-vote | 22 | 2026-07-09 11:02:28Z | no |
| backup-reminder | 22 | 2026-07-09 11:02:27Z | yes |
| admin-secure-settings | 23 | 2026-07-09 11:02:07Z | yes |
| admin-process-withdrawal | 22 | 2026-07-09 11:02:05Z | yes |

---

## 0.9 — R2 (partial)

| Bucket | Created | Lane |
|---|---|---|
| `50mm` | 2026-03-07T12:19:15Z | production |
| `50mm-staging` | 2026-08-21T19:22:35Z | staging |
| `agentcrm` | 2025-12-11T13:17:22Z | unrelated to this project |

Bucket-level lane separation confirmed. **Not captured:** per-bucket public access, CORS policy and
custom domain bindings. Step 4.7 (G8 freshness) needs those.

---

## 0.0 — THE TEN-SURFACE PRODUCTION INVENTORY (DRAFT — OWNER MUST CONFIRM)

Phase 9 step 9.5 reconciles against this exact table and must end with the literal line
*"Expected changes: N. Unexpected changes: 0."* A surface not listed here cannot later be explained
away as in scope all along.

| # | Surface | Expected to change? | Basis |
|---|---|---|---|
| 1 | git `main` | **YES** | the promotion merge at step 8.5 is the release |
| 2 | Cloudflare Pages configuration | **NO** | no config change is part of this release |
| 3 | Pages environment variables | **NO** | the ten above must be byte-identical after promotion (C2 link 6) |
| 4 | Edge functions and versions | **ONLY IF decision 1.3 = (A)** | Phase 10 only; merging the tree does not redeploy them |
| 5 | R2 | **NO** | no bucket, policy or binding change is in scope |
| 6 | Supabase database / schema | **NO for production in this phase** | the five release migrations are already applied to both lanes; step 4.6 writes **staging only** |
| 7 | DNS | **NO** | no record change is in scope |
| 8 | Zero Trust | **NO** | no policy change is in scope |
| 9 | GitHub rulesets | **NO** | `protect-main` is re-attested at 8.3, not modified |
| 10 | GitHub environments / secrets | **DEPENDS ON HS-10 (step 1.1)** | if the ruling is that rotation is required, this surface changes and needs its own ledger entry |

Rows 4 and 10 are deliberately conditional: they resolve when decisions 1.3 and 1.1 are made.
Row 1 of the ledger should record that step **4.3 changes `main`'s CI workflow** — that is a real
change to the default branch, classified under §16, and it happens before the freeze.

---

## WHAT IS STILL OUTSTANDING IN PHASE 0

| Item | Why it matters | What is needed |
|---|---|---|
| Byte-exact sha256 of `robots.txt` and `_headers` as served | §18 compares served bytes | a raw fetch — `curl -s <url> \| sha256sum` — or browser devtools |
| `sitemap.xml` body | §18 SEO row | a fetch |
| Apex → www redirect status code | §18 origin row | a status-code-visible fetch |
| 0.7 GitHub ruleset, environments, secret **names** | §17-7 re-attestation and the row-10 inventory | dashboard read |
| 0.8 DNS records + Zero Trust applications and policies | rows 7 and 8 of the inventory | dashboard read |
| 0.9 R2 per-bucket CORS, public access, custom domains | step 4.7 G8 freshness | dashboard read |

None of these blocks Phase 1, which is entirely owner decisions. They must all exist before Phase 2.

---

## PHASE 1 IS NOW THE CRITICAL PATH

Phase 0 is read-only and mostly done. **Nothing further can proceed without the four owner decisions**,
and one of them is a live hard stop:

1. **1.1 — HS-10 rotation proof** (control C5). Five fields required: whether rotation occurred; which
   secret class; the completion timestamp; confirmation the **old credential is invalid or revoked**
   (tested, not assumed); confirmation no replacement value appears in repo, logs, CI output,
   screenshots or release artefacts. **Never record the value.** §17-3 fails until this exists, and
   §17-3 gates the entire checklist.
2. **1.2 — Staging email policy** (§8.8).
3. **1.3 — G9 / CORS scope** (control C4): **(A) INCLUDED** or **(B) EXCLUDED** with a written §14
   ruling naming the residual risk. Phase 0 has now established that the risk is **all 71 production
   functions**, not an unknown subset.
4. **1.4 — Schema-guard mechanism**: (A) rewrite to derive target from `github.base_ref` and make it a
   required check, or (B) keep it dispatch-only as a mandatory §12.4 procedural step.

---

*Phase 0 executed 2026-08-26 by the Cowork session. Read-only throughout: no production write, no
staging write, no repository write. Two JWT values were observed on screen and deliberately not
transcribed, hashed or partially displayed.*
