# S8 part 2 "Live debt": builder report (cloud session, 2026-10-28)

**Gate:** "every live function == git; 0 missing migrations; each fix verified on live"
**State:** code merged to `staging` only. This session applied no SQL, deployed nothing and promoted nothing. "Verified on live" for each unit is the supervisor's step below.

## Units

Every PR went to `staging`, was squash-merged pinned to its head SHA, and had one sonnet reviewer (diff only). Each review is posted on its PR.

| Item | Unit | PR | Merge sha | Review | LOW notes (kept) |
|---|---|---|---|---|---|
| 1 | F-D3-1/2 one SEO renderer (`functions/_middleware.ts`) | #502 | 1f6f512 | R1 REQUEST CHANGES (JSON-LD would double with the Worker in front) → fixed → R2 APPROVE, nothing blocking | Relies on Cloudflare's `CF-Worker` subrequest header (check below). A forged `cf-worker` header opts that one request out. No `_routes.json`, so the middleware runs on every request (the Worker already does today). Unbounded paths → one metadata call each (same as the Worker). |
| 2 | F-D3-3 dynamic sitemap (`functions/sitemap.xml.ts`) | #504 | e3bf0e6 | APPROVE, nothing blocking | No single-flight on the hourly refresh. The fallback carries `max-age=3600`. Host check, 4 s cap and missing-timestamp fixes were taken. |
| 2 | F-D3-8 `preferred_language` = code or NULL (SQL 0201) | #505 | 4e76912 | APPROVE, nothing blocking | First use of `session_replication_role = replica` in the repo: if the apply role may not set it, the apply aborts with nothing changed (staging settles it). `DROP NOT NULL` holds ACCESS EXCLUSIVE on `profiles` through the scan (check the row count first). |
| 4 | SEC-P9-2 / F-AUD-8: carry of #390 | #507 | cb76334 | APPROVE, nothing blocking | none |
| 6 | F-REV4-1 inventory PROBE + script | #506 | aba10b6 | APPROVE, nothing blocking | Bare-name input can take a stray word as a slug (JSON input is primary). The PROBE needs `pg_cron`. |

**Not done, and why:**
- **3 · F-D2-13/14** (listener ↔ publication): needs the live publication list. The exporter is draft #352, and the parity job is skipped without it. **Next step:** the supervisor runs #352's exporter per lane, then two units: D2 drops dead listeners, D1 adds or drops publication members.
- **3 · F-D2-15** (`home.ts` lazy): the trade is stated in `docs/evidence/d2/P12/one-chunk-per-language.md`. A non-English landing would show English for a beat. **Proposal:** keep `en` eager and move the six other `home.*` blocks into each lazy `translations.<code>` chunk. That is a UX trade for the Owner, so it is not built.
- **4 · SEC-UB-9:** no text exists in git (every branch, every commit message). It is probably in the claude.ai Project docs. Not guessed.
- **5 · F-REV4-6** (award stamps / judge badge): no text in git. The cause and proposed fix are in `S8_BUILDER_REPORT.md` (branch `claude/s8-live-debt-szspp0`): publish-gated DEFINER read functions plus a cross-member test. Not started (token cap).

## SEO: head diff and timing (measured from this US sandbox, 2026-10-28 21:2x–21:4x UTC)

Tags compared: title, description, robots, canonical, og:\*, twitter:\*, ld+json, with hosts normalised.

| Route | Live www (Worker) | Staging (new Pages renderer) | Diff |
|---|---|---|---|
| `/` | 14 tags, `injected:seo_pages-override` | 14 tags, `injected:seo_pages-override` + `x-seo-render: pages:injected` | **0 lines, values included** |
| profile `/:custom_url` | 14 tags; this sample came back `fallback` (the flip, F-D3-1) | 14 tags, injected | 0 lines (tag shape) |
| post `/post/:id` | live: `x-seo-edge: fallback` on 3/3 GETs earlier (metadata takes ~1.7 s and the Worker aborts at 1.5 s), so the static shell tags have **no canonical** | 1st visit `pages:fallback`, then `injected:post` **with canonical** | fixed from the 2nd visit per colo |
| competition | live `/competitions` (production lists none publicly) | `/competitions/:id` → `injected:competition` | only `robots` self-closing style |

TTFB medians of 5 (min–max):

| | before (21:22) | after staging merge (21:42) |
|---|---|---|
| www `/` (Worker) | 1.61 s (0.41–1.76) | 0.53 s (0.49–0.82) |
| www `/post/:id` (Worker) | 0.51 s (0.50–1.00) | 0.48 s (0.45–1.98) |
| pages.dev `/` direct | 0.27 s (0.19–0.27) | n/a |
| staging `/` | 0.55 s (0.50–0.67), no injection | 0.51 s (0.49–0.54) **with** injection |
| staging `/post/:id` | 0.57 s (0.46–0.71) | 0.50 s (0.46–1.96; one cold miss) |

Reading: injection inside Pages costs nothing measurable on a warm colo (staging is no slower than it was without tags). The live Worker's cost is its extra origin hop plus the per-visit metadata call. The Owner's India figures (0.55–0.83 s vs 0.07–0.45 s direct) should be re-measured after the unroute.

### Owner's Cloudflare steps (after the supervisor promotes #502 to `main` and the checks below pass)

1. Supervisor check first, with the Worker still routed: `curl -sD- https://www.50mmretina.com/journal/<slug> -o p.html`. Expect exactly one `application/ld+json` block per object. Then `curl -sD- https://lens-lustre-learn-claude.pages.dev/ -o /dev/null | grep x-seo-render` shows `pages:injected`.
2. Cloudflare dashboard → **Workers & Pages** → `seo-edge-injector` → **Settings** → **Domains & Routes**. Note both routes (`50mmretina.com/*`, `www.50mmretina.com/*`), then click **…** → **Delete route** on `www.50mmretina.com/*`.
3. Check www still answers 200 with `x-seo-render: pages:injected` and no `x-seo-edge: fallback`.
4. For the apex, keep the Worker route on `50mmretina.com/*` (it does the 301), **or** replace it with **Rules → Redirect Rules → Create rule**: hostname equals `50mmretina.com` → Dynamic redirect `concat("https://www.50mmretina.com", http.request.uri.path)`, 301, preserve query. Then delete the apex route too.
5. Rollback: re-add the route(s) (Worker unchanged), or set Pages env `SEO_INJECT=off` (Production) to disable the Pages renderer.

Canonical host: both renderers now emit what `seo-route-metadata` returns, which is apex `https://50mmretina.com/…`. P17 D4 (www) is an Owner data change: set `seo_global.canonical_base` and/or the edge function's `SITE_ORIGIN` to `https://www.50mmretina.com`. One renderer means no more flip either way.

## SQL / PROBE order for the supervisor (staging first, then production)

1. `supabase/migrations/PROBE_s8_f_d3_8_preferred_language.sql` (expect FAIL) → apply `20261029_0201_f_d3_8_preferred_language_code.sql` → PROBE again (expect PASS). Rollback: `supabase/rollback/20261029_0201_f_d3_8_preferred_language_code_ROLLBACK.sql`.
2. `supabase/migrations/PROBE_s8_functions_inventory.sql` (read-only inventory, both lanes). Then `d1-deploy-functions.yml mode=list` per lane, save the JSON, and run `node scripts/s8-functions-inventory.mjs --live live.json --db probe.csv --lane <lane>`. Exit 1 lists the live functions missing from git.
3. SEC-P9-2, **only after the Owner's vault clicks:** `PROBE_faud8_cron_credentials.sql` → `20261010_0001_faud8_cron_credential_rotate.sql` → prove the new credential works → `20261010_0002_faud8_cron_credential_finalize.sql`. Rollback for 0001 only, before 0002.
4. Still open from part 1: `S8_BUILDER_REPORT.md` (branch `claude/s8-live-debt-szspp0`) items 1–6.

## Old open PRs (item 7)

Method: for each PR, compare every file it adds or modifies with `origin/staging` by blob hash. **No PR's files are on staging intact**: 0 identical in 23 of 27, and partial matches only on #323, #259, #256 and #130. So supersession by content cannot be shown, and only #390 was closed.

| PR | Action | Basis |
|---|---|---|
| #390 | **Closed**, superseded by #507 | byte-identical carry |
| #499, #305, #103, #501 | not touched | supervisor's / `main` / another job |
| #391 SEC-P3E-1, #214 F-110 lane guard | still needed: carry next | security fixes; files absent or different on staging |
| #352 P3 exporter | still needed: unblocks F-D2-13/14 | files absent |
| #428, #323, #289, #286, #285, #278, #277, #276, #259, #256, #192, #156, #155, #154, #151 | list for the supervisor: P30–P33 / P2 / R-units, likely overtaken by later merged units | 0 or partial identical files; needs a per-unit live check |
| #408, #254, #215, #210, #200, #175, #174, #157, #130 | docs / evidence / archive / tooling: recommend close after the Auditor confirms | not code on a live path |

## Owner click list

- Cloudflare: steps 2–4 above, after the supervisor's check.
- Data: canonical host www (`seo_global.canonical_base` / the edge function's `SITE_ORIGIN` secret), if P17 D4 is signed.
- SEC-P9-2: new `CRON_SECRET` Edge secret and/or a new service key, then Vault `faud8_new:cron_secret` / `faud8_new:service_key`.
- Unchanged from part 1: `SUPABASE_ACCESS_TOKEN` env secret, and the dashboard sources for live-only functions.

## Tokens

The estimate was 300k. The actual is about 200k in the main session plus about 360k in six reviewer sub-agents (two rounds on #502), so about 560k, **well over the cap**. The sub-agent reviews dominate (55–68k each). Next time, use a hard-capped reviewer prompt or a single reviewer per batch.
