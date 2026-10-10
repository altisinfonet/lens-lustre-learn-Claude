# G4 — FINAL VERIFICATION (after correction `a9f5b80`)

Verified 2026-08-22 16:10 UTC by rebuilding **both lanes locally with the exact CI
environment variables** and censusing the emitted bytes.

# G4 = **GREEN**

## Commit

`staging` = `a9f5b80e0dc73a1ab78363076c0ba7bcd4273201`, tree
`e2b6426cb6df9ad7646b58c2847127b43c4ff4c8`.
`origin/main` = `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` — unchanged.

Correction touched exactly **3 files**: `.github/workflows/web-build.yml`,
`public/_headers`, `scripts/generate-headers.mjs`.

## 1 · ACAO — production behaviour preserved, proven by hash

| lane | serving origin | ACAO before correction | ACAO after |
|---|---|---|---|
| production | `https://www.50mmretina.com` | `https://www.50mmretina.com` ✗ | **`https://50mmretina.com`** ✓ |
| staging | `https://staging.50mmretina.com` | — | `https://staging.50mmretina.com` ✓ |

```
sha256 main's committed public/_headers : 40b681e53735875f42dbb5746a91b9f08fca4d693698df0bf75fc4f0ee9109f0
sha256 generated production _headers    : 40b681e53735875f42dbb5746a91b9f08fca4d693698df0bf75fc4f0ee9109f0
                                          BYTE-IDENTICAL
```

Stronger than the "banner aside" allowance that was granted. The code session
found that its own banner placeholders were being substituted, carrying lane
hostnames into a comment in every shipped artifact, and stripped template-only
lines rather than accept the looser standard. It also removed the generator's
duplicated production constants so `lane-config.mjs` is the single source.

**The literal instruction was correctly refused.** Setting production
`VITE_SITE_ORIGIN` to the apex would have made `index.html` compute
`apex=""` and **disable the apex→www redirect**, re-opening the 2026-08-05
incident where bare-domain visitors saw a logged-out copy of the site. Verified
by executing the derivation, not by reading it.

## 2 · CI lane variables — verified by parsing the YAML

| | `build-production` | `build-staging` |
|---|---|---|
| `environment:` key | **absent** ✓ | **absent** ✓ |
| `VITE_CDN_HOST` | `cdn.50mmretina.com` | `cdn-staging.50mmretina.com` |
| `VITE_SITE_ORIGIN` | `https://www.50mmretina.com` | `https://staging.50mmretina.com` |
| `ISOLATION_FORBIDDEN_REFS` | `ztzutckwdhetphwghuzj` | `jtdtehuqtinjxropkkcn` |
| `VITE_SUPABASE_URL` | production | staging |

Plain job-level literals — no repository secrets, no deployment environments.
Staging states its values explicitly rather than inheriting.

## 3 · Bundle census — built here with the CI env

| token | staging dist | production dist |
|---|---|---|
| `cdn.50mmretina.com` | **0** | 3 |
| `www.50mmretina.com` | **0** | 4 |
| `jtdtehuqtinjxropkkcn` | **0** | 13 |
| `https://50mmretina.com` | **0** | present |
| `ztzutckwdhetphwghuzj` | 13 | **0** |
| `cdn-staging.50mmretina.com` | 3 | **0** |
| `staging.50mmretina.com` | 21 | **0** |

Staging's only bare `50mmretina.com` survivors: `mail@`, `mailto:mail@`,
`noreply@` — the email allowance, exactly as specified.

## 4 · Guards and cross-lane negatives — on real artefacts

```
staging own lane      PASS  expected=ztzutckwdhetphwghuzj forbidden=[jtdtehuqtinjxropkkcn] absent  263 assets
production own lane   PASS  expected=jtdtehuqtinjxropkkcn forbidden=[ztzutckwdhetphwghuzj] absent  263 assets
production guard vs staging bundle   FAIL R3  ztzutckwdhetphwghuzj in index.html
staging guard vs production bundle   FAIL R3  jtdtehuqtinjxropkkcn in index.html
```

Both directions actively rejected. Mutation harness **7/7 under both lanes'** CI
variables.

## 5 · CI on `a9f5b80` — all four green

| Workflow | Run | Result |
|---|---|---|
| Web build | 32582973908 | ✅ lane-guard success · staging build success · **production skipped** |
| Typecheck | 32582973861 | ✅ |
| Security | 32582973866 | ✅ |
| UI gate | 32582973894 | ✅ 148 scene/viewport sweep, baseline clean |

The UI gate matters here: the staging lane now renders `cdn-staging` and
`staging.50mmretina.com` into the QR card, profile address, edit-profile URL
editor and admin checklist. A wrong derivation would have shown as a baseline
diff. It did not.

## 6 · Production safety

16:10:42 UTC — 146 tables · 102 users · vault `b24756b6dc7da53fe1a885b25e241ed7` ·
16 cron jobs · 11 buckets · ledger 32 · posts 270 (unchanged since 15:36) ·
`s3_storage_settings` `2026-03-07 13:48:18` on `50mm`. No Cloudflare, Supabase,
R2 or Edge Function mutation. No DNS created.

## Open items — none block G5

1. **DNS**: `staging.50mmretina.com` and `cdn-staging.50mmretina.com` remain
   NXDOMAIN by instruction. Prerequisites for the staging Pages / R2 gate.
   Staging builds reference hosts that do not resolve yet — expected here.
2. **G9 hard prerequisite**: `supabase/functions/_shared/secureHeaders.ts:7-8` is a
   CORS allow-list holding only the two production origins. Once staging edge
   functions deploy, every preflight from `staging.50mmretina.com` is refused and
   the staging app does not function. Determined by reading the allow-list, not
   assumed.
3. **G9**: 17 email templates hardcode the production origin
   (`/dashboard` ×13, bare ×7, `/feed` ×1), plus the policy question of whether a
   staging lane should send email at all.
4. **Owner cleanup**: `scratch/lane-check-g3` and PR #88 — ref deletion 403s from
   both sessions.
5. **Standing from G2**: `main` has no branch protection. This gates the G10
   promotion path and needs the browser.
6. **Policy**: staging's sitemap is now valid-for-its-lane; a staging lane
   probably wants `Disallow: /` instead.
