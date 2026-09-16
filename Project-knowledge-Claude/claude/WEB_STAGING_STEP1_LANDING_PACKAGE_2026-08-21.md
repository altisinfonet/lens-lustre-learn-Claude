# WEB STAGING · STEP 1 — REPOSITORY ISOLATION FIX: LANDING PACKAGE
**2026-08-21 · Gate 1 of the staging workstream.** Authored + proven in sandbox; lands via
your normal transport (GitHub web UI, one directory per commit, blob-SHA verify after every
commit) because no repo write path exists from this session. **Nothing below touches
production infrastructure; it is a repo PR like any other, through the 7 CI gates.**

## What is proven already (Gate-2 evidence, run 2026-08-21 in sandbox)
`scripts/test-isolation-guard.mjs` against `scripts/verify-bundle-isolation.mjs`:
**RED baseline 5/5 correct failures + 2/2 correct passes; mutations 6/6** —
W1 forbidden-scan removed → DETECTED · W2 expected-check inverted → DETECTED ·
W3 exit-code neutered → DETECTED · W6 scan-scope narrowed → DETECTED ·
W4 empty-dist rule dropped → still fails closed via R2 (equivalent mutant, retargeted
per standing rule 9, invariant restated) · W5 URL validation loosened → still fails
closed via R2 (same treatment). Harness refuses to run mutations over a red baseline.

## Files — add (blob SHAs to verify after upload)
| path | blob SHA | what |
|---|---|---|
| `scripts/verify-bundle-isolation.mjs` | `0e5bdeabe26dac6df5572171e67d65a1916e5a32` | the guard (rules R1–R5, fail-closed) |
| `scripts/test-isolation-guard.mjs` | `56f2a84d47978adabb599916b8a16cc068122e07` | RED + mutation harness |
| `.env.example` | `ea9e464f9b887b7018e2bc142b975abc3b9296f9` | placeholder names only, no values |

## Files — modify
1. **DELETE `.env`** (the committed file with production values). Local dev: copy
   `.env.example` → `.env.local`, fill with your values; Vite loads `.env.local`
   automatically and it is gitignored.
2. **`.gitignore`** — append:
   ```
   .env
   .env.local
   .env.*.local
   ```
3. **`index.html`** — replace the two hardcoded Supabase link tags with Vite-interpolated
   ones (Vite natively substitutes %VITE_*% in index.html):
   ```html
   <link rel="preconnect" href="%VITE_SUPABASE_URL%" crossorigin />
   <link rel="dns-prefetch" href="%VITE_SUPABASE_URL%" />
   ```
   (Keep every other attribute of the existing tags as-is; only the href source changes.)
4. **`package.json`** — add script:
   ```json
   "verify:isolation": "node scripts/verify-bundle-isolation.mjs",
   "test:isolation-guard": "node scripts/test-isolation-guard.mjs"
   ```
5. **`.github/workflows/web-build.yml`** — after the existing build step, add:
   ```yaml
   - name: Bundle isolation guard (self-test)
     run: node scripts/test-isolation-guard.mjs
   - name: Bundle isolation guard (production lane)
     env:
       VITE_SUPABASE_URL: https://jtdtehuqtinjxropkkcn.supabase.co
       ISOLATION_FORBIDDEN_REFS: ""   # add the staging ref here once it exists
     run: node scripts/verify-bundle-isolation.mjs
   ```
   ⚠ The build step itself must then export the SAME `VITE_SUPABASE_URL` (and
   `VITE_SUPABASE_PUBLISHABLE_KEY` from a repo secret) — with `.env` deleted, a build with
   no env produces a bundle with NO ref and the guard fails R2, which is exactly the
   designed fail-closed behaviour.
6. **Cloudflare Pages (production project — settings, not code):** add env vars
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
   (production values, Production environment) **BEFORE merging this PR** — once `.env`
   is gone, the next Pages build takes its values from there. Change build command to:
   `npm run build && node scripts/verify-bundle-isolation.mjs`.
   This is the one step with production-outage consequence if skipped: **merge order is
   env-vars-first, PR-second.**

## Gate-1 PASS condition
PR green through all 7 gates **plus** the two new guard steps; production Pages deploy
succeeds with env-sourced values; `www.50mmretina.com` unchanged; guard PASS line visible
in the Pages build log. Then and only then: staging infrastructure creation (Step 3+).
