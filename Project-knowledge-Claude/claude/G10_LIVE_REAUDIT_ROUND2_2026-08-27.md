# G10 — LIVE RE-AUDIT, ROUND 2

**Measured 2026-08-27 ~11:55–12:10Z by direct observation: Supabase read-only SQL, Cloudflare API,
and the owner's authenticated browser. Zero writes, zero dispatches, zero deploys.**

---

## 1 · §8.10 PRODUCTION FINGERPRINTS — UNCHANGED (after an instrument correction)

### 1.1 · A false alarm I raised and then killed — recorded because it nearly became a hard stop

My first query returned **tables 156** (baseline 146) and **RLS policies 730** (baseline 686).
On the face of it that is *"a fingerprint that must never move"* moving — §14 territory.

**It was my instrument, not production.** Discriminating query, 2026-08-27T12:02Z:

| Method | Result |
|---|---|
| `pg_tables where schemaname='public'` | **146** ✅ matches baseline |
| `information_schema.tables` public, **all types** | 156 |
| `information_schema.tables` public, **BASE TABLE only** | **146** ✅ |
| `information_schema.tables` public, **VIEW only** | 10 → *this is the entire discrepancy* |
| `pg_policies` **all schemas** | 730 |
| `pg_policies where schemaname='public'` | **686** ✅ matches baseline |
| `pg_policies` non-public schemas | 44 → *this is the entire discrepancy* |

**Production did not change. My query was wider than the baseline's.**

> ### ⚠ FINDING — §8.10's fingerprint definitions are ambiguous, and that is a live defect
> "table count" and "RLS policies" do not name a query. Two reasonable readings differ by 10 and 44.
> Anyone re-running this check with the wider reading gets an apparent hard stop and may trigger a
> rollback against a healthy production database. **§8.10 must pin the exact SQL for each of the seven
> fingerprints.** This is a governance fix, not a code fix.

### 1.2 · The seven fingerprints, re-measured with the baseline-matching instrument

| Fingerprint | Baseline | 07:38:38Z | **12:02Z** | |
|---|---|---|---|---|
| base tables (public) | 146 | 146 | **146** | ✅ |
| vault secrets (count only) | 4 | 4 | **4** | ✅ |
| cron jobs | 16 | 16 | **16** | ✅ |
| storage buckets | 11 | 11 | **11** | ✅ |
| RLS policies (public) | 686 | 686 | **686** | ✅ |
| site_settings rows | 35 | 35 | **35** | ✅ |
| migration ledger max | `20260825115208` | same | **`20260825115208`** | ✅ |

| Drift counters | 07:38:38Z | **12:02Z** | Δ |
|---|---|---|---|
| auth users | 103 | **103** | **0** |
| posts | 288 | **288** | **0** |

**Zero drift across the whole session. Production is untouched.**

---

## 2 · MIGRATIONS — §12.4 STEP 12 CONFIRMED AS A NO-OP

Production ledger read 2026-08-27T12:00Z. All five `UNAPPLIED_`-prefixed files correspond to migrations
**already applied to production**, under **different version stamps than their filenames**:

| Repository file | Production ledger entry | |
|---|---|---|
| `UNAPPLIED_20260824000000_admin_user_list_pagination` | `20260825092152 admin_user_list_pagination` | ✅ applied |
| `UNAPPLIED_20260825060000_certificate_types_and_admin_search` | `20260825115030 certificate_types_and_admin_search` | ✅ applied |
| `UNAPPLIED_20260825120000_certificate_delete_removes_notifications` | `20260825115116 certificate_delete_removes_notifications` | ✅ applied |
| `UNAPPLIED_20260825170000_certificate_custom_heading` | `20260825115208 certificate_custom_heading` | ✅ applied |
| `classF_repoint_originals` (orphan rollback) | `20260820180836 classf_repoint_originals` | ✅ applied |

**Caution to carry into promotion:** the version stamps differ between filename and ledger. A runner that
matched by *version* would consider these unapplied and re-run them. The `apply-migration` workflow takes
an **explicit single file path**, so it cannot scan-and-reapply — but the approved manifest for §12.4 step
12 must therefore be **empty**, and that should be stated in the approval rather than assumed.

---

## 3 · D-3 IS WITHDRAWN — THE CANDIDATE **IS** DEPLOYED, AND ITS DEPLOYMENT ID EXISTS

Prior records state: *"no staging Pages deployment exists for T (previews disabled)"* — used to justify
**D-3** and to excuse §15 row 1's missing deployment ID. **Direct observation contradicts this.**

Cloudflare Pages project **`lens-lustre-learn-claude-staging`** → Deployments:

| Field | Observed |
|---|---|
| **Deployment ID** | **`3a6f3df9-639b-444f-846a-b17be22cde73`** |
| Deployment URL | `https://3a6f3df9.lens-lustre-learn-claude-staging.pages.dev` |
| **Aliases** | **`staging.50mmretina.com`** — this deployment is what the staging host serves |
| Repository | `altisinfonet/lens-lustre-learn-Claude` |
| **Branch / commit** | **`staging` `b8535fe`** — the candidate |
| Status | **success**, 2026-08-26 19:18 (7:18 PM) |
| Build duration | 1m 15s |
| Production branch (project setting) | `staging` · automatic deployments **Enabled** |

**Consequence: §15 row 1's instrument requirement — *"record the deployment ID actually loaded"* — is
satisfiable now.** The QA run's readings were taken against `staging.50mmretina.com`, which this
deployment serves. **D-3 should be withdrawn as a deviation rather than signed off (OA-12 is void).**

---

## 4 · THE GUARD'S PASS LINE, CAPTURED FROM THE CANDIDATE'S OWN BUILD

Build log line 427 of deployment `3a6f3df9…`, timestamp `2026-08-26T13:48:09.558372Z`, read verbatim:

```
ISOLATION-GUARD PASS: expected=ztzutckwdhetphwghuzj present;
forbidden=[jtdtehuqtinjxropkkcn] absent;
host=cdn-staging.50mmretina.com present;
forbidden-hosts=[cdn.50mmretina.com,www.50mmretina.com,https://50mmretina.com] absent;
388 ass…
```

**This is a four-part assertion carrying both halves of §5.1 Rule 1** — two known-present checks and two
known-absent checks, over 388 scanned assets, executed automatically as part of the deploy. It is
**INDEPENDENTLY-VERIFIED evidence tied to the candidate commit**, not an attestation.

Adjacent lines, same build:

| Line | Content | Reading |
|---|---|---|
| 424 | `generate-redirects OK: no rules emitted (the previous /sitemap.xml proxy rule was invalid and inert)` | a prior redirect rule was silently doing nothing |
| 425 | `generate-headers OK: 12 rules, 25 headers; cdn=cdn-staging.50mmretina.com serving-origin=https://staging.50mmretina.com acao=https://staging.50mmretina.com` | lane-correct headers |
| 426 | `generate-seo-assets OK: non-production lane https://staging.50mmretina.com — robots.txt blocks all crawling, sitemap.xml empty` | corroborates the §15 row 8 reading of a 109-byte staging sitemap |
| 431 | **`Found Functions directory at /functions. Uploading.`** | **Pages Functions are deployed on staging** |
| 434 | `✨ Compiled Worker successfully` | |
| 437–438 | `Parsed 0 valid redirect rules. Parsed 12 valid header rules.` · `Uploading… (281/281)` | |

---

## 5 · NEW FINDING — AF-16 · `svgo` MISSING FROM THE BUILD ENVIRONMENT

Build log lines 415–423, same deployment, repeated ~10 times:

```
Cannot find package 'svgo' imported from
/opt/buildhome/repo/node_modules/vite-plugin-image-optimizer/dist/index.js
```

Affected assets include `avatars/fallback/f1.svg`, `f3–f5`, `m1–m5`, and `placeholder.svg`.

**Severity: LOW. Non-blocking.** The build succeeds and the SVGs ship — **unoptimized**. `vite-plugin-image-optimizer`
declares `svgo` as an optional peer that is not installed. **Every deploy on both lanes emits these errors**,
which also means the build log carries ~10 red `Cannot find package` lines that a reader could mistake for
a failure. **Recommend: install `svgo` as a devDependency, or drop SVG handling from the plugin config, so
the log is clean and the failure signal stays meaningful.** → **G11.**

---

## 6 · R2 — BUCKETS CONFIRMED, OBJECT COUNT STILL UNAVAILABLE

Cloudflare API, 2026-08-27T12:00Z: buckets are **`50mm`** (created 2026-03-07, APAC, Standard),
**`50mm-staging`** (created 2026-08-21), and `agentcrm` (unrelated to this release).

`r2_bucket_get` returns name, creation date, location, storage class and jurisdiction — **no object count**.
**G8 part 3 remains BLOCKED**, and the blocker is confirmed to be the API surface, not an oversight.
G8 part 2 is unchanged: still requires the owner-side credential.

---

## 7 · RUNNING TALLY OF STALE RECORDS CORRECTED BY MEASUREMENT

| # | Record | Claimed | Measured |
|---|---|---|---|
| 1 | G5b code half | outstanding, needs a new candidate | **already in the candidate** |
| 2 | Pages variables | absent, owner must add | **all three present and correct** |
| 3 | HS-12 branch protection | *"never configured"* | **`protect-main` Active, 3 rules, bypass empty** |
| 4 | Pages project name | `lens-lustre-learn` | **`lens-lustre-learn-claude`** — the documented path 404s |
| 5 | §5.3 probe | *"zero runs"* | **ran 2026-08-26T08:52:46Z, 22.5 h before the record was written** |
| 6 | **D-3** | *"no staging deployment for T"* | **deployment `3a6f3df9…` live, serving `staging.50mmretina.com`** |

**Six for six.** Every one was a document repeating an earlier document. **The governance rows record the
state when written, not current state** — and this session's own packs inherited that staleness instead of
testing it. This is the single most important process finding of the engagement.

---

## 8 · WHAT IS STILL GENUINELY OPEN

| # | Item | Who | Status |
|---|---|---|---|
| 1 | G8 §8.6 part 2 — production-write refusal with both controls | Owner, own machine | **BLOCKED** — credential |
| 2 | G8 §8.6 part 3 — production object count before/after | Owner | **BLOCKED** — not exposed by the API |
| 3 | §5.3 re-run immediately before promotion, branch deleted after | Owner | **NOT YET VERIFIED** — timing clause; branch still on the remote |
| 4 | N1 lane-gate refusal transcript | Owner | **NOT YET VERIFIED** — not dispatched |
| 5 | §11 approval signed + tag created + tag resolving to `e2e05fbb…` | Owner | tag count **0** |

**Promotion verdict: NOT READY — unchanged.** The re-audit removed paperwork, not gating proofs.
