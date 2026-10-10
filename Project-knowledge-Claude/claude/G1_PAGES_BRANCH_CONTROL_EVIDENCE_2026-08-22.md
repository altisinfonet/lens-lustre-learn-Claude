# G1 — PAGES BRANCH CONTROL / PRODUCTION ISOLATION

Date: 2026-08-22
Scope: WEB STAGING ONLY. Phase 1–5 not touched. Judging Panel not touched.

# G1 = **RED**

**The invariant G1 exists to establish is currently violated, and the violation
is confirmed by live measurement — not inferred.** Arbitrary branches of this
repository are being deployed to public URLs by the production Cloudflare Pages
project, and those deployments are wired to the **production Supabase database**.

Nothing was modified. The required change needs the Cloudflare dashboard, which
this session cannot reach.

---

## 1. What I could establish without a dashboard

The Cloudflare MCP available here exposes R2, KV, D1, Hyperdrive, Workers and
docs — **there is no Pages tool** — and the sandbox proxy blocks `curl`/`dig` to
these hosts. However `WebFetch` reaches public endpoints, which was enough to
measure the Pages project's actual behaviour from the outside.

### Evidence E1 — the Pages project name

`https://lens-lustre-learn-claude.pages.dev` serves the live application
(title: *"50mm Retina World — Competitions, Education & Journal for
Photographers"*).

→ **Pages project name = `lens-lustre-learn-claude`.** (Audit item 1 — ANSWERED)

### Evidence E2 — arbitrary branch previews are ENABLED

Cloudflare Pages exposes a branch deployment at
`<branch-alias>.<project>.pages.dev`. Two non-`main` branches were probed:

| URL | Result |
|---|---|
| `staging-schema-dump-tool.lens-lustre-learn-claude.pages.dev` | **serves the real application** |
| `staging-web-isolation-guard.lens-lustre-learn-claude.pages.dev` | **serves the real application** |
| `staging.lens-lustre-learn-claude.pages.dev` | **404** — the `staging` branch does not exist yet |

→ **Preview deployments are enabled for arbitrary branches.** (Items 3 and 4 —
ANSWERED, and Finding C-1 of the architecture audit is CONFIRMED REAL.)

The third row is the important one: it is the **baseline for verification**.
That URL is 404 today *only because the branch does not exist*. If branch
control is not changed first, creating `staging` will make it live.

### Evidence E3 — those previews are wired to PRODUCTION Supabase

This is the decisive measurement.

`dist/_redirects` is generated at build time by `scripts/generate-redirects.mjs`
as `/sitemap.xml  ${VITE_SUPABASE_URL}/functions/v1/sitemap  200`, and that
script **refuses to emit and exits 1** if `VITE_SUPABASE_URL` is unset or
malformed. So `/sitemap.xml` on any deployment is a direct, unforgeable readout
of which Supabase project that build was given.

| URL | `/sitemap.xml` result |
|---|---|
| `lens-lustre-learn-claude.pages.dev` (production branch) | XML sitemap, **12 url entries**, first three `loc`: `https://50mmretina.com/`, `/discover`, `/feed` |
| `staging-schema-dump-tool.lens-lustre-learn-claude.pages.dev` (arbitrary branch) | XML sitemap, **12 url entries**, **identical first three `loc` values** |

And, from the Supabase MCP:

> staging project `ztzutckwdhetphwghuzj` — **edge functions deployed: 0**

Staging therefore cannot serve `/functions/v1/sitemap` at all; it would 404. A
populated, production-identical sitemap can only have come from
`jtdtehuqtinjxropkkcn`.

→ **Arbitrary-branch preview deployments build and run against the PRODUCTION
Supabase project.**

Two further conclusions follow:

- The branch `staging/schema-dump-tool` was created on 2026-08-22, *after* PR #87
  removed the committed `.env`. Its preview build therefore could only have
  succeeded if **Preview environment variables are configured and contain a
  valid production `VITE_SUPABASE_URL`**. (Item 6 — partially answered by
  behaviour; the variable *names* still require the dashboard.)
- Every one of the repository's ~100 branches, including the 34 automatic
  `altisinfonet-patch-*` branches, is eligible for a public deployment with a
  production backend.

### Evidence E4 — DNS

Queried via DNS-over-HTTPS (`dns.google/resolve`), authoritative nameservers
`dell.ns.cloudflare.com` / `dns.cloudflare.com`:

| Name | Status | Records |
|---|---|---|
| `50mmretina.com` | NOERROR | A `172.67.185.135`, `104.21.40.112` (proxied pair, TTL 300) |
| `www.50mmretina.com` | NOERROR | A `185.158.133.1` (single, TTL 3600 — consistent with a Pages custom-domain binding); no CNAME |
| `cdn.50mmretina.com` | NOERROR | A `104.21.40.112`, `172.67.185.135` (proxied pair, TTL 300) |
| **`staging.50mmretina.com`** | **NXDOMAIN** | **does not exist** |
| `cdn-staging.50mmretina.com` | **NXDOMAIN** | does not exist |

→ Item 10 — ANSWERED: **`staging.50mmretina.com` does not exist.** The apex and
`cdn` share a proxied IP pair; `www` is bound differently, consistent with the
Pages custom domain and with the `seo-edge-injector` Worker rewriting apex → www.

## 2. Audit items — status after this pass

| # | Item | Status |
|---|---|---|
| 1 | Pages project name | ✅ `lens-lustre-learn-claude` (E1) |
| 2 | Production branch | ⚠️ `main` is strongly implied (the apex project alias serves production content) but **not read from the dashboard** |
| 3 | Preview deployment setting | ✅ enabled (E2) |
| 4 | Previews for arbitrary branches | ✅ **YES — confirmed live** (E2, E3) |
| 5 | Production env var **names** | ❌ dashboard required |
| 6 | Preview env var **names** | ❌ dashboard required (behaviour proves a production Supabase URL is among them — E3) |
| 7 | Build command | ❌ dashboard required |
| 8 | Output directory | ❌ dashboard required |
| 9 | Custom domains | ⚠️ `www.50mmretina.com` consistent with a Pages binding (E4); full list needs the dashboard |
| 10 | `staging.50mmretina.com` exists? | ✅ **NO — NXDOMAIN** (E4) |
| 11 | `seo-edge-injector` route pattern | ❌ dashboard required. Worker exists, id `7e107d22666a4f9d88d8e40d12eba962`, last modified 2026-07-11 |
| 12 | Could a future `staging` branch build against production? | ✅ **YES — and it would. Answered by measurement, not opinion.** |

## 3. What changed / what did not

- **Changed: nothing.** No GitHub, Cloudflare, Supabase, R2, production or
  staging modification was made in this gate.
- All probes were HTTP GETs of public URLs plus one read-only Supabase MCP call
  (`list_edge_functions` on staging).

## 4. The minimum change required to close G1

Establish: *production Pages deploys only from `main`, and no arbitrary branch
is deployed automatically.*

**Change 1 — stop future arbitrary-branch previews.**
Cloudflare dashboard → **Workers & Pages** → **`lens-lustre-learn-claude`** →
**Settings** → **Build** → **Branch control**:

- Confirm **Production branch** = `main` (record it — this closes item 2).
- Set **Preview deployments** to **None**.
  (If previews are wanted later, the safe form is *Custom branches* with an
  explicit include list — never "All non-production branches".)

**Change 2 — the existing exposures do not disappear on their own.**
Disabling previews stops *new* builds. The already-published deployments stay
live at their URLs. In the same project → **Deployments** → filter **Preview** →
delete the deployments for `staging-schema-dump-tool` and
`staging-web-isolation-guard` (and any other non-`main` branch listed).

Nothing else is authorised in G1. Production branch, build command, output
directory, custom domains and all environment variables are to be **read and
recorded, not modified**.

## 5. Read-and-record while in the dashboard (names only, never values)

- Settings → **Variables and Secrets**: the variable **names** in **Production**
  and in **Preview** (items 5, 6). Do not reveal secret values.
- Settings → **Build**: build command (item 7), output directory (item 8),
  root directory, Node version source.
- **Custom domains** tab: full list (item 9).
- **Workers & Pages → seo-edge-injector → Settings → Domains & Routes**: the
  route pattern (item 11). If it is zone-wide (e.g. `*50mmretina.com/*`) it will
  later intercept `staging.50mmretina.com` and inject production SEO — that is a
  G7 problem, **not** to be changed now.

## 6. Independent verification I will run afterwards

These are falsifiable and do not require dashboard access:

| Probe | Required result after the change |
|---|---|
| `staging-schema-dump-tool.lens-lustre-learn-claude.pages.dev` | **404** |
| `staging-web-isolation-guard.lens-lustre-learn-claude.pages.dev` | **404** |
| `lens-lustre-learn-claude.pages.dev` | still serves the site — production unaffected |
| `lens-lustre-learn-claude.pages.dev/sitemap.xml` | still 12 entries, same first three `loc` values |
| `www.50mmretina.com` DNS | unchanged: A `185.158.133.1` |
| **After G2 creates the branch:** `staging.lens-lustre-learn-claude.pages.dev` | **must remain 404** |

The last row is the real proof of the invariant and can only be run once the
branch exists. G1 closes on the first five; the sixth is re-checked inside G2.

## 7. Remaining risk

1. **Live exposure until Change 1 + 2 are applied.** Public URLs serve
   unreviewed branch code against the production database. Any write path
   exercised from those URLs writes to production data. This predates the
   staging workstream; it is not caused by it.
2. **Items 5–9 and 11 remain unread.** G1 cannot be called fully closed on
   evidence alone while the variable names, build command, output directory,
   custom domain list and Worker route are unknown.
3. **The build command may not include the isolation guard.** If Pages runs only
   `npm run build`, then `verify:isolation` never runs on the thing that actually
   ships, and the guard is only enforced in the GitHub Actions mirror. Unknown
   until item 7 is read.
4. **`ISOLATION_FORBIDDEN_REFS` is empty on the production lane** (`web-build.yml`
   sets `""`), so the production build currently performs no leak check at all.
   That is G6, already scheduled, not G1.

## 8. Exact next gate

**G1 is not closed.** The next action is the dashboard change and readback above
(Changes 1 and 2, plus the read-and-record list), followed by my six
verification probes. Only then does G1 go GREEN.

**G2 (create the `staging` branch) must not start until it does** — creating the
branch before Change 1 would immediately publish
`staging.lens-lustre-learn-claude.pages.dev` against the production database,
which is precisely the failure G1 exists to prevent.
