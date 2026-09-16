# WEB STAGING · GATE 1 — EXECUTION REPORT
**2026-08-21 · Status: AMBER — everything technically executable from this session is DONE
and PROVEN; two boundaries remain, both yours, both exactly specified below.**
Production untouched throughout (verified live at the end). Staging NOT created (rule held).

## 1 · Everything Claude performed (CLAUDE CAN DO → done)

1. **Cloned the repository** (read access works through the session proxy) at pinned HEAD
   `c737de9`, verified against `git ls-remote` live.
2. **Proved the blocker on the real build:** env-less build of unmodified HEAD → the
   production ref appears **14×** in the bundle. The committed `.env` was the silent default.
3. **Implemented the approved isolation change** — commit `cf3eb6a` on branch
   `staging/web-isolation-guard` (13 files, +224/−17):
   - `.env` **deleted**; `.env.example` added; `.gitignore` covers all env files
   - `index.html` → `%VITE_SUPABASE_URL%` interpolation (both link tags)
   - **Two hardcodes the pre-flight could not see, caught by the guard on the first real
     build and fixed:** `src/lib/reportImageError.ts` (host list) and
     `src/components/admin/CloudflareEdgeChecklist.tsx` (admin reference values) — both now
     derive from build env
   - `public/_redirects` (a committed production artifact) **replaced by build-time
     generation** (`scripts/generate-redirects.mjs`, refuses to emit without env)
   - Guard `scripts/verify-bundle-isolation.mjs` (R1–R5, fail-closed) — **scanner widened to
     extensionless files** after `_redirects` exposed that blind spot
   - Harness `scripts/test-isolation-guard.mjs` — 8 baseline cases + 6 mutations
   - `vitest.config.ts` — hermetic synthetic test env (the suite had silently depended on
     the committed `.env`: env-less run = **19 failed files** before, **2261/2261 green** after)
   - `web-build.yml` — guard self-test + production-lane guard steps
4. **Real-bundle proof matrix (your item 11 — not fixtures):**
   | build | env | result |
   |---|---|---|
   | A | none | **fails closed at the build step itself** (generate-redirects refuses; no dist) |
   | B | production | **GUARD PASS** — 263 assets scanned, expected ref present, staging ref absent, `_redirects` correct |
   | C | synthetic staging | **0 production-ref occurrences in the entire bundle**; GUARD PASS |
5. **Local CI-equivalent gates:**
   | gate | result |
   |---|---|
   | typecheck (`tsc --noEmit -p tsconfig.app.json`, exact CI command) | **0 errors** |
   | full test suite, synthetic env | **2261 passed / 1 skipped / 0 failed** |
   | full test suite, zero env (hermeticity) | **2261 passed** (after vitest env fix) |
   | guard harness | baseline 8/8 · **mutations 6/6** (4 kill incl. new W6 scan-narrowing; W4/W5 equivalent mutants retargeted to fail-closed-under-mutation per standing rule 9) |
   | eslint (touched files) | 3 errors — **all pre-existing at HEAD** (verified by stash-lint), line-shifted only; eslint is not one of the 7 CI gates; not fixed (scope) |
   | UI gate (`ui:gate`) | **NOT RUN here** — needs the uishot harness server; runs in CI on push. NOT VERIFIED locally, stated as such |
6. **Commit + branch created locally**; patch exported (`0001-web-environment-isolation-….patch`).
7. **Production baseline verified live:** `www.50mmretina.com` loads and functions normally
   (title + content confirmed). Nothing production-side was modified at any point.
8. Bonus intel: the production Pages project is **`lens-lustre-learn-claude`**
   (`lens-lustre-learn-claude.pages.dev`, from the repo's own edge checklist).

## 2 · What Claude cannot do (CLAUDE CANNOT DO → your exact actions)

### BOUNDARY 1 — repo write. Empirically tested, not assumed:
`git push` (new branch only, `main` never touched) → **403**:
*"access denied by the git proxy: altisinfonet/lens-lustre-learn-Claude is not in this
session's authorized repository set… To fix, add the repository to the session's sources."*
**Your action (one time):** in this Claude session's settings, under GitHub /
source-repository access, **add `altisinfonet/lens-lustre-learn-Claude` to the session's
sources** (grant write). Then say "push it" — I push the branch, open the PR, watch all 7 CI
gates + the 2 new guard steps, and stop before merge for your approval. **Fallback** if that
setting isn't available to you: the exported patch file is the complete change; a Chrome
session together can land it via the web UI with the §4 blob SHAs.

### BOUNDARY 2 — Cloudflare Pages env vars (no Pages tools exist in the connector):
**Where to click:** dash.cloudflare.com → **Workers & Pages** → project
**`lens-lustre-learn-claude`** → **Settings** → **Variables and Secrets** →
**Production** environment → add these three (all **NON-SECRET** — the URL and publishable
key are public by design and already visible in today's live bundle; the secret kind of key,
`service_role`, is NOT involved anywhere here):
| name | value | secret? |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://jtdtehuqtinjxropkkcn.supabase.co` | no |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the value from the old `.env` — I can print it on request; it is the public anon key | no |
| `VITE_SUPABASE_PROJECT_ID` | `jtdtehuqtinjxropkkcn` | no |
Then **Settings → Build** → change **Build command** to:
`npm run build && node scripts/verify-bundle-isolation.mjs`
**Verify afterward:** the three names appear under Production; build command shows the guard.
**MUST NOT change:** production branch (`main`), build output directory, custom domain,
anything under the Preview column, and do not touch any other project.
**ORDER RULE (the one outage risk): do this BEFORE the PR merges.** Doing it early is
harmless — the current build ignores the vars until `.env` is gone.

## 3 · Hashes / commits
Branch `staging/web-isolation-guard`, commit **`cf3eb6a`** on parent `c737de9`. Blob SHAs:
`verify-bundle-isolation.mjs 8ef75fc2…3d3c` · `test-isolation-guard.mjs 0c15db00…b879` ·
`generate-redirects.mjs 4f837220…6349` · `.env.example ea9e464f…96f9` · `vitest.config.ts
1caacb4e…217d` · `index.html 0a1ed669…2df` · `reportImageError.ts 631a0b83…859b` ·
`CloudflareEdgeChecklist.tsx 88a2c746…9043` · `web-build.yml 2fb4aa82…6836` ·
`package.json 77ba1cc5…9adf` · `.gitignore c635d1ac…2066`.

## 4 · Gate-1 remaining sequence
1. You: Boundary 1 (add repo to session sources) and Boundary 2 (Pages vars, order rule).
2. Me: push → PR → all CI gates green (any red = STOP) → hold for your merge approval.
3. You (or me if the UI permits via session): merge.
4. Me: verify the production Pages deploy log shows `ISOLATION-GUARD PASS`, live site loads,
   still on production Supabase → **Gate 1 GREEN**.
**Staging infrastructure remains NOT AUTHORIZED until that GREEN.** No staging resource was
created. No Phase 1–5 or Judging Panel work was performed.
