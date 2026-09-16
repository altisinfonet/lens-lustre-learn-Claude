# G10 — PHASE 0 FINAL CLOSURE · §15 EMAIL ROW RECORDED

**2026-08-26. Read-only. Nothing modified, deployed, invoked, merged, pushed or configured.**
G10 scope only.

---

# PART 1 — §15 TESTING MATRIX: EMAIL BEHAVIOUR ROW

Recorded per **option B** — accurately and conditionally. **This row is NOT GREEN.**

| Field | Entry |
|---|---|
| **Property** | Any email the staging lane sends carries staging links and a staging-identifiable sender |
| **Refusal** | No staging-triggered email carries a production link or reaches a production recipient list |
| **Policy (§8.8)** | **OPTION 1 — staging sends no email at all** (owner decision, 2026-08-26) |
| **Result** | **CONDITIONALLY TRUE as of 2026-08-26 ~11:5x UTC — NOT VERIFIED as a property** |
| **Condition** | Holds only while `site_settings` on staging contains **no** `smtp_settings` row with a non-empty `api_key` |
| **Evidence** | (1) Deployed staging source of all four email functions retrieved and inspected this session — 59 files, byte-exact. (2) `select count(*) from site_settings where key='smtp_settings'` on `ztzutckwdhetphwghuzj` → **0**, measured 2026-08-26. |
| **Instrument** | Deployed-source inspection + live row count. **No sent-message inspection was performed** — §15 names that instrument and it has not been used. |

### Why it is conditional and not proven

Three of the four functions **cannot send under any credential state** — proven from deployed code.
`send-transactional-email`, `send-reengagement-emails` and `auth-email-hook` read no provider
credential and have no external transport; they render and `rpc('enqueue_email', …)` into pgmq.

`process-email-queue` is the **sole egress point** and it defeats the claim. Deployed lines 118-135
resolve the Brevo key with the **database taking precedence** over the environment secret — its own
comment states the design — and the `if (!brevoApiKey)` guard at line 141 runs *after* that resolution.
**An unset `BREVO_API_KEY` is therefore not sufficient to prevent a send.** One `site_settings` row
would re-arm sending with no deploy and no code change.

### Two facts that belong in the release record

- **If staging ever did send, it would send from the production sender domain.** Deployed line 313
  sets `AUTHENTICATED_SENDER_DOMAIN = '50mmretina.com'` and line 315 rewrites every outgoing sender to
  that domain regardless of the queued value. Nothing gates it on lane. That is a direct §15 refusal
  violation waiting on a single database row.
- **A 200 from `send-transactional-email` never means an email was sent** — line 379 returns
  `{success: true, queued: true}`. Any future evidence must not read that as delivery.

### To convert this row to VERIFIED — OWNER ACTION

1. Confirm `BREVO_API_KEY` is unset/empty in staging's Edge Function secrets.
2. Re-run the `site_settings` count at the moment of the test.
3. Invoke staging `process-email-queue` with a `Bearer` token carrying `role: service_role`.
4. Observe HTTP **500** / `{"error":"No Brevo API key configured"}` — the line 144 response.
5. Record timestamp, literal response, and the step-2 count together.

**I cannot perform this.** Deployed lines 96-113 require a service-role Bearer token, so the test means
handling the service-role credential. **This is an owner action.** My earlier offer to run it on your
authorisation was wrong and is withdrawn.

---

# PART 2 — PHASE 0 GAPS CLOSED

## 0.8 — DNS: now 19 of 19 — **VERIFIED**

The six previously unenumerated records were all TXT:

| Name | Type | Purpose | Proxy | TTL |
|---|---|---|---|---|
| `50mmretina.com` | TXT | `v=spf1 include:spf.stackmail.com…` — SPF | DNS only | Auto |
| `50mmretina.com` | TXT | Brevo domain-verification token *(value deliberately not recorded)* | DNS only | 1 hr |
| `50mmretina.com` | TXT | Brevo domain-verification token, second *(value not recorded)* | DNS only | 1 hr |
| `50mmretina.com` | TXT | Google site-verification token *(value not recorded)* | DNS only | 1 hr |
| `_dmarc.50mmretina.com` | TXT | `v=DMARC1; p=none; rua=…` | DNS only | 1 hr |
| `_dmarc.www.50mmretina.com` | TXT | `v=DMARC1; p=none; pct=100; …` | DNS only | 1 hr |

Verification-token bodies are **deliberately not recorded** — they are credentials of a kind and the
baseline does not need them. Names, types and purposes are sufficient for Phase 9 reconciliation.

**Observation, not a G10 gate:** both DMARC records are **`p=none`** — monitoring only, no enforcement.
Backlog, not this release.

An attempt to extract the full SPF/DMARC strings was **refused by this environment's safety
classifier** and was not worked around. Nothing in the baseline depends on those bodies.

## 0.9 — R2 configuration: **VERIFIED**

| | `50mm` (production) | `50mm-staging` (staging) |
|---|---|---|
| Created / Location | Mar 7 2026 · **APAC** | Aug 22 2026 · **ENAM** |
| Custom domain | `cdn.50mmretina.com` — Active, Access **Enabled** | `cdn-staging.50mmretina.com` — Active, Access **Enabled** |
| Minimum TLS | **1.0** | **1.0** |
| **Public Development URL** | 🔴 **ENABLED** — `pub-f3e7af944f2746b7bb4fb6e679dd78de.r2.dev` | ✅ **DISABLED** |
| CORS allowed origins | `https://www.50mmretina.com`, `https://50mmretina.com`, `https://lens-lustre-learn-claude.pages.dev`, `https://localhost` | `https://staging.50mmretina.com` **only** |
| CORS methods / headers | PUT, GET, HEAD / `*` | GET, PUT, HEAD / `*` |
| Lifecycle | Default multipart abort after 7 days | identical |
| Bucket lock / Event notifications / On-demand migration / Data catalog | none / none / off / off | identical |
| Storage class | Standard | Standard |

### G8 lane isolation — confirmed at configuration level

**Staging CORS admits only the staging origin; production CORS admits no staging origin.** Separate
buckets, separate custom domains, separate regions, and staging exposes no public development URL.
This is the strongest configuration-level evidence for G8 recorded so far.

### 🔴 Finding — production has a second public egress path

The production bucket's **Public Development URL is enabled**, so every object in `50mm` is reachable
at a `pub-….r2.dev` address that bypasses `cdn.50mmretina.com` entirely — no Cloudflare Access, no
caching, rate-limited by design. **Staging has this disabled; production does not.** The production
CSP's `img-src` explicitly allows `https://*.r2.dev`, so the application is permitted to load from it.

**Not a G10 gate** — surface 5 is NOT-EXPECTED-TO-CHANGE and this release does not touch R2, and
disabling it now would be an unplanned production change. **Recorded for the backlog**, and noted here
because `ISOLATION_EXPECTED_HOST` is `cdn.50mmretina.com`: whether a `pub-….r2.dev` reference in a
bundle would be caught by the isolation guard is **NEED EVIDENCE**, not asserted either way.

**Second observation:** both custom domains enforce a **minimum TLS of 1.0**, which is deprecated.
Backlog, not this release.

## 0.8 — Zero Trust: **BLOCKED**

Three attempts — two direct URLs and one navigation click — did not reach the Access applications
list. Not pursued further rather than guessing URLs. This remains **G1 half (a)**, already assigned to
the OWNER at runbook step 4.8.

---

# PHASE 0 — FINAL STATE

| Step | Result |
|---|---|
| 0.0 ten-surface inventory | DRAFTED — owner confirmation outstanding |
| 0.1 Pages config + 10 variables | **VERIFIED** |
| 0.2 robots.txt / sitemap.xml / `_headers` / apex behaviour | **VERIFIED** (byte-exact) |
| 0.3 schema fingerprints (11) | **VERIFIED** |
| 0.4 error-rate baseline (2 windows) | **VERIFIED** |
| 0.5 deployment ID / commit / tree | **VERIFIED** |
| 0.6 71-row edge-function baseline | **VERIFIED** |
| 0.7 ruleset / environments / secret names | **VERIFIED** |
| **0.8 DNS — 19 of 19** | **VERIFIED** |
| **0.8 Zero Trust** | **BLOCKED — owner** |
| **0.9 R2 — buckets, domains, CORS, public access, lifecycle** | **VERIFIED** |

**Phase 0 is complete except Zero Trust**, which is an owner item by design.

---

# WHAT REMAINS BEFORE PHASE 2

Unchanged and all owner-side:

1. **HS-10 — Supabase PAT** rotated, with the old credential *tested* dead.
2. **HS-10 — the other two exposure occurrences** identified, or declared unidentifiable.
3. **HS-10 — Brevo key**: rotate, and rule on the ongoing per-invocation partial logging in production.
4. **HS-10 — production `site_settings.smtp_settings`**: does it hold a non-empty `api_key`? (My
   read-only existence check was refused by the safety classifier.)
5. **§15 email row** — convert from conditional to verified via the five-step owner test above.
6. **§14 ruling** recording G9 as EXCLUDED with its named residual risk.
7. **Zero Trust** baseline read.

**§17-3 fails while 1–4 stand, and §17-3 gates all twelve lines. Phase 2 must not begin.**

*Read-only throughout. No secret value, fragment or hash displayed or recorded. Two read-only actions
were refused by the safety classifier and neither was worked around.*
