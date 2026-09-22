# G4 — INDEPENDENT VERIFICATION

Verified 2026-08-22 15:36 UTC by building **both lanes locally** and censusing the
emitted bytes, not by reading the code session's greps.

# G4 = **AMBER** — one unflagged production behaviour change

Everything G4 set out to do is done and verified. One line changes production
behaviour and was not declared. It does not reach production until promotion
(G10), so there is no urgency — but it must be settled before then.

## The finding

`public/_headers` on `main` served:

```
Access-Control-Allow-Origin: https://50mmretina.com        <- apex
```

The generated production `_headers` now emits:

```
Access-Control-Allow-Origin: https://www.50mmretina.com    <- www
```

Everything else in the file is byte-identical; the only other diff is the added
template banner. `sitemap.xml` and `robots.txt` regenerate **byte-identical** to
what `main` ships.

This matters because it contradicts the principle the code session applied
correctly two lines earlier. It preserved apex-ness for canonicals and the
sitemap precisely so an SEO change would not be "smuggled in under a
de-hardcoding commit" — then derived CORS from the www-form origin and did not
notice. The reasoning was right; it just was not applied to every consumer of the
origin.

The new value may well be the *more correct* one: the site is served on `www`, so
a browser on `www` sends `Origin: https://www.50mmretina.com` and the old apex
value would not match it. That is an argument for making the change deliberately,
not for making it silently.

**Resolution — owner's call, before G10:**
either derive ACAO from the apex display form so production stays byte-identical,
or accept www as a deliberate CORS fix recorded as its own decision.

## Verified GREEN

| Check | Result |
|---|---|
| `origin/main` | `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` — unchanged |
| `origin/staging` | `9a89aadf7ae2484c36497f1938e2e902e537ac5c`, tree `a7aa0dd680ab89981685c38f3bc5660922ceb974` |
| Files changed vs `main` | 43 = 33 (G4) + 10 (G3) |
| Production literals in shipped `src/` code | **zero** |

**Staging bundle census** (built here): `cdn.50mmretina.com` 0 · `www.50mmretina.com` 0 ·
`jtdtehuqtinjxropkkcn` 0 · `https://50mmretina.com` 0 · `ztzutckwdhetphwghuzj` 13 ·
`cdn-staging.50mmretina.com` 4 · `staging.50mmretina.com` 23.
The only bare `50mmretina.com` strings are `mail@` ×2 and `noreply@` ×1 — the
email allowance.

**Production bundle census**: `cdn.50mmretina.com` 4 · `www.50mmretina.com` 3 ·
`jtdtehuqtinjxropkkcn` 13 · `ztzutckwdhetphwghuzj` 0 · `cdn-staging` 0 ·
`staging.50mmretina.com` 0.

**Guards on the real bundles**, 263 assets each:
```
staging     PASS expected=ztzutckwdhetphwghuzj forbidden=[jtdtehuqtinjxropkkcn] absent
production  PASS expected=jtdtehuqtinjxropkkcn forbidden=[ztzutckwdhetphwghuzj] absent
```

**Cross-lane negative — each guard pointed at the other lane's bundle:**
```
production guard vs staging dist  -> FAIL R3: ztzutckwdhetphwghuzj in index.html
staging guard vs production dist  -> FAIL R3: jtdtehuqtinjxropkkcn in index.html
```
Both directions actively rejected, on real artefacts.

**Harness** under both lanes' CI variables: **7/7** and **7/7**.
**`laneIsolation.test.ts`**: 11/11.

**Production Supabase** 15:36:50 UTC — 146 tables · 102 users · vault
`b24756b6dc7da53fe1a885b25e241ed7` · 16 cron jobs · 11 buckets · ledger 32 ·
`s3_storage_settings` `2026-03-07 13:48:18` on `50mm`. `posts` 268 → **270**:
organic member activity over four hours, same class as every prior drift.

## Judgement on the code session's three scope extensions

All three were correct calls.

1. **`define` in `vite.config.ts`** — without it the production fallback literals
   ship in every bundle and the acceptance test cannot pass. Necessary.
2. **The eight extra origin sites** — `publicUrl.ts` backs every copy-link path;
   staging would have put production URLs on members' clipboards.
3. **`sitemap.xml` / `robots.txt` generated per lane** — taken without asking, and
   the right call. A sitemap is an instruction to a crawler; a staging deploy
   would have actively submitted production URLs for indexing from a
   non-production host. Same class as `_headers`, which was already authorised.

## Open items

1. **`VITE_CDN_HOST` / `VITE_SITE_ORIGIN` are not yet in `web-build.yml`'s staging
   lane** — the plumbing is inert until wired, and staging silently builds with
   production addresses. Values used throughout: `cdn-staging.50mmretina.com`,
   `https://staging.50mmretina.com`. **Neither exists in DNS** (both NXDOMAIN as of
   G1). Confirm before wiring.
2. **The ACAO apex/www decision above.**
3. `scratch/lane-check-g3` and **PR #88** — ref deletion 403s from both sessions.
4. **`main` has no branch protection** (G2 step 3, never completed) — this gates
   the G10 promotion path.
5. Carry-forward to G9: `secureHeaders.ts` + ~14 email templates hardcode the
   production origin.
6. Policy: staging's sitemap is now valid-for-its-lane, which is not the same as
   wanted. A staging lane probably wants `Disallow: /`.
