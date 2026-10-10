# 🔴 HS-1 — PATH B IS PRODUCTION-CONNECTED

**Declared 2026-08-22, 18:10 UTC.** Master Execution Plan Rev 3.0 §14 HS-1,
invoked through Erratum E-1 clause 8.

**ALL GATE EXECUTION IS STOPPED.** Nothing was remediated, repointed, deleted or
changed. No further probing. The owner rules on the response.

---

## 1. THE CONDITION

**`www.50mmretina.com` — Path B, the independently built and uncontrolled
serving path — is connected to the PRODUCTION Supabase project
`jtdtehuqtinjxropkkcn`.**

And the shipped `index.html` redirects every visitor arriving at the
Cloudflare-controlled apex to that path.

**Classification: VERIFIED.** Not inferred. Three independent lines of evidence,
all obtained through authorized read-only mechanisms, agree.

---

## 2. EVIDENCE

### Line 1 — Edge-function inventory versus observed preflight

Read through the authorized Supabase API at 18:08 UTC:

| Project | Edge functions |
|---|---|
| `ztzutckwdhetphwghuzj` — **staging** | **`{"functions":[]}` — zero, none deployed** |
| `jtdtehuqtinjxropkkcn` — **production** | 74 ACTIVE, including **`dashboard-init`**, id `350f09fa-c8b8-4cd3-8f93-2539eec9323c`, version 22, status ACTIVE |

The owner's browser capture of `https://www.50mmretina.com` shows:

```
dashboard-init      200      preflight      Preflight      0.0 kB     166 ms
```

A CORS preflight returns **200** only from a deployed function endpoint that
accepts the request's Origin. **Staging hosts no functions at all**, so no
preflight to staging could return 200 for `dashboard-init`. Only production
hosts a function by that slug.

**⇒ Path B's edge-function endpoint is the production project.**

### Line 2 — PostgREST responses carry data; staging holds none

The same capture shows, both initiated by Path B's own entry chunk
`index-CQNRLXfL.js:53`:

```
site_settings?select=value&key=eq.cache_buster    200  fetch  0.8 kB  278 ms
faq_entries?select=id,question,answer,keywords&is_active=eq.true&order=…
                                                  200  fetch  0.8 kB  269 ms
```

Both returned **0.8 kB of data**. The staging database was established from a
schema-only baseline and verified to contain **zero rows** — recorded in
`GATE2_STAGING_SCHEMA_BASELINE_APPLIED_2026-08-22`. An empty table returns an
empty array, not 0.8 kB of rows.

**⇒ Path B's PostgREST target is a populated database. Staging is empty.
Only two projects exist in the organisation.**

### Line 3 — The production CORS allow-list explains why it works

`supabase/functions/_shared/secureHeaders.ts` permits exactly five origins, and
`https://www.50mmretina.com` — Path B's origin — is one of them. A preflight
from Path B to production is therefore allowed and returns 200, exactly as
observed. The mechanism is consistent with lines 1 and 2 rather than merely
compatible with them.

### What was NOT done

The literal `*.supabase.co` hostname string was never read out of Path B's
bundle — the only permitted HTTP instrument truncates at ~200,000 characters,
proven by six known-present controls that all failed. **This conclusion does not
rest on that read.** It rests on server-side inventory and observed behaviour,
which is stronger evidence than a client-side string match, not weaker.

No bypass, credential discovery, scanning, exploitation, invasive probing or
mutation was used at any point.

---

## 3. SCOPE

| | |
|---|---|
| **Affected surface** | `www.50mmretina.com` — Path B |
| **Backend reached** | Production Supabase `jtdtehuqtinjxropkkcn` — database, PostgREST and edge functions |
| **Traffic exposure** | The shipped `index.html` redirects the apex to `www` before the app boots. Path B is where members actually land |
| **Build provenance** | A Vite build of this repository — four vendor chunks and the Tailwind CSS bundle are content-hash identical to a local `main` HEAD build, confirmed independently by the owner's own browser |
| **Environment provenance** | **Unknown.** Path B's entry chunk `index-CQNRLXfL.js` matches neither `index-DrppXY7Q.js` (CI legacy anon key) nor `index-BRwrdrEg.js` (new publishable key). Its environment values are not reproducible from any documented configuration |
| **Controls applying to Path B** | **None of them.** Not the build-time isolation guard, not `_headers`, not Cloudflare Access, not the WAF. It is not behind Cloudflare at all |
| **Operator** | Not established |

---

## 4. WHAT THIS MEANS FOR THE PROJECT

Stated plainly, because it changes the value of the work done so far:

1. **The isolation controls built in G1–G6 gate the Cloudflare Pages lane —
   Path A.** Members reach Path B. The guard that would refuse a
   cross-environment build has never run against the artifact members load.
2. **G6 cannot be closed as it is written.** Its remaining evidence is a
   production Pages deploy log line, which speaks only for Path A.
3. **G7's premise is void as designed.** A staging Pages project mirrors Path A.
   It does not mirror what production actually serves.
4. **G10 promotion would reach Path B by an unobserved mechanism.** A release
   verified entirely on Path A would not have verified what members receive.
5. This is the committed-`.env` failure class, at full scale: the production
   site built by an unaudited pipeline with unaudited environment values,
   pointed at the production database.

---

## 5. WHAT IS EXPLICITLY *NOT* CLAIMED

- That Path B is malicious, compromised, or leaking data. **No evidence of
  that was sought or found.**
- That Path B's configuration is wrong. It may be entirely intentional and
  entirely correct. What is established is that it is **outside every control
  this project has built**, and that nobody in this project has audited it.
- Who operates or deploys it.
- Which R2 or CDN configuration it carries — that remains unestablished.

An uncontrolled path is a governance finding. It is not, on this evidence, a
security incident, and it must not be reported as one.

---

## 6. NO REMEDIATION PERFORMED

Per E-1 clause 8, nothing was changed and nothing will be until the owner rules:

- The `www` DNS record is untouched.
- No repoint, no deletion, no Cloudflare change.
- No Supabase, R2, repository, DNS or deployment mutation.
- `origin/main` unchanged at `32930e75b1d87d361f44e4b4f90dabf9deeda3e1`;
  workspace clean at `9aea8a30916fee06a741c52ef34914e4a2788f96`.

Any eventual change to Path B is a **separate production change** requiring its
own Change ID, explicit owner authorization, before/after evidence, a rollback
procedure and post-change verification.

---

## 7. INCIDENTAL FINDINGS FROM THE SAME PASS

Recorded because they bear on later gates, not acted upon:

- **R2 bucket `50mm-staging` EXISTS**, created 2026-08-21T19:22:35Z. Production
  bucket `50mm` created 2026-03-07. A third bucket `agentcrm` is unrelated to
  this project. G8's prerequisite bucket is therefore already in place.
- **Cloudflare Worker `seo-edge-injector` EXISTS**, modified 2026-07-11 — the
  Worker `index.html`'s comment describes as awaiting redeployment. Its
  deployment state relative to any route was not investigated.
- **Supabase log querying is unavailable**: `query_logs` returned
  `Backend error! Retry your query` on three separate well-formed queries. That
  instrument is down, not merely unhelpful.
- **Push remains refused**, re-tested 18:07:27 UTC: `403 — not in this
  session's authorized repository set`.

---

## 8. CHANGE LEDGER

| Field | **CHG-20260822-011** |
|---|---|
| Change ID | CHG-20260822-011 |
| Path affected | **Path B — observation only. Nothing changed on any path** |
| Branch | `staging`, read-only |
| Before SHA / tree | `9aea8a30916fee06a741c52ef34914e4a2788f96` / `aa877b50d3ca329aa0c169a150700fd9887a7d9a` |
| After SHA / tree | **Identical** |
| Files / configuration changed | **NONE** |
| Reason | Exhaust authorized mechanisms for the Path B classification, per the owner's execution rule |
| Environment impact | None. Authorized read-only API calls: Supabase `list_edge_functions` ×2, Cloudflare `r2_buckets_list`, `workers_list`; one refused `git push --dry-run` |
| Verification performed | §2, three independent lines of evidence |
| Rollback reference | Not applicable — nothing changed |
| Evidence classification | **VERIFIED** |

---

## 9. GATE STATUS UNDER THE TWO-STATE RULE

| Gate | State | Blocking dependency |
|---|---|---|
| G0, G1, G2, G4, G5a | **GREEN — COMPLETE** | — |
| G3 | **BLOCKED** | §5.3 requires a push and a workflow run; this session is refused at the git proxy (403, re-tested 18:07 UTC). No browser route exists without credentials this session must never request |
| G5b | **BLOCKED** | Production Pages `SUPABASE_PROJECT_REF` and `SUPABASE_ANON_KEY` absent. No authorized Pages mechanism exists here — the Cloudflare tooling covers D1, KV, R2, Workers and Hyperdrive only, with no Pages surface |
| G6 | **BLOCKED** | Production Pages variable unreadable by any authorized mechanism — and now also **scope-blocked**: its evidence covers Path A, and HS-1 puts Path B's status ahead of it |
| G7, G8, G9, §15, RC, G10 | **BLOCKED** | HS-1 is live. Sequencing forbids proceeding |

---

## 10. THE DECISION REQUIRED FROM THE OWNER

**Is Path B intentional?**

- **If YES** — it is a production serving path and must be brought under the
  plan: its build pipeline, environment values and deployment mechanism
  identified and recorded, an environment-impact row created for it under §16,
  and G7/G10 redesigned to cover both paths. G6 closes scoped to Path A.
- **If NO** — it is an unintended production path reaching the production
  database, and retiring or repointing it becomes the highest-priority
  production change, with its own Change ID, approval, rollback and
  post-change verification. **It is not done automatically and not done by
  this session without explicit authorization.**

Until that ruling, no gate proceeds.
