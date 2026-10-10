# WEB STAGING PRE-FLIGHT VERIFICATION
**2026-08-21 · READ-ONLY.** Nothing created, modified or deployed. Production untouched.
Method note: the repository proved **publicly fetchable file-by-file** (raw.githubusercontent.com,
pinned to HEAD `c737de9`), so Steps 1, 2 and 4 were executed against real source — not inferred.
Files read verbatim at that SHA: `src/integrations/supabase/client.ts`, `.env`, `vite.config.ts`,
`index.html`, `.github/workflows/web-build.yml`, `public/sw-image-cache.js`, `src/main.tsx`.

---

## 1 · Supabase client isolation result

`src/integrations/supabase/client.ts`:
```ts
const SUPABASE_URL             = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
```
- **A. `VITE_SUPABASE_URL` used?** YES.
- **B. anon-key env var used?** YES — but the real name is **`VITE_SUPABASE_PUBLISHABLE_KEY`**,
  not `VITE_SUPABASE_ANON_KEY`. Every env-var checklist must use the real name.
- **C/D. Hardcoded in client.ts?** NO — clean. No fallback literal, no `??` default.
- Storage config: media host comes from `site_settings.s3_storage_settings` **in the database**
  (verified in the architecture audit) — a staging DB automatically points media elsewhere.

## 2 · Hardcoded production endpoint scan (E, F)

| Location | Finding | Severity |
|---|---|---|
| **`.env` — COMMITTED to the repository** | `VITE_SUPABASE_URL=https://jtdtehuqtinjxropkkcn.supabase.co`, `VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIs…`, `VITE_SUPABASE_PROJECT_ID=jtdtehuqtin…` (plus bare `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`) | **BLOCKER — see §4** |
| `index.html` | `<link rel="preconnect">` **and** `dns-prefetch` to `https://jtdtehuqtinjxropkkcn.supabase.co` (hardcoded) | Minor but must be fixed (§4 guard would trip on it) |
| `index.html` og:image / twitter:image | `https://pub-f3e7af944f2746b7bb4fb6e679dd78de.r2.dev/site-assets/…` — an R2 **public development URL** is live for site-assets | Not a staging blocker; noted for the record (r2.dev public access exists on at least one bucket) |
| `public/sw-image-cache.js` | host-agnostic patterns only: `*.r2.dev` wildcard + Supabase storage path regex + bucket-name whitelist (`portfolio-images`, `competition-photos`, `post-images`, `site-assets`). **No project ref hardcoded** | none |
| `src/main.tsx` | hosts: `id-preview--`, `lovableproject.com`, `localhost` (SW guard) + deep-link scheme. No backend host | none |
| `vite.config.ts` | no `define`, no env injection, no hosts | none |
| Whole-repo grep for `jtdtehuqtinjxropkkcn` | **NOT RUN — cannot grep a remote repo file-by-file.** Covered instead by the §4 bundle-level guard, which catches any source I did not read | residual, closed by design |

## 3 · Environment-variable result (G)

Browser-reaching env usage: exactly **two** variables (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`) in `client.ts`, plus Vite's built-in `DEV`/`PROD` flags in
`main.tsx`. `VITE_SUPABASE_PROJECT_ID` exists in `.env` but was not seen used by the files read.
No env handling in `vite.config.ts`. `supabase/config.toml` (server-side CLI file) never enters
the bundle.

## 4 · Vite build isolation result — **THE BLOCKER, stated exactly**

Vite auto-loads the **committed `.env`**. Therefore today, *every* build of this repository —
on any machine, any Pages project, any CI — **defaults to production URL + production key**
unless a process-level variable overrides it (Vite precedence: process env beats `.env` files).
A staging Pages project with a missing or **misspelled** env var would silently produce a
staging site wired to production. That is precisely the failure you defined as disqualifying.

**Your Step-2 rule applied: build-time separation CANNOT currently be guaranteed → STOP.**

The fix is small, precise, and must be approved and shipped through normal gates **before**
any staging environment is created:

1. **Remove `.env` from the repository** (and gitignore it; local dev uses `.env.local`).
   One commit. Also rotates nothing — the publishable key is public by design, but the
   *default-to-production* behaviour dies with the file.
2. **Post-build isolation guard** — a script + CI step that inspects `dist/` after every build
   and **fails** if the bundle contains the wrong project ref for its target (staging build
   containing `jtdtehuqtinjxropkkcn` → FAIL; must contain the staging ref; production build
   the inverse). This is a **bundle-level guarantee**: it catches every hardcode source,
   including any file this pre-flight did not read. It is the mutation-proof version of
   "staging cannot talk to production".
3. **`index.html` preconnects → Vite interpolation** (`%VITE_SUPABASE_URL%` — natively
   supported in index.html), so the guard passes and the preconnect stays correct per env.

## 5 · Cloudflare Pages configuration result — OWNER-VERIFY (unchanged)

No Pages API access this session. Known: production branch is `main` (workflow + docs);
build commands mirrored by `web-build.yml` are `npm ci` + `npm run build`. **Unknown, and
required from you (names only, never values):** project name · preview-deployment setting ·
Git-connected vs Direct-Upload · env-var NAMES present in Production/Preview columns ·
build output directory setting. Five minutes in the dashboard.

## 6 · GitHub deployment result (traced, not inferred)

`.github/workflows/web-build.yml`: triggers on push to `main` + PRs; runs `npm ci --no-audit
--no-fund` and `npm run build`; verifies `dist/` exists; **contains no deploy step, no
wrangler, no Cloudflare secrets** — its own comment says it "runs the SAME two commands Pages
runs" to make failures loud. **Conclusion: production deploys via Cloudflare Pages Git
integration directly; the GitHub workflow is a build canary, not the deployer.** This confirms
the promotion model: merging to `main` triggers a Pages rebuild (hence Step-7's RC
hash-verification rule, which stands).

## 7 · Staging architecture (confirmed blueprint, Option B as you accepted)

```
GitHub ── main ────▶ Pages prod project (Git-integrated, unchanged) ─▶ www.50mmretina.com
   │                     env: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY = PRODUCTION
   └── develop ────▶ Pages 50mm-staging (new, Git-integrated)        ─▶ staging.50mmretina.com
                         env: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY = STAGING
                         + post-build isolation guard (§4.2) on BOTH lanes
Staging Supabase (2nd free project; schema from schema-only dump — never migration replay)
Staging R2 `50mm-staging` ─ staging-cdn.50mmretina.com ─ bucket-scoped token
```

## 8 · Security boundaries

Staging bundle physically contains only staging URL/key (§4 fixes make this *enforced*, not
hoped); staging JWTs cryptographically invalid against production (different project secret);
staging R2 token bucket-scoped (cannot name `50mm`); staging secrets are sandbox values;
CF Access + noindex + banner on the staging host.

## 9 · Production safety boundaries

Production Pages project, branch protection on `main`, production Supabase, production R2 and
all secrets remain untouched by every step above. Production stays read-only-queryable for
phase evidence. The §4 guard also runs on the production lane, pinning the inverse invariant.

## 10 · Release-candidate process (your Step 6/7, adopted verbatim)

feature → PR → CI → `develop` → staging deploy → automated/security/mutation/UI tests →
owner testing → OWNER APPROVAL → **RC frozen**: commit SHA · tree SHA · build id ·
dist content hashes · migration list · edge-function versions (the `ezbr_sha256` values the
connector already exposes) · config version · test results · approval record → promotion =
merge exactly that SHA to `main` → Pages rebuild → **verify deployed output against RC
hashes; mismatch = STOP + rollback**. Failed staging test = STOP → FIX → new staging build.
No patching of an approved RC — a fix always mints a new RC. Direct-Upload byte-identical
promotion stays parked as its own future workstream, per your Step 7.

## 11 · Rollback process

Web: Pages dashboard → Deployments → Rollback (existing free capability, instant, no rebuild).
DB: captured rollback files per migration, as today. Runbook states which applies when;
they are independent.

## 12 · Exact owner actions required

1. §5 dashboard read-back (six items, names only).
2. **Approve the §4 isolation fix** (drop committed `.env` + guard script + index.html
   interpolation) — this is the one repo change standing between NOT READY and READY, and it
   ships through the normal PR/CI gates like anything else.
3. After §4 ships: create staging Supabase project (or authorize me to, via connector with
   cost-confirm ₹0) · provide schema-only dump (or Chrome session) · create `50mm-staging`
   Pages project + `develop` branch + env vars + domain · set sandbox secrets · bucket-scoped
   R2 token.

## 13 · Exact Claude actions required (each on your go)

Draft the §4 PR content (guard script + gitignore + index.html lines) for you to land ·
staging schema apply + ledger baseline · deterministic synthetic seed · edge-function deploys
to the staging ref · staging verification suite (re-runnable P1–P4 feed probes, write-path
probe, privacy matrix) · RC-manifest format + runbook.

## 14 · Blockers

**One:** the committed `.env` (§4). Everything else is sequencing, not blockage.
(Residual, closed by design: the un-run whole-repo grep — §2 last row.)

## 15 · VERDICT — staging readiness

**NOT READY.** A path exists today by which a staging Web build silently contains production
Supabase credentials: the committed `.env` is the build's default, and any env-var omission
or typo on a new Pages project falls back to it. Per your rule this is disqualifying, it is
not worked around here, and nothing was created. **READY follows from one small, gated repo
change (§4) plus your §5 read-back — nothing else stands in the way, and the total
infrastructure cost remains ₹0.**

**STOPPED. Awaiting your approval of the §4 fix before anything else moves.**
