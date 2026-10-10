# 🟢 HS-1 CLOSED — PRODUCTION IS NOW A SINGLE CONTROLLED SERVING PATH

**Closed 2026-08-23, 04:51 UTC.** Rev 3.0 §14 HS-1, Erratum E-1 clause 8.
Production change **PROD-CHG-20260823-004**, owner-executed, verified independently.
`origin/main` `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` — unchanged.

---

## 1. WHAT WAS WRONG

`www.50mmretina.com` was a **DNS-only** A record to `185.158.133.1`, a
third-party host. Traffic never entered Cloudflare, so `_headers`, the WAF,
Access and the build-time isolation guard did not apply — and the shipped
`index.html` redirects every apex visitor to that hostname. Members landed on
the uncontrolled path, which was production-Supabase-connected.

## 2. THE CHANGE

| | Before | After |
|---|---|---|
| Type | `A` | **`CNAME`** |
| Content | `185.158.133.1` | **`lens-lustre-learn-claude.pages.dev`** |
| Proxy | **DNS only** | **Proxied** |
| TTL | 1 hr → 300 (staged for rollback) | Auto (edge-managed) |

Attached as a Pages custom domain on `lens-lustre-learn-claude`. Record replaced
in place — zone still 17 of 200 records, nothing added or removed. Apex, `cdn`,
the Worker's code/routes/variables and the Preview environment all untouched.

**A guardrail of mine was wrong and was corrected before execution.** I had said
"do not touch the seo-edge-injector Worker"; the browser agent correctly refused
to proceed, because attaching `www` makes the record proxied and therefore
activates that Worker's dormant `www.50mmretina.com/*` route. Clarified: the
instruction meant do not edit its code, routes or variables — activation is the
entire point. Loop risk was ruled out from source: `ORIGIN_HOST` is
`lens-lustre-learn-claude.pages.dev`, never the request hostname, and the apex
already runs that exact path.

## 3. THE SEVEN VERIFICATIONS

| # | Check | Result |
|---|---|---|
| 1 | `www` controlled by Cloudflare | **✅ Both authoritative nameservers** return `172.67.185.135`, `104.21.40.112` — Cloudflare anycast. SOA `2410539482 → 2412945288`. Known-absent control NXDOMAIN on all four resolvers in the same run |
| 2 | Worker / Pages serving path | ✅ Record proxied — the precondition for the route — and the entry script serves from the `www` origin |
| 3 | Production artifact | ✅ `index-CQNRLXfL.js`, 481,335 B compressed / 1,565,901 B raw, plus `index-BLWQIo4R.css`. **Byte-identical to what `www` served before**, as predicted from the content-hash probes |
| 4 | Supabase connectivity | ✅ `/rest/v1/site_settings` ×8, `/rest/v1/faq_entries`, `/functions/v1/dashboard-init` — all **200** to `jtdtehuqtinjxropkkcn.supabase.co` |
| 5 | apex → `www` | ✅ `https://50mmretina.com` lands on `https://www.50mmretina.com/feed`. The 2026-08-05 redirect is intact |
| 6 | Old uncontrolled path | ✅ Neither authoritative server points at `185.158.133.1`. Residual recursive caches expire on their own TTLs. The host stays up deliberately — it is the rollback target |
| 7 | Independent post-change verification | ✅ DNS by this session against both authoritative servers and four recursive resolvers with a discriminating control; runtime by browser with DevTools |

**No outage at any point.** TLS clean on both hostnames, no console errors, page
renders complete.

## 4. NOTED, NOT ATTRIBUTED TO THE CUTOVER

- One `google-analytics.com/g/collect` **503** on a single load. Google's
  endpoint, outside this infrastructure. Recorded because if today's analytics
  look light, this is the candidate cause — rather than assuming the cutover
  dropped traffic.
- Transfer sizes unreadable for the Supabase calls: cross-origin responses do
  not expose size without `Timing-Allow-Origin`. A measurement limit, not a
  zero-byte response. The 200s are real.
- Recursive caches converge as TTLs expire; one Google node still held the old
  A at 04:51. Authoritative is the source of truth and both servers agree.

## 5. WHAT THE ARCHITECTURE IS NOW

```
50mmretina.com      proxied ─► Worker seo-edge-injector ─► Pages  ✅ controlled
www.50mmretina.com  proxied ─► Worker seo-edge-injector ─► Pages  ✅ controlled
                                (was: direct to 185.158.133.1, uncontrolled)
```

**Both production hostnames now traverse Cloudflare and terminate at the
controlled Pages project.** Erratum E-1's Path A / Path B split described a real
condition that no longer exists. The distinction stays in the record as history;
it is no longer an operating rule.

## 6. ROLLBACK — still available

Edit the `www` row back to `A / 185.158.133.1 / DNS only`, which also re-dormants
the Worker route. The third-party deployment was deliberately left running.
Do not delete it until a soak period has passed.

## 7. CHANGE LEDGER

| Field | **PROD-CHG-20260823-004** |
|---|---|
| Paths affected | **Production `www` hostname** — first authorized production mutation in this project |
| Before | `A www → 185.158.133.1`, DNS only, TTL 3600 → 300; SOA `2410539482` |
| After | `CNAME www → lens-lustre-learn-claude.pages.dev`, Proxied, TTL Auto; SOA `2412945288` |
| Files changed | None — DNS and Pages configuration only |
| Reason | Close HS-1: bring the hostname members actually land on under the controls |
| Environment impact | §16 Cloudflare DNS + Pages custom domain. No repository, no deployment, no database, no R2, no Worker edit |
| Verification | §3, all seven items, executed post-change |
| Rollback | §6, recorded pre-change while the old value was live |
| Classification | **VERIFIED** |

## 8. GATE STATUS

| Gate | State |
|---|---|
| G0–G6, G5b | **GREEN — COMPLETE** |
| **HS-1** | **CLOSED** |
| G7 | **UNBLOCKED** — staging Pages project + two DNS records, owner-only |
| G8, G9, §15, RC | Sequenced behind G7 |
| G10 | Blocked on HS-12 — branch protection on `main` |
