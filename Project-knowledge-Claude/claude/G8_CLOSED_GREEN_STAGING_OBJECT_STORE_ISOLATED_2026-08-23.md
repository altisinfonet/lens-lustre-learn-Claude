# G8 — CLOSED GREEN · staging object store bound and lane-isolated

**Verdict: G8 = GREEN — COMPLETE.** 2026-08-23.
`origin/staging` = `87aa5eac20fc7d2822553a05a24a50db0da5adee`, tree
`5580331acc1c21fd840b8d0bf979a5d85c965779` (identical to PR #92 head `220b924`).
`origin/main` = `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` — **untouched**.

## 1. Exit conditions

| # | Condition | Evidence | Class |
|---|---|---|---|
| 1 | `50mm-staging` exists | `r2_buckets_list`: `50mm` (APAC, 2026-03-07), `50mm-staging` (ENAM, 2026-08-21), `agentcrm` | VERIFIED |
| 2 | `cdn-staging.50mmretina.com` bound to `50mm-staging` via Cloudflare's own flow | R2-managed DNS row, content `50mm-staging`, Proxied, view-only; record count 18→19; no existing record replaced | VERIFIED (owner-read) |
| 3 | Hostname resolves | Same Cloudflare IPs as `cdn`/`staging`; known-absent control NXDOMAIN in the same run | VERIFIED |
| 4 | HTTPS serves | TLS terminates; real object returns 200 with body `g8` | VERIFIED |
| 5 | **A real staging asset is retrieved through the CDN** | `GET https://cdn-staging.50mmretina.com/g8-probe.txt` → body `g8` | VERIFIED — runtime, not configuration |
| 6 | **Read isolation, both directions** | see §2 | VERIFIED |
| 7 | **Write isolation is a control, not an accident** | see §3 | VERIFIED |
| 8 | Reverse direction: production must not write to `50mm-staging` | `assertStorageLane` refuses production-ref + `50mm-staging`; proven in Deno and in vitest | VERIFIED |
| 9 | Production R2 untouched | `cdn.50mmretina.com` still serves `50mm`; bucket `50mm` never opened; `r2.dev` left disabled on `50mm-staging` | VERIFIED |
| 10 | WAF carve-out reverted | Expression back to `(http.host eq "staging.50mmretina.com" and cf.client.bot)`, Active | VERIFIED (owner-read) |

## 2. Read isolation — the full 2×2, with controls on both axes

| Probe | staging CDN | production CDN |
|---|---|---|
| `g8-probe.txt` (exists only in `50mm-staging`) | **served, body `g8`** | **404** |
| `site-assets/seo/1775321074863-k3b5rusybos.jpg` (exists only in `50mm`) | **404** | **served** |
| `g8-known-absent-control.txt` (exists in neither) | 404 | 404 |

Each CDN serves its own bucket and only its own. The known-absent row is what
makes the 404s mean "not in this bucket" rather than "this host is broken".

## 3. Write isolation — why the obvious evidence was refused

Staging's `site_settings` table is EMPTY — 0 rows on a table that exists
(control: the count query returned a row). The write path fails closed at
`if (!settingsRow?.value) return "S3 storage not configured"`.

**That was rejected as the exit condition.** It is a fact about sequencing, not
a control, and G9's first act is to populate that very row. R2 credentials are
a database row, not environment variables, so no build-time guard can ever see
them: `verify-bundle-isolation.mjs` scans `dist` and `functions/`, never
`supabase/functions/`, and never the database.

`assertStorageLane` (`_shared/s3.ts`, merged at `87aa5ea`) refuses when the
Supabase project ref and the resolved bucket belong to different lanes,
symmetrically — a non-production lane must not name bucket `50mm` or the
production CDN host; the production lane must not name anything but `50mm`.

**Bucket comparison is equality; CDN-host comparison is substring — deliberately
opposite.** `bucket_name` is a bare identifier where `50mm` is a prefix of
`50mm-staging`, so `includes` would flag the staging lane on its own bucket (the
trap R9 exists for). `endpoint`/`public_url` are URLs with the host inside them,
so equality would never match. Both directions are pinned by tests.

`PRODUCTION_BUCKET = "50mm"` was **measured**, not assumed — read from the live
production `site_settings` row (bucket name and `public_url` only; key presence
as booleans, no key values). A wrong literal here would have thrown on every
production storage call.

### Proven in the runtime it actually runs in

The assertion had only ever executed under vitest/Node. It was deployed as a
probe to the staging Supabase project and exercised in Deno:

```
deno_version   supabase-edge-runtime-1.74.3 (Deno v2.1.4)
lane_ref_seen  ztzutckwdhetphwghuzj      ← from the live environment, not a fixture
all_ok         true  (7/7)

this lane + bucket 50mm          REFUSED    this lane + its own bucket   passed
this lane + production CDN host  REFUSED    prefix trap 50mm-staging     passed
production ref + staging bucket  REFUSED    production ref + 50mm       passed
undeterminable lane              REFUSED
```

## 4. The structural finding G8 uncovered

`_shared/s3.ts` says it exists because parallel copies of the S3 code diverge
and "the divergent one is always the one that runs". Still true: **six functions
read `s3_storage_settings` directly and sign their own requests**, never
reaching `getS3Settings` — `s3-upload`, `s3-presign-upload`, `s3-signed-url`,
`s3-delete`, `migrate-storage`, `hard-delete-competition`. That is *every
signing path in the codebase*. Wiring the assertion into the shared accessor
protects six importers and **not one writer**.

They are now **pinned by a detector** that matches the query shape
`.eq("key", "s3_storage_settings")` rather than any mention of the string —
`measure-post-media` matches only inside a comment saying it deliberately never
reads that row, and a mention-based list would have enshrined that error.
A second pin covers the four mention-only functions.

**Proven live, not assumed:** planting a seventh function with the query shape
made the detector name `zz-planted-bypass` and fail; removing it restored 10/10.

## 5. Gate on the merged tree

`tsc` 0 errors · isolation guard **18/18** · seo-assets 15 cases **15/15** ·
`vitest` **2302 passed, 1 skipped** (166 files). R12 re-verified live on the
merged tree: forbidden host present with `ISOLATION_EXPECTED_HOST` unset now
`FAIL [R12]` (it previously PASSed), while the real staging lane still passes
with 271 assets across 2 roots.

## 6. Carried into G9 — open, named

1. **The six bypasses are pinned but unprotected.** Visible now; a seventh
   cannot appear quietly. Wiring them through `assertStorageLane` is G9 work.
2. **`CDN_HOST = "cdn.50mmretina.com"` is hardcoded** in
   `_shared/manifestPlan.ts` and `measure-post-media/index.ts`. The isolation
   guard cannot see `supabase/functions/` at all — a third surface carrying
   production literals with no rule watching it.
3. **Staging has zero edge functions deployed** (plus one retired probe).
4. **`secureHeaders.ts` CORS lists five production origins**, staging absent.
5. **17 email templates hardcode the production origin.**
6. **Cleanup:** delete `g8-storage-lane-probe` from the staging Supabase project
   (neutralised to 410 + JWT; this session has no delete capability) and remove
   `g8-probe.txt` from `50mm-staging`.

## 7. Correction to the record

A report during this gate stated `cdn-staging.50mmretina.com` was still
NXDOMAIN. It is not, and has not been since the R2 custom domain was connected:
it resolves to Cloudflare with a known-absent control failing in the same run,
and serves a real object over HTTPS.
