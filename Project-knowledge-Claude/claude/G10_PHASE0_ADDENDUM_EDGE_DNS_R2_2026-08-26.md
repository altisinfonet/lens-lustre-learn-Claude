# G10 PHASE 0 ADDENDUM 2 — EDGE ARTEFACTS, DNS, R2 (steps 0.2, 0.8, 0.9)

**Captured 2026-08-26, ~11:15–11:25 UTC. Read-only.**
Completes the items `G10_PHASE0_BASELINE_2026-08-26.md` recorded as BLOCKED or PARTIAL.
Bundle item 15.

---

## 0.2 — BYTE-EXACT EDGE ARTEFACTS — now VERIFIED

Measured in-page against the live production origin with `crypto.subtle.digest` over the raw
`arrayBuffer`, so these are hashes of the **served bytes**, not of a rendered transcription.

| Artefact | Status | Bytes | sha256 |
|---|---|---|---|
| `robots.txt` (www) | 200 | 892 | `2149c780953795d41c083c143642d60befb0a0d8093ddde1f6412fcd761d9d4f` |
| `robots.txt` (apex) | 200 | 892 | `2149c780953795d41c083c143642d60befb0a0d8093ddde1f6412fcd761d9d4f` |
| `sitemap.xml` (www) | 200 | 1433 | `11b27c08065afe6c4d7fb481f12b40a34311d1c43f31b338296481b89e8c24f8` |

`sitemap.xml` is a `<urlset>` — **not** a sitemap index — carrying **12 `<loc>` entries**.

> **Observation, not a verdict.** Twelve URLs is small for a site with competitions, discover,
> journal, courses, certificates, winners and featured-artist sections, several of which `_headers`
> gives dedicated edge-cache rules. Whether 12 is the intended surface is **NEED EVIDENCE** — it is
> the §18 SEO baseline either way, and §18 compares against it rather than judging it.

---

## 🔴 CORRECTION — THERE IS NO APEX → WWW REDIRECT

The runbook's step 0.2 asks for "the apex→www redirect status code". **That redirect does not exist.**
Three independent instruments agree:

1. **DNS.** `50mmretina.com` is a **CNAME to `lens-lustre-learn-claude.pages.dev`, Proxied** — the same
   target as `www.50mmretina.com`. The apex is served directly by the Pages project; it is not
   redirected anywhere.
2. **Navigation timing.** Loading the apex reported `redirectCount = 0`.
3. **Content identity.** `robots.txt` from the apex and from www return the **same 892 bytes and the
   same sha256**, which is what serving the same deployment looks like, not what a redirect looks like.

A browser opened at the apex does end up on `www` — but that is the SPA's own client-side routing
after load, not an HTTP redirect. Under HS-11 those two must not be conflated, and the earlier
"consistent with no redirect" note is now upgraded to a positive finding.

### Why this matters more than it sounds

`_headers` sets `Access-Control-Allow-Origin: https://50mmretina.com` (apex) while `SITE_ORIGIN` is
`https://www.50mmretina.com` (www). Because there is **no redirect consolidating the two**, the site
genuinely runs on **two live origins**, and the ACAO header names only one of them. This is a live
inconsistency in the production configuration, not a cosmetic mismatch.

It is **not** in this release's scope and must not be fixed during G10 — doing so would be an
unplanned change to Pages configuration (surface 2). It is recorded here so that:

- §15's SEO/headers row and §18's origin row are read knowing two origins are live;
- decision 1.3 (G9 / CORS) is made knowing the production CORS surface already has an apex/www
  mismatch independent of the `secureHeaders.ts` question;
- it enters the post-G10 backlog rather than being discovered during promotion.

**Runbook step 0.2 should be reissued** to ask for "the apex behaviour" rather than "the apex→www
redirect status code", which presupposes a redirect that is not there.

---

## 0.8 — DNS — VERIFIED (records); Zero Trust NOT CAPTURED

Zone `50mmretina.com`, DNS Setup **Full**, plan free, **19 records total**, no recommendations
outstanding. Thirteen were captured by name; the remainder (TXT/verification records) were not
enumerated and are recorded as **not captured**, not as absent.

| Name | Type | Content | Proxy |
|---|---|---|---|
| `50mmretina.com` | CNAME | `lens-lustre-learn-claude.pages.dev` | **Proxied** |
| `www.50mmretina.com` | CNAME | `lens-lustre-learn-claude.pages.dev` | **Proxied** |
| `staging.50mmretina.com` | CNAME | `lens-lustre-learn-claude-staging.pages.dev` | **Proxied** |
| `cdn.50mmretina.com` | **R2** | bucket `50mm` | **Proxied** |
| `cdn-staging.50mmretina.com` | **R2** | bucket `50mm-staging` | **Proxied** |
| `autodiscover` · `imap` · `pop3` · `smtp` | CNAME | `*.stackmail.com` | DNS only |
| `webmail` | CNAME | `stackmail.com` | Proxied |
| `brevo1._domainkey` · `brevo2._domainkey` | CNAME | `b1/b2.50mmretina-com.dkim.brevo.com` | DNS only |
| `50mmretina.com` | MX | `mx.stackmail.com` (priority 10) | DNS only |

**Lane mapping confirmed at DNS level** — production `cdn.` → `50mm`, staging `cdn-staging.` →
`50mm-staging`, production site → `lens-lustre-learn-claude`, staging site →
`lens-lustre-learn-claude-staging`. This is the mapping the isolation guard's
`ISOLATION_EXPECTED_HOST` / `ISOLATION_FORBIDDEN_HOSTS` values encode, and it matches them exactly.

**Zero Trust Access applications and policies: NOT CAPTURED — BLOCKED.** Two dashboard paths were
tried and both returned "We could not find that page". Rather than guess further URLs, this is left
open. It is **G1 half (a)** and the runbook already assigns that half to the OWNER at step 4.8.

---

## 0.9 — R2 — VERIFIED (buckets); policies NOT CAPTURED

| Bucket | Created | Location | Storage class | Jurisdiction | Custom domain (from DNS) |
|---|---|---|---|---|---|
| `50mm` | 2026-03-07T12:19:15Z | **APAC** | Standard | default | `cdn.50mmretina.com` |
| `50mm-staging` | 2026-08-21T19:22:35Z | **ENAM** | Standard | default | `cdn-staging.50mmretina.com` |
| `agentcrm` | 2025-12-11T13:17:22Z | — | — | — | unrelated to this project |

> **Observation:** the two lanes' buckets are in **different regions** — production APAC, staging
> ENAM. Not a defect, and not something to change during G10, but it means latency and any
> data-residency expectation differ between lanes, and a staging measurement of object-serving
> behaviour is not automatically representative of production.

**Per-bucket public-access setting and CORS policy: NOT CAPTURED.** The available tooling does not
expose them. Step 4.7 (G8 freshness) needs them and they must be read from the R2 dashboard.

---

## PHASE 0 — FINAL STATUS

| Step | Result |
|---|---|
| 0.0 ten-surface inventory | **DRAFTED** — owner confirmation needed; rows 9 and 10 depend on decision 1.4 |
| 0.1 Pages config and variables | **VERIFIED** |
| 0.2 `robots.txt`, `sitemap.xml`, `_headers`, apex behaviour | **VERIFIED** (byte-exact) |
| 0.3 schema fingerprints (11) | **VERIFIED** |
| 0.4 error-rate baseline, two windows | **VERIFIED** |
| 0.5 deployment ID, source commit, tree | **VERIFIED** |
| 0.6 71-row edge function baseline | **VERIFIED** |
| 0.7 ruleset, environments, secret names | **VERIFIED** |
| 0.8 DNS | **VERIFIED** (13 of 19 records by name) |
| 0.8 Zero Trust | **BLOCKED** — dashboard path not found; G1(a), owner |
| 0.9 R2 buckets and custom domains | **VERIFIED** |
| 0.9 R2 public access and CORS policy | **NOT CAPTURED** — needed for step 4.7 |

**Three items remain open, all owner-side or dashboard reads: Zero Trust policies, R2 public
access/CORS, and the six unenumerated DNS records.** None blocks Phase 1.

---

## THE TWO RUNBOOK CORRECTIONS PHASE 0 PRODUCED

Recorded rather than silently patched, so the change is visible:

1. **Decision 1.4** — option (A) was unworkable: the `staging` GitHub environment holds zero secrets,
   so a guard bound to it would report green having connected to no database. Reissued as **A1 / A2 / B**
   in runbook **Revision 2.2**. Both A options also require turning ON "Require status checks to pass",
   currently OFF, which changes surface 9.
2. **Step 0.2** — asks for an apex→www redirect status code. **No such redirect exists.** The step
   should ask for apex behaviour instead.

---

*Read-only throughout. No production, staging or repository write. No secret value observed, hashed
or recorded. Hashes above are of publicly served, non-secret artefacts.*
