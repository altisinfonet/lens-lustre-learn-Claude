# G1 / G2 / G6 — closed from the production Pages deploy log

**Date:** 2026-08-24 · **Source:** owner-supplied Cloudflare Pages deployment record and build log for the
**live production** deployment. Provenance: owner-captured dashboard output.

---

## The deployment identified

```
Deployment ID   9c0c1201-41b4-4abf-9b5f-18598b5189d7
Aliases         50mmretina.com , www.50mmretina.com
Repository      altisinfonet/lens-lustre-learn-Claude
Branch          main @ 32930e7  "web: environment isolation — remove committed .env, add bundle-isolation guard (#87)"
Status          success · 1m 27s · 7:46AM 2026-08-22
Build command   npm run build && node scripts/verify-bundle-isolation.mjs
Output dir      /dist
```

`9c0c1201` is the deployment the G1 record flagged as an unremediated out-of-scope production change.
It is now identified: it is **the current live production deployment**, built from `main` at
`32930e7`, which is exactly the commit `origin/main` still points to. It is not an orphan or a stray —
it is the deployment serving the site. **G1 item resolved by identification: nothing to remediate.**

## G6 — the missing deploy-log guard line, CAPTURED

The single piece of evidence G6 was waiting on:

```
ISOLATION-GUARD PASS: expected=jtdtehuqtinjxropkkcn present; forbidden=[ztzutckwdhetphwghuzj] absent;
264 assets scanned.
```

The production lane's guard ran inside the Pages build that actually shipped, asserted the production
ref present and the staging ref **absent**, and passed. This is the production-side mirror of the
staging guard line and it was never previously captured. **G6 evidence closed.**

Note the scope: `264 assets scanned`, with no `supabase/functions` root — this build predates R13.
The current staging build scans `385 assets across 3 roots`. Production gains R13 coverage at G10.

## G6 — entry-chunk divergence, RESOLVED

The open question was which of `index-CQNRLXfL.js` / `index-DrppXY7Q.js` production serves. The log
answers it directly:

```
dist/assets/index-CQNRLXfL.js   1,565.90 kB │ gzip: 487.33 kB
```

Production serves **`index-CQNRLXfL.js`**. The divergence was between lanes, not a mystery within one.

## G2 — the deployment reading, TAKEN

G2's outstanding item was a dashboard reading of which build actually deployed. Taken above:
`main @ 32930e7`, deployment `9c0c1201`, success. The branch, commit and deployment now agree on the
record. **G2 item closed.**

## The `_redirects` defect — CONFIRMED LIVE IN PRODUCTION

The fix made on staging was justified by reasoning about Cloudflare's parser. The production log proves
it as measured fact:

```
generate-redirects OK: /sitemap.xml -> https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/sitemap
...
Parsed 0 valid redirect rules.
Found invalid redirect lines:
  - #1: /sitemap.xml  https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/sitemap  200
    Proxy (200) redirects can only point to relative paths.
Parsed 12 valid header rules.
```

The rule has never worked on either lane. `dist/sitemap.xml` is what has always been served. The fix
is on `staging` and reaches production at G10.

## Cloudflare Access — the allow-list does not exist

Owner reports Zero Trust Access is gated behind a paid plan and is not available on this account.
**Therefore there is no Access application in front of `staging.50mmretina.com`.** G1's "Access
allow-list never read" resolves to: *there is nothing to read.*

Consequence, recorded plainly rather than waved through: **staging is publicly reachable.** Its
protections are the non-indexing controls (robots, banner, `NON-PRODUCTION LANE` markers) proven at
G7 — not authentication. Anyone with the URL can reach it. Staging now holds 513 synthetic accounts
and no production data, so the exposure is of test content, not member data.

## NEW — two build defects visible in the log

**1. `svgo` is missing from the production build.** Eleven SVGs fail optimisation every build:

```
dist/avatars/fallback/f1..f5.svg , m1..m5.svg , placeholder.svg
  Cannot find package 'svgo' imported from vite-plugin-image-optimizer/dist/index.js
```

Those are the **fallback avatars** — the same assets whose absence was a visible staging defect
earlier today. They ship unoptimised rather than broken, so this is a size regression, not an outage.

**2. Node 20.20.0 is end-of-life in the production builder.**

```
WARNING: node-v20.20.0-linux-x64 is past its end of life and is now unsupported.
It no longer receives bug fixes or security updates.
```

Also worth recording: dependencies install with `bun install --frozen-lockfile`, while
`web-build.yml` — the CI job that exists to mirror the Pages build — uses `npm ci`. **The mirror does
not mirror the installer.** A lockfile divergence between bun and npm would not be caught by the
canary built to catch exactly that class of failure.

Neither is a G9 or G10 blocker. Both are recorded so they are not rediscovered as surprises.

## Branch protection

The repository's Branch protection page shows rules for `main` (applies to 1 branch), `staging`
(1 branch) and a stale `Main` (0 branches — a casing typo, matching nothing). A rule for `main`
therefore **exists**, which revises HS-12's "no branch protection" finding. What that rule *requires*
was not captured; §12.3 needs "no direct pushes", so the rule's contents still need one reading
before G10 promotes. The empty `Main` rule should be deleted so it cannot be mistaken for cover.

## Status after this record

| item | before | after |
|---|---|---|
| G1 — deployment `9c0c1201` unremediated | open | **identified as the live production deployment — nothing to remediate** |
| G1 — Access allow-list never read | open | **resolved: no Access application exists (paid feature); staging is public** |
| G2 — deployment reading never taken | open | **taken** |
| G6 — production deploy-log guard line | open | **captured** |
| G6 — entry-chunk divergence | open | **resolved: production serves `index-CQNRLXfL.js`** |
| `_redirects` invalid rule | inferred | **confirmed live in the production build log** |
| HS-12 — branch protection | "absent" | **a `main` rule exists; its contents still unread** |
| NEW — `svgo` missing, 11 SVGs unoptimised | — | recorded |
| NEW — Node 20 EOL in the production builder | — | recorded |
| NEW — Pages installs with bun, CI mirror uses npm | — | recorded |

`origin/main` untouched at `32930e75…`. **G10 not started.**
