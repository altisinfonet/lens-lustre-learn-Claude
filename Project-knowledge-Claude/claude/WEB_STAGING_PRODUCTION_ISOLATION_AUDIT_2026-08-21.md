# WEB STAGING / PRODUCTION ISOLATION AUDIT
**2026-08-21 · READ-ONLY. Nothing was created, modified, deployed or deleted.**
Scope: Web only. Android untouched. Judging Panel untouched. Phases 1–5 engineering paused
(Row 12 remains OPEN mid-gate at "RED TEST — repo dependency"; unchanged by this task).

Evidence sources: Supabase MCP (org/projects/branches/functions — live), Cloudflare MCP
(R2/Workers — live; **no Pages tools exist in this connector**), Cloudflare and Supabase
official documentation (capability facts). Anything I could not see is marked **OWNER-VERIFY**
with the exact check, never assumed.

---

## 1 · Current live Web architecture (verified + documented)

React 18 + TS + Vite SPA → Cloudflare Pages (per Master Plan Part I) → Supabase
(`jtdtehuqtinjxropkkcn`, ap-northeast-2, PG 17.6.1.141, ACTIVE_HEALTHY) → media in R2 `50mm`
behind `cdn.50mmretina.com` (R2 custom domain) → Worker `seo-edge-injector` (the only Worker
on the account) → **71 edge functions** live on the production project.

## 2 · Current Cloudflare Pages configuration — OWNER-VERIFY (no Pages API access here)

Dashboard → Workers & Pages → the project serving `www.50mmretina.com`, record: project name ·
production branch · preview-deployments setting (all branches / none / custom) · env vars in
**Production** vs **Preview** columns (names only — never paste values) · whether the project
is **Git-connected or Direct Upload** · Deployments tab (confirm the Rollback button exists).
Five minutes, read-only.

## 3 · Current GitHub deployment flow (from project docs; workflows not readable this session)

`main` = production branch; PR → 7 CI gates → squash-merge; web deploys via Pages on push to
`main` (Web build #129 precedent). `git push` from sandbox proxy-blocked; repo work lands via
web UI + blob-SHA verification. **No staging branch or environment exists anywhere in the
recorded flow.** OWNER-VERIFY: whether the Pages build is triggered by Pages Git-integration or
by a GitHub Action (`web-build`) — this decides where the staging deploy step later attaches.

## 4 · Current Supabase architecture (verified live)

**One organization** (`50mmretinaworld`), **one project** — production. **No staging project
exists. No preview branches exist** (`list_branches` → only default `main`). 146 tables /
686+ policies / 71 edge functions / RLS everywhere (Phase-1 audit). Secrets live only in the
production project. **Conclusion: today there is no non-production backend at all.**

## 5 · Current R2 / storage architecture (verified live)

Buckets: `50mm` (production media, public via `cdn.50mmretina.com`, `/cdn-cgi/image`
transforms working on that host) and `agentcrm` (unrelated). **No staging bucket.**
`site_settings.s3_storage_settings.public_url` in the production DB points the app at the CDN
host — meaning the media host is **data, not code**: a staging DB can point at a staging
bucket with zero code change.

## 6 · What the FREE tiers actually support (from vendor docs, cited)

| Capability | Fact | Source |
|---|---|---|
| Pages builds | 500/month, 1 concurrent, 20-min timeout — Free | developers.cloudflare.com/pages/platform/limits |
| Pages custom domains | **100 per project, Free** — a second project gets its own domain | same |
| Pages preview deployments | Free; per-branch alias URLs `<branch>.<project>.pages.dev` | Pages docs |
| Pages env vars | separate **Production** and **Preview** sets per project; ONE preview set shared by all preview branches | Pages docs |
| Pages exact-artifact deploy | `wrangler pages deploy <dir> --branch <b>` (Direct Upload) — but a project is Git-connected **or** Direct-Upload, documented as not switchable | Pages docs (OWNER-VERIFY current dashboard behaviour) |
| Pages rollback | previous deployments retained; instant rollback in dashboard | Pages docs |
| Supabase projects | **Free plan = 2 projects**; this org uses 1 → staging project is ₹0 | supabase.com/docs/guides/platform/billing-on-supabase |
| Supabase branching | **Pro plan only**; branch compute billed hourly (~$0.013/hr ≈ $10/mo continuous), not spend-cap covered | supabase docs (branching usage) |
| Supabase free-project quota | 500 MB DB · 1 GB storage · 500k edge invocations · 50k MAU — ample for staging | billing docs |
| R2 free | 10 GB storage + free-tier ops **per account** — a second bucket shares it (current usage ~120 MB known from Phase 2 measurements) | R2 pricing |

## 7 · Options considered

**A — Pages Preview (same project) + isolated staging backend.** Free. But: one shared
preview env-var set (fine), **no custom domain on previews**, staging URL is `*.pages.dev`,
and staging deployments live inside the production project's deployment list — one misclick
in the same UI from production. Weakest human-error boundary.

**B — Separate Pages project (`50mm-staging`) + separate free Supabase project + separate R2
bucket.** Free. Own custom domain (`staging.50mmretina.com`), own env vars, own deployment
history, own rollback; production project never opened during staging work. Strongest
boundary available at ₹0.

**C — Supabase preview branches instead of a staging project.** Rejected: requires paid plan,
hourly compute, ephemeral semantics — and the owner needs a *persistent* staging environment.

**C′ (enhancement to B, my addition) — build-once / promote-the-exact-artifact.** Your model
says "promote that exact release to live." **A Git-connected Pages production project cannot
do that** — merging to `main` *rebuilds*, and a rebuild is not byte-guaranteed identical.
Two honest sub-options: (i) accept merge-rebuild, freeze = tag + record `dist` content hashes
from the staging build and compare against production's build output after deploy — detects
drift, doesn't prevent it; (ii) true artifact promotion: production Pages becomes a
**Direct-Upload** project and CI (or a human) runs `wrangler pages deploy` of the *same*
`dist` directory that passed staging — byte-identical by construction. (ii) touches the
production project's mode, so it is a later, separately-approved migration; start with (i).

## 8 · RECOMMENDED ARCHITECTURE — Option B, with C′(i) now and C′(ii) as a later door

```
GitHub repo (unchanged)
  main    ──(existing flow)──────────────▶ Pages project #1 → www.50mmretina.com
  develop ──(new)──▶ Pages project 50mm-staging → staging.50mmretina.com
                          │ env: VITE_SUPABASE_URL/KEY = STAGING project
                          ▼
              Supabase STAGING project (2nd free project, same org)
                schema from production SCHEMA DUMP (see §12 — NOT migration replay)
                own auth users (synthetic) · own secrets · own edge functions
                site_settings.s3 → staging bucket
                          ▼
              R2 bucket 50mm-staging → staging-cdn.50mmretina.com
```

## 9 · Exact isolation boundaries

The decisive one is **build-time key separation**: Vite bakes `VITE_SUPABASE_URL`/anon key
into the bundle. The staging build **physically does not contain** production's URL or key —
it cannot write production even by bug. ⚠ One precondition, OWNER-VERIFY/repo: Lovable-era
apps often **hardcode** the Supabase URL in `src/integrations/supabase/client.ts`. If ours
does, one small approved change (read from env) is required before any of this is real. That
is the single highest-value check in this whole document. Remaining boundaries: separate
Supabase project (own JWT secret — staging tokens are cryptographically invalid against
production), separate bucket, separate Pages project, separate secrets. Production stays
read-only-queryable for phase evidence, exactly as now.

## 10 · Git branch strategy

`develop` = staging trunk (auto-deploys to staging) · feature branches → PR into `develop`
(CI gates run there too) · release = PR `develop` → `main`, merged only after §15's freeze +
your approval. No force-pushes to either trunk; `main` rules unchanged.

## 11 · Cloudflare deployment strategy

Pages project #2 `50mm-staging`, Git-connected, production-branch = `develop`, custom domain
`staging.50mmretina.com` (zone is already on Cloudflare; free). Optional, recommended:
Cloudflare **Access** (free ≤50 users) in front of staging + `noindex` robots header + a
visible STAGING banner — members must never mistake or stumble into it. `seo-edge-injector`:
not routed to staging initially (OWNER-VERIFY its current route matcher).

## 12 · Supabase staging strategy — and the trap this audit exists to catch

Create the 2nd free project (same org, same region). **Do NOT build its schema by replaying
the repo's 618 migration files** — Control Cycles C5/C6 proved the historical files are not
replayable (AMBER files abort; RED files apply outdated intent; one-time data repairs re-run).
**Schema comes from a production schema-only dump** (`supabase db dump --schema-only` /
`pg_dump -s`, owner-run or via Chrome session), applied to staging as its baseline; the
staging ledger is then baselined at that snapshot and **future** migrations flow repo →
staging → (after release) production. Edge functions: deployable to the staging project ref
via the existing connector (`deploy_edge_function`) once you authorize that workstream.
Secrets: set fresh in the staging dashboard by you — **staging gets staging Brevo/Razorpay
sandbox/R2 keys, never production values**. Auth: synthetic member/judge/admin accounts,
deterministic seed script, **zero production PII copied** — your instruction, and Supabase's
own guidance, agree.

## 13 · R2 / storage staging strategy

New bucket `50mm-staging` (fits free tier beside ~120 MB of production media), custom domain
`staging-cdn.50mmretina.com` (free, enables `/cdn-cgi/image` on that host), staging DB's
`s3_storage_settings.public_url` → that host; staging Supabase secrets hold R2 keys scoped to
that bucket (Cloudflare R2 API tokens can be bucket-scoped — do this, so even staging's
credentials cannot name the production bucket). Prefix-in-same-bucket is rejected: shared
credentials would be able to write production objects.

## 14 · Owner testing process

You test `staging.50mmretina.com` as a normal member (synthetic accounts): login, profile,
posting incl. multi-photo, media, privacy incl. the chooser + disclosure, feed, comments,
likes, notifications, competitions (synthetic competition — and note this is where the
deferred Judging-Panel workstream will later get its §7 behavioural venue for free), offline/
retry/failure behaviour, and future Phase-3 builds. Everything you do stays in staging by
construction (§9).

## 15 · Release-candidate process (your model, with the §7 correction built in)

feature → PR to `develop` → CI gates → auto-deploy staging → automated + security + mutation
+ UI gates against staging → your browser testing → **FREEZE**: record commit SHA + `dist`
content hashes + migration list as the RC manifest → your approval → promote (§16). A fix
reopens the loop; the RC manifest is regenerated — never patched.

## 16 · Production promotion

Now (C′-i): PR `develop`→`main` containing exactly the frozen SHA; merge; Pages builds; the
deployed output is hash-compared against the RC manifest; any mismatch = STOP + rollback.
DB migrations from the RC manifest go through `apply_migration` in order, before web deploy,
as today. Later (C′-ii, separate approval): production becomes Direct-Upload and the frozen
`dist` itself is pushed — byte-identical promotion, the model as you drew it.

## 17 · Rollback

Web: Pages dashboard → Deployments → **Rollback** to the previous known-good deployment —
existing free capability, instant, no rebuild. DB: unchanged discipline — every migration
ships with its captured rollback file (`supabase/rollback/`), applied via `apply_migration`.
The two are independent and the runbook says which to use when.

## 18 · Cost

**₹0 / $0.** Second free Supabase project (2-project allowance), second free Pages project
(500 shared builds/mo is ample), R2 within free tier, custom domains free on the existing
zone, CF Access free tier. Nothing here requires paid Cloudflare or paid Supabase. The only
path that ever costs money is Supabase branching — which this architecture rejects.

## 19 · Owner actions required (in order)

1. §2 dashboard read-back (Pages project, branch, Git-vs-Direct, env var names).
2. The §9 hardcode check — or authorize me to specify the exact env-var change for the repo.
3. Approve this architecture (or amend).
4. Create the staging Supabase project (dashboard, 2 min) — or authorize me to create it via
   the connector (`create_project` — it will confirm ₹0 cost first).
5. Provide the schema-only dump (or run it via a Chrome session with me).
6. Create Pages project `50mm-staging` + `develop` branch + env vars + domain (Chrome
   session together, or you alone with my checklist).
7. Set staging secrets (sandbox keys). 8. Bucket-scoped R2 token for `50mm-staging`.

## 20 · Claude actions (after your approval, each within its own authorization)

Staging schema apply + baseline · synthetic seed script · edge-function deploys to staging
ref · staging verification suite (the P1–P4 feed probes, write-path probe, privacy matrix —
rerunnable against staging with no production risk) · RC-manifest tooling spec · runbook doc.

## 21 · External dependencies

None new. GitHub (billing deadline 2026-08-31 still stands — staging CI dies with it too),
Cloudflare free platform, Supabase free platform, DNS already on the zone.

## 22 · Risks

| Risk | Size | Mitigation |
|---|---|---|
| Hardcoded Supabase URL in client → env separation is fiction until fixed | **the** critical unknown | §9 check first; one-line env refactor under normal gates |
| Schema dump drifts from repo migrations over time | medium | staging is rebuilt from a fresh dump at each baseline; future migrations flow through staging first |
| Pages Git/Direct-Upload not switchable → C′-ii needs a new project + domain cutover | low, later | do C′-i now; C′-ii is its own gated change |
| Staging mistaken for production by a member | low | Access gate + banner + noindex + separate domain |
| 500 builds/mo shared across both projects | low | ample at current cadence |
| Staging secrets accidentally set to production values | medium | checklist forbids it; bucket-scoped R2 token makes media side structural |
| `seo-edge-injector` behaviour differs on staging host | low | initially unrouted; verified before RC freeze |

---

**STOPPED, as instructed. Nothing has been engineered. Awaiting your ruling on §8 (and the
§19 items, starting with the §2 read-back and the §9 hardcode check).**
