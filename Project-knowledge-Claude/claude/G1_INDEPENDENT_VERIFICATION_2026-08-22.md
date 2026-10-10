# G1 — INDEPENDENT VERIFICATION

Verified by: Cowork session (no browser; HTTP + DNS + Supabase MCP only)
Change applied by: browser session — Preview branch → None; Preview access → Restricted (09:24 UTC)
Verification run: **2026-08-22 09:27–09:29 UTC**

# G1 = **AMBER**

The invariant G1 exists to establish **is met and independently verified**.
AMBER, not GREEN, for three residuals listed in §4 — one of which is a factual
failure of the exit criterion as you wrote it.

---

## 1. Two corrections to my own prior work — read these first

### 1.1 My E3 "proof" was worthless

In `G1_PAGES_BRANCH_CONTROL_EVIDENCE_2026-08-22.md` I argued that a branch
preview serving a production-identical `/sitemap.xml` proved the preview was
wired to production Supabase, because `_redirects` is generated from
`VITE_SUPABASE_URL`.

**That reasoning was wrong, on two independent counts:**

1. **`public/sitemap.xml` is a committed static file.** 1,433 bytes, exactly
   **12 `<loc>` entries**, first three `https://50mmretina.com/`, `/discover`,
   `/feed` — precisely what I observed. Vite copies it into `dist` on every
   build. It is byte-identical no matter which Supabase project a build points
   at. It proves nothing about the backend.
2. **Cloudflare never applied the redirect anyway.** The browser session's deploy
   log read `Parsed 0 valid redirect rules.` and rejected
   `/sitemap.xml → https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/sitemap 200`.
   Cloudflare Pages does not accept a 200-rewrite to an external origin.

The **conclusion** was nonetheless correct, and is now properly evidenced from
the configuration side by the browser session: the **Preview environment
variables contain the production Supabase project**, and Preview carries **no
`ISOLATION_FORBIDDEN_REFS`**. That is direct proof; my sitemap argument was a
coincidence dressed as evidence.

### 1.2 I nearly published a false RED

My first two verification probes returned the two preview URLs still serving the
application. They were **my own 15-minute WebFetch cache replaying pre-change
content** — the exact hazard I had written into
`G1_PRECHANGE_BASELINE_2026-08-22.md` hours earlier. Only a controlled retest
caught it. Cached probes are not measurements.

## 2. The controlled test that settles it

Same path, same minute, never fetched before, no query string — only the host
differs:

| URL | Result |
|---|---|
| `staging-web-isolation-guard.lens-lustre-learn-claude.pages.dev/robots.txt` | **ROBOTS_DISALLOWED** — the request is redirected to `cloudflareaccess.com`, whose robots.txt forbids crawlers. The preview host no longer serves content anonymously. |
| `lens-lustre-learn-claude.pages.dev/robots.txt` | **served the real robots.txt** |

A cache-busted `staging-schema-dump-tool…/sitemap.xml?cb=…` gave the same
`ROBOTS_DISALLOWED`. The redirect to the Access host *is* the gate, observed from
outside the browser that applied it.

## 3. Verification battery — results

| # | Check | Result |
|---|---|---|
| 1 | `staging-schema-dump-tool…pages.dev` no longer public | ✅ Access redirect |
| 2 | `staging-web-isolation-guard…pages.dev` no longer public | ✅ Access redirect |
| 3 | `lens-lustre-learn-claude.pages.dev` still serves | ✅ fresh fetch served |
| 4 | Production content unchanged | ✅ `50mmretina.com/robots.txt` served normally |
| 5 | `www.50mmretina.com` DNS unchanged | ✅ A `185.158.133.1`, TTL 3600 — identical to baseline |
| 6 | Production Supabase unchanged | ✅ see below |
| 7 | Staging Supabase untouched | ✅ 146 tables, **0 rows**, 0 auth users, 0 `site_settings` rows |

**Production Supabase at 09:28:51 UTC vs baseline 09:04:26 UTC — every value identical:**
146 tables · 101 `auth.users` · 4 vault secrets, fingerprint
`b24756b6dc7da53fe1a885b25e241ed7` · 16 cron jobs · 11 storage buckets ·
ledger 32 / `20260820181949` · posts **267** (unchanged) ·
`s3_storage_settings.updated_at` `2026-03-07 13:48:18.332+00`, bucket `50mm`.

## 4. Why AMBER and not GREEN

1. **The Access policy's allow-list is unverified.** Zero Trust is not onboarded
   on the account, so Access controls → Applications is behind a plan wall. The
   gate demonstrably blocks anonymous requests; **who it admits is unknown**, and
   the Pages UI offers no un-restrict control. A security control whose admission
   rule cannot be read is not a closed gate.
2. **Your exit criterion "no production resource was modified except the
   explicitly authorized G1 configuration change" is factually false.** Earlier in
   the browser session (~02:10 UTC, before G1 was scoped)
   `ISOLATION_FORBIDDEN_REFS=ztzutckwdhetphwghuzj` was added to the **Production**
   variables and a **production deployment was retried** (`9c0c1201`). Both are
   beneficial — that is G6 work — but they are production changes outside G1
   authorization and must be acknowledged, not absorbed silently.
3. **1,558 preview deployments still exist**, gated rather than removed. The
   exposure is mitigated; the artifacts remain, each with a permanent
   `<hash>.lens-lustre-learn-claude.pages.dev` URL, and everything built before
   PR #87 is wired to production Supabase by construction.

## 5. Confirmed GREEN by this gate

- **Production branch `main`, automatic production deployments enabled, Preview
  branch = None.** A future `staging` branch cannot build in this project.
- **The Pages build command runs the guard**:
  `npm run build && node scripts/verify-bundle-isolation.mjs`.
  This closes G1 residual risk #3 from the evidence report — the guard runs on
  what actually ships, not only in the Actions mirror.
- **`seo-edge-injector` routes are host-specific**: `50mmretina.com/*` and
  `www.50mmretina.com/*`, not a zone wildcard. **Audit Finding C-2 is resolved:
  the Worker will not intercept `staging.50mmretina.com`.** No change needed.
- **`staging.50mmretina.com` does not exist** (NXDOMAIN).

## 6. New architectural facts that change later gates

1. **`www.50mmretina.com` is NOT a custom domain on this Pages project.** The only
   custom domain is `50mmretina.com`. Combined with the Worker's
   `ORIGIN_HOST = lens-lustre-learn-claude.pages.dev`, `www` is served **through
   the `seo-edge-injector` Worker fetching the Pages origin**, not by Pages
   directly. G7 must wire `staging.50mmretina.com` deliberately — copying "how
   www works" would drag the Worker in.
2. **Preview variables lack `ISOLATION_FORBIDDEN_REFS`.** Moot while previews are
   disabled; it must be set before previews are ever re-enabled.
3. **`ISOLATION_FORBIDDEN_REFS` is now set on Pages Production but
   `web-build.yml` still passes `""`.** G6 is half-done: the deployed lane is
   guarded, the CI mirror is not.

## 7. Defect found while verifying — record only, NOT in scope

**The public sitemap is stale and the dynamic one is dead.**
`public/sitemap.xml` (12 URLs, last touched 2026-08-19) shadows a 216-line
`supabase/functions/sitemap`. `scripts/generate-redirects.mjs` exists solely to
route `/sitemap.xml` to that function, and Cloudflare **rejects the rule** — so
the script's entire output is inert and the live site serves a hardcoded
12-URL sitemap. Search engines have been reading the static file.

Side effect worth noting: the isolation guard's R2 rule ("expected ref present in
dist") is partly satisfied by `dist/_redirects`, a file Cloudflare discards. The
ref is also present in the JS bundle, so R2 remains meaningful — but the
`_redirects` contribution is an illusion.

This is a production SEO defect, not a staging one. **Not fixed, not touched.**

## 8. What would make G1 GREEN

1. Read the Access policy's allow-list (needs Zero Trust free-plan onboarding),
   or replace it with a control whose admission rule is inspectable.
2. Your explicit acknowledgement of the two out-of-scope production changes at
   ~02:10 UTC, or a decision to revert them.
3. A decision on the 1,558 preview artifacts: leave gated (acceptable), or remove
   via a scripted API sweep filtered on `environment != production` — never by
   hand in the dashboard.

## 9. Next gate

**G2 — create the `staging` branch and set branch protections.**
Not started. Awaiting authorization.

When it runs, the decisive probe is
`staging.lens-lustre-learn-claude.pages.dev` **remaining 404 after the branch
exists** — and it must be fetched with a URL never fetched before, or my cache
will hand back the pre-existing 404 and produce a **false GREEN**.
