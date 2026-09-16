# G1 — PRE-CHANGE BASELINE (locked before any Cloudflare modification)

Measured: **2026-08-22 09:04:26 UTC**
Nothing was modified. All values are read-only measurements.

## Cloudflare Pages — before state (measured externally, not from the dashboard)

| Probe | Result BEFORE the change |
|---|---|
| `lens-lustre-learn-claude.pages.dev` | 200, serves the production site |
| `lens-lustre-learn-claude.pages.dev/sitemap.xml` | XML, **12 url entries**, first three `loc`: `https://50mmretina.com/`, `/discover`, `/feed` |
| `staging-schema-dump-tool.lens-lustre-learn-claude.pages.dev` | **200 — serves the real application** |
| `staging-schema-dump-tool…/sitemap.xml` | **12 entries, identical to production** → wired to production Supabase |
| `staging-web-isolation-guard.lens-lustre-learn-claude.pages.dev` | **200 — serves the real application** |
| `staging.lens-lustre-learn-claude.pages.dev` | 404 (the `staging` branch does not exist) |

## DNS — before state (dns.google DoH; authoritative `dell.ns.cloudflare.com`)

| Name | Before |
|---|---|
| `50mmretina.com` | A `172.67.185.135`, `104.21.40.112` (TTL 300) |
| `www.50mmretina.com` | A `185.158.133.1` (TTL 3600), no CNAME |
| `cdn.50mmretina.com` | A `104.21.40.112`, `172.67.185.135` (TTL 300) |
| `staging.50mmretina.com` | **NXDOMAIN** |
| `cdn-staging.50mmretina.com` | **NXDOMAIN** |

## Production Supabase `jtdtehuqtinjxropkkcn` — before state

| Quantity | Value at 09:04:26 UTC |
|---|---|
| `public` tables | 146 |
| `auth.users` | 101 |
| `vault.secrets` | 4 |
| vault fingerprint (A2 formula: `name|description|created_at|updated_at`) | `b24756b6dc7da53fe1a885b25e241ed7` |
| `cron.job` | 16 |
| `storage.buckets` | 11 |
| migration ledger rows / max | 32 / `20260820181949` |
| `public.posts` | 267 |
| `site_settings.s3_storage_settings.updated_at` | `2026-03-07 13:48:18.332+00` |
| `site_settings.s3_storage_settings.bucket_name` | `50mm` |

### A note on the vault fingerprint, so it is not misread later

An intermediate query in this session produced `e4145eb8e8e1726ad66c7038a23e0952`
for the vault. That was **a different formula** (it omitted `description`), not a
change in the data. Re-run with the original A2 formula it returns
`b24756b6dc7da53fe1a885b25e241ed7`, matching the earlier measurement exactly.
**Only the A2 formula above is the comparison baseline.** This is the same class
of error as the earlier 730→686 policy count and the `relkind='v'` matview miss:
a changed measurement definition looking like a changed system.

## MEASUREMENT HAZARD for the post-change verification

`WebFetch` **caches each URL for 15 minutes.** The probes above were taken
minutes ago, so re-running them immediately would return cached results and prove
nothing.

- Re-probing too soon after the change → cached `200` on the two preview URLs →
  a **false RED**.
- In G2, re-probing `staging.lens-lustre-learn-claude.pages.dev` too soon after
  the branch is created → cached `404` → a **false GREEN**, which is the
  dangerous direction.

**Rule: leave at least 15 minutes between the change and the verification
battery, and state the elapsed time in the verification report.**

## Still outstanding for G1

The two dashboard changes and the read-and-record list in
`OWNER_CARD_G1_CLOUDFLARE.md`. This session has no browser and the Cloudflare
MCP exposes no Pages tool (re-confirmed: R2, KV, D1, Hyperdrive, Workers, docs
only — 23 tools, no Pages).
