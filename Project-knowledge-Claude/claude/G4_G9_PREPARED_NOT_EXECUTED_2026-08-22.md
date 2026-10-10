# G4 → G9 — PREPARED, NOT EXECUTED

Date: 2026-08-22. **No mutation performed.** Every item below is a read-only
audit result plus a fixed change set, held until its gate is authorized.

---

## G4 — De-hardcode lane-specific values · PREPARED

### Exact constants to replace (verified line numbers, comments excluded)

| File:line | Current literal |
|---|---|
| `src/lib/cdnImage.ts:52` | `const CDN_HOST = "cdn.50mmretina.com"` |
| `src/lib/media/postMediaRead.ts:84` | `export const MEDIA_CDN_HOST = "cdn.50mmretina.com"` |
| `src/components/post/PostMedia.tsx:161` | `const CDN_HOST = "cdn.50mmretina.com"` |
| `src/lib/profilePhoto.ts:39` | `const CDN_PREFIX = "https://cdn.50mmretina.com/"` |
| `src/lib/reportImageError.ts:47` | `OUR_IMAGE_HOSTS = ["cdn.50mmretina.com", SUPABASE_HOST]` |
| `index.html:17-19` | apex→`https://www.50mmretina.com` redirect script |
| `index.html:73` | `<meta property="og:url" content="https://50mmretina.com/">` |
| `public/_headers:8` | CSP naming `https://cdn.50mmretina.com` |
| `public/_headers:11` | `Access-Control-Allow-Origin: https://50mmretina.com` |
| `functions/_seo.ts:6` | `SUPABASE_URL = "https://jtdtehuqtinjxropkkcn.supabase.co"` |
| `functions/_seo.ts:8` | `SUPABASE_ANON = "eyJ…"` (production anon) |

`src/uiharness/fixtureRoutes.ts` matches are **comments only** — no change.

### Design

- New build-time vars `VITE_CDN_HOST` and `VITE_SITE_ORIGIN`, defaulted to the
  production values so an unset environment cannot silently produce a
  hostless build (mirrors the guard's R1 philosophy).
- `functions/_seo.ts` takes `context.env.SUPABASE_PROJECT_REF` and
  `context.env.SUPABASE_ANON_KEY` instead of module constants. **6 Pages
  Functions import it** — `page/[slug]`, `journal/[slug]`, `assets/[[path]]`,
  `competitions/[id]`, `courses/[slug]`, `featured-artist/[slug]` — so the
  signature change touches all six call sites.
- `public/_headers` becomes generated per lane by a new
  `scripts/generate-headers.mjs`, exactly as `_redirects` already is. **This is
  mandatory, not cosmetic:** once G5 forbids hosts, a staging build would
  otherwise fail on its own committed `_headers` file.

### Known trap

`generate-redirects.mjs` currently emits a rule Cloudflare **rejects**
(`Parsed 0 valid redirect rules` — Pages does not accept a 200-rewrite to an
external origin). `generate-headers.mjs` must not repeat that mistake, and the
existing sitemap defect is recorded separately as a production SEO issue.

---

## G5 — Extend the isolation guard · PREPARED

Current harness: `scripts/test-isolation-guard.mjs`, 92 lines, two arrays —
`killMutations` (must be detected) and `failClosedMutations` (must still refuse).
It already models both directions with a **synthetic** staging ref
(`stgabcdefghijklmnopq`), so it stays hermetic.

### New rules

| Rule | Behaviour |
|---|---|
| **R6** | Empty `ISOLATION_FORBIDDEN_REFS` → **exit 1**, not a warning. Override only via an explicit `ISOLATION_ALLOW_NO_FORBIDDEN=1`. |
| **R7** | New `ISOLATION_EXPECTED_HOST` must be present in `dist`; new `ISOLATION_FORBIDDEN_HOSTS` must be absent. |
| **R8** | Scan `functions/` in addition to `dist/` — Pages Functions never enter `dist` and are invisible to the guard today. |

### Harness additions (standing rule: retarget equivalent mutants, never delete)

- mutant reverting R6 to `console.warn` → must be **killed**
- mutant dropping the host loop → must be **killed**
- mutant narrowing the scan back to `dist` only → must be **killed**
- mutant blanking `ISOLATION_EXPECTED_HOST` → **fail-closed**, must still refuse

---

## G6 — Production forbidden refs · PARTLY DONE, FOLDED INTO G3

- Cloudflare Pages **Production** variable `ISOLATION_FORBIDDEN_REFS=ztzutckwdhetphwghuzj`
  was set during the browser session (~02:10 UTC) — the deployed lane is guarded.
- `web-build.yml:75` still passes `""` — the CI mirror is not. **That fix is
  item 1 of G3 §5.2.** G6 therefore reduces to verifying both agree.

---

## G7 — Staging Cloudflare Pages · PREPARED

Settings to create (no action taken):

| Setting | Value |
|---|---|
| Project | new, separate from `lens-lustre-learn-claude` |
| Production branch | `staging` |
| Preview deployments | **None** |
| Build command | `npm run build && node scripts/verify-bundle-isolation.mjs` |
| Output directory | `dist` |
| Node | from `.node-version` (`22.22.2`) |
| Custom domain | `staging.50mmretina.com` (currently **NXDOMAIN**) |

Variables: the staging set from the G3 design, plus `ISOLATION_FORBIDDEN_HOSTS`
and `VITE_CDN_HOST`/`VITE_SITE_ORIGIN` once G4/G5 land, plus the two Pages
Functions vars.

**Resolved, no action needed:** `seo-edge-injector` routes are host-specific
(`50mmretina.com/*`, `www.50mmretina.com/*`), so it will **not** intercept
`staging.50mmretina.com`. Architecture-audit finding C-2 is closed.

**Carry-forward:** `www.50mmretina.com` is *not* a Pages custom domain — only the
apex is, and `www` is served through the Worker whose `ORIGIN_HOST` is the
pages.dev origin. Staging must be wired deliberately; copying "how www works"
would drag the Worker in.

---

## G8 — Staging R2 · PREPARED

Production `site_settings.s3_storage_settings` shape, read without exposing any
credential:

```
provider    cloudflare
enabled     true
bucket_name 50mm
region      auto
path_prefix  (empty)
public_url  https://cdn.50mmretina.com
endpoint    https://<account-id>.r2.cloudflarestorage.com
access_key_id      present, 32 chars
secret_access_key  present, 64 chars
```

Staging row to be written **into the staging database only**:
`bucket_name = 50mm-staging`, `public_url = https://cdn-staging.50mmretina.com`,
same endpoint host (same Cloudflare account), `region = auto`,
`path_prefix = ""`, and a **new API token scoped to `50mm-staging` only**.

- The scoped token is the single most important credential decision here: a
  broad account token in the staging database would let staging write into the
  production bucket.
- `50mm-staging` is in **ENAM**, production `50mm` is in **APAC**. Location is
  fixed at creation; the bucket is empty, so recreating in APAC is free and
  removes a fidelity gap. Recommended, not required.
- Staging currently has **0 rows** in `site_settings`, so uploads fail closed
  today — the correct default.

---

## G9 — Staging Edge Functions + synthetic data · PREPARED

- **74** edge functions in `supabase/functions/`; **40** distinct targets are
  invoked from client code.
- **0** deployed to staging today.
- Deployment is possible **from this session** via `mcp__Supabase__deploy_edge_function`
  targeted at `ztzutckwdhetphwghuzj` — the project ref is a tool parameter, so it
  is structurally incapable of touching production.
- `supabase/config.toml` pins `project_id = "jtdtehuqtinjxropkkcn"`; staging
  deploys must never use `supabase link` against it.
- Runtime env names used across the functions: `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (injected automatically per
  project) plus optional third-party secrets — `CRON_SECRET`, `AI_GATEWAY_URL`,
  `AI_API_KEY`, `LOVABLE_API_KEY`, `FCM_SERVICE_ACCOUNT`, `GA_*`, `BREVO_*`,
  `CHATBOT_AI_KEY`, `AD_REWARD_SECRET`, `PUSH_INTERNAL_SECRET`,
  `SCHEDULED_POSTS_CRON_SECRET`, `TEST_AGENT_INGEST_TOKEN`.
  Staging sets **none of the third-party ones**: those functions then fail
  closed, which is correct for staging and avoids any shared external quota.
- Seed: synthetic accounts only. **No production user, auth record, photograph,
  storage object, vault secret or application row is copied.** The minimum seed
  is the `s3_storage_settings` row from G8 plus whatever configuration rows the
  app requires to boot — to be enumerated at G9, not guessed now.

---

## G10 — Promotion · PREPARED

Approval tag `approved/<date>-<n>` on `staging`; `--ff-only` merge; CI gate
asserting `main^{tree} == <tag>^{tree}`; record the Cloudflare deployment id.
Artifact promotion remains impossible by design — Vite bakes the Supabase ref at
build time, so a staging bundle can never be a production bundle.
