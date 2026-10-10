# G10 PHASE 5 — INTERACTIVE STAGING QA RUN

**Executed 2026-08-27, ~04:40–05:00 UTC. Lane: `staging.50mmretina.com` / `ztzutckwdhetphwghuzj`.**
Identity driving the session: the seeded staging **admin** (`25d4916c-…`, email domain `example.invalid`),
recovered from the owner's already-authenticated Chrome profile. **No credential was requested,
displayed, or recorded.**

`main` untouched (`b671e1f`) · T untouched (`e2e05fb`) · PR #103 unmerged · **RC NOT APPROVED.**

---

## 0. FOUR INSTRUMENT FAILURES CAUGHT BEFORE THEY PRODUCED FALSE GREENS

Recorded first because each would have manufactured a pass.

| # | Instrument | Failure | How it was caught | Consequence |
|---|---|---|---|---|
| **I-1** | `read_console_messages` | Reports "no console errors" before tracking is armed | Injected a live `console.error` **and** a thrown `TypeError`; both were captured | Pre-arming reads **discarded**; only post-control reads counted |
| **I-2** | DOM meta/canonical read at 2.5 s | `<link rel=canonical>` and `<title>` are injected **asynchronously**; at 2.5 s they read as absent | Same route re-probed at 4–5 s returned them populated | All canonical/title readings re-taken at **≥5 s** |
| **I-3** | `resize_window` | Reported "Successfully resized" three times; `innerWidth` stayed **1536** at all three breakpoints | Desktop/tablet/mobile returned **byte-identical** measurements (`scrollW` 1526, `len` 2746) | **Row 10 breakpoints recorded OPEN, not passed** |
| **I-4** | Container HTTP egress | `curl` to staging returns 403 at the proxy | Direct attempt | All HTTP evidence taken **through the browser**, not the container |

I-3 is the important one: three identical numbers were the only thing separating "responsive
verified" from the truth, which is that **the viewport never changed and nothing was tested.**

---

## 1. ROW 4 — DATABASE / RLS: BEHAVIOURAL, THREE TIERS, WITH CONTROLS

Executed as real Postgres identities (`set local role` + `request.jwt.claims`), i.e. the way
PostgREST executes browser calls. **Every write test ran inside a rolled-back transaction.**

### 1.1 Read visibility

| Table | TOTAL | anon | member | admin |
|---|---|---|---|---|
| posts | 16 | 16 | 16 | 16 |
| profiles | 513 | **0** | **1** (own) | **513** |
| user_roles | 513 | **0** | **1** (own) | **513** |
| certificates | 3 | **0** | **0** | **3** |
| user_notifications | 546 | 0 | **0** | **513** |
| follows | 513 | **513** | 513 | 513 |
| comments | **0** | 0 | 0 | 0 |

Three distinct visibility tiers demonstrated. `posts` and `follows` are the positive controls —
they prove the harness is not blanket-denying.

⚠ `comments` holds **0 rows on staging**, so every comment-related RLS assertion is **vacuous**.
Recorded as vacuous, not as a pass. It also means **Flow 4 (Comment) has no existing data to act on.**

### 1.2 Member write battery — 7/7 as expected

| # | Action | Expected | Actual |
|---|---|---|---|
| T1 | member UPDATEs another user's post | 0 rows | **0 rows** ✅ |
| T2 | member DELETEs another user's post | 0 rows | **0 rows** ✅ |
| T3 | **POSITIVE CONTROL** member UPDATEs own profile | 1 row | **1 row** ✅ |
| T4 | member UPDATEs another user's profile | 0 rows | **0 rows** ✅ |
| T5 | **ESCALATION** member grants self `admin` | refused | **REFUSED** — `new row violates row-level security policy for table "user_roles"` ✅ |
| T6 | member INSERTs a post as another user | refused | **REFUSED** — same class, table `posts` ✅ |
| T7 | **POSITIVE CONTROL** member INSERTs own post | 1 row | **1 row** ✅ |

T3 and T7 are what make T1/T2/T4 meaningful: the harness demonstrably **can** write, so the zeros
are refusals rather than a broken connection.

### 1.3 Anonymous write battery — 6/6 as expected

A1 INSERT post → **REFUSED (RLS)** · A2 UPDATE post → 0 · A3 DELETE post → 0 ·
A4 UPDATE profile → 0 · A5 **escalation to admin → REFUSED (RLS)** ·
A6 **POSITIVE CONTROL** SELECT posts → **16 visible**.

### 1.4 Admin tier — 5/5

AD1 all 513 profiles (member saw 1) · AD2 UPDATE another user's profile → **1 row** ·
AD3 DELETE another user's post → **1 row** · AD4 513 notifications (member saw 0) ·
AD5 3 certificates (member saw 0). Admin elevation is real and bounded.

### 1.5 Production comparison — the actual §15 criterion

The criterion is *"RLS behaves as production does"*, so production was probed read-only with the
identical anon harness:

| | posts | profiles | user_roles | certificates | follows | notifications |
|---|---|---|---|---|---|---|
| **PROD anon** | 285 | **0** | **0** | **0** | 325 | **0** |
| **STAGING anon** | 16 | **0** | **0** | **0** | 513 | 0 |

**The permission *pattern* is identical on both lanes** — same tables open, same tables closed.
Row counts differ because the datasets differ.

⚠ Further production reads were **blocked by the environment's classifier** partway through, so
production totals were never obtained and "325 = all follows" is **unconfirmed**. Pattern parity is
VERIFIED; magnitude parity is **OPEN**. Not worked around.

⚠ Note for the owner: **anon can read the entire `follows` graph on both lanes** (513 / 325 rows).
This is *production-faithful*, so it is not a G10 divergence — but it is a standing production
characteristic worth a separate decision outside this gate.

**Row 4 verdict: positive half VERIFIED behaviourally at the database layer** (18 assertions,
4 positive controls, 2 escalation refusals). Not promoted from the fingerprint match — measured.

---

## 2. AF-03 — PRODUCTION CDN REFERENCES SERVED BY THE STAGING LANE

**This is the significant new finding of the run.**

### 2.1 Observed in the browser

`/discover` requested `https://cdn.50mmretina.com/journal-images/ads/1785767311450-t048of2o9dd.webp`
— alt text **"Ad - Sidebar (Rectangle)"**. `transferSize 0`, `duration 0`, `naturalWidth 0`,
`complete/loaded false` → **the request is emitted and fails.**

Production-CDN request counts, per route, measured live:

| Route | prod-CDN requests | Route | prod-CDN requests |
|---|---|---|---|
| /discover | **3** | /certificates | **2** |
| /competitions | **2** | /help-support | **3** |
| /verify | **3** | /notifications | **2** |
| /friends | **3** | /edit-profile | **3** |
| /home, /journal, /courses, /winners, /wallet, /dashboard | 0 | | |

### 2.2 Root cause, located in the staging database

A full scan of every `text` / `varchar` / `jsonb` / `ARRAY` column in staging `public`,
**with a positive control** (`cdn-staging` was found in 15 column locations, proving the scanner works):

| Key in `site_settings` | production-CDN refs | staging-CDN refs | last updated |
|---|---|---|---|
| `managed_pages` | **17** | 0 | 2026-08-23 |
| `ad_slots` | **9** | 0 | 2026-06-10 |
| `ad_slots_backup_20260723` | **9** | 0 | 2026-07-23 |
| `seo_pages` | **7** | 0 | 2026-04-24 |
| `ad_zones_v2` | **3** | 0 | 2026-07-23 |
| `seo_global` | **1** | 0 | 2026-04-08 |

**46 production-CDN references in live staging configuration, and not one staging-CDN reference in
those same keys.** Also `chat_questions.ai_answer` ×3 and `db_audit_logs` ×22 (historical records,
lower severity).

### 2.3 Why this matters, precisely

1. **§15 row 1's negative criterion is *"No asset resolves to cdn.50mmretina.com"*. An asset does.
   Row 1 FAILS on evidence** — it is not merely unexecuted.
2. **The bundle isolation guard structurally cannot catch this.** `ISOLATION_FORBIDDEN_HOSTS` scans
   built code. These URLs live in **database rows**. The guard's 21/21 mutant result remains valid
   and is not undermined — but the C-control set has a **blind spot for data-borne cross-lane
   references**, and this run is the first thing to enter it.
3. **It is not a promotion-content defect.** `site_settings` rows are not in tree T; promoting T does
   not move them. It is a **staging-fidelity defect** — and it means staging QA can be silently
   exercising production assets.
4. It propagates into SEO metadata — see §3.

**Not a production write. Not a production mutation. Read-direction only, and failing.**

---

## 3. ROW 8 — SEO / HEADERS

| Check | Result | Status |
|---|---|---|
| `robots.txt` | `200`, `User-agent: * / Disallow: /`, header `# NON-PRODUCTION LANE — NOT FOR INDEXING`, lane origin `https://staging.50mmretina.com` | ✅ **VERIFIED** |
| `sitemap.xml` | `200`, `application/xml`, **109 bytes, `<urlset></urlset>` — zero URLs** | 🟡 **VACUOUS** |
| Canonical tags | Present and **staging-correct** on every route probed at ≥5 s (`/home`, `/discover`, `/journal`, `/courses`, `/competitions`, `/certificates`, `/verify`, `/friends`, `/help-support`, `/wallet`) | ✅ **VERIFIED** |
| Security headers | **10 present**: CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, COOP/COEP/CORP, `Cache-Control: no-store` | ✅ **VERIFIED** |
| `og:url` | `https://staging.50mmretina.com/` | ✅ |
| **`og:image` + `twitter:image`** | **carry production references** | 🔴 **FAILS negative criterion** |

**AF-05 · `<meta name="robots" content="index, follow">` is emitted on staging pages.** The lane is
non-indexable *only* because `robots.txt` disallows crawling; the pages themselves declare the
opposite, and **no `X-Robots-Tag` header is set**. One misconfigured `robots.txt` away from an
indexable staging lane.

**AF-06 · The sitemap is empty.** It contains zero production URLs — but it contains zero URLs of
any kind, so the negative criterion passes vacuously and the positive criterion
(*"sitemap generated from staging values"*) is **unproven**. Recorded as vacuous.

**AF-07 · Duplicate SEO meta blocks.** `/discover` carries **24** meta tags — two full sets
(`description`, `og:title`, `og:image`, `robots`, … each twice). The static set is clean; the
SPA-injected set carries the production image references. Conflicting duplicate SEO metadata is a
defect in its own right.

---

## 4. ROW 1 — UI: 18 OF 60 ROUTES EXECUTED

Render assertion = `#root` child count > 0 **and** non-trivial `innerText` length, at ≥5 s.

| Route | kids | textLen | canonical | prod-CDN | prod-apex | prod-Supabase | console errors | Status |
|---|---|---|---|---|---|---|---|---|
| `/` → `/feed` | 8 | 2232 | ✅ | 0 | 0 | 0 | none | ✅ |
| `/home` | 8 | 2232 | ✅ staging | 0 | 0 | 0 | none | ✅ |
| `/feed` | 6–7 | 1031–2746 | ✅ | 0 | 0 | 0 | none | ✅ |
| `/discover` | 7 | 1351 | ✅ staging | **3** | 0 | 0 | none | 🔴 AF-03 |
| `/journal` | 7 | 422 | ✅ staging | 0 | 0 | 0 | none | ✅ |
| `/courses` | 7 | 1189 | ✅ staging | 0 | 0 | 0 | none | ✅ |
| `/competitions` | 7 | 1570 | ✅ staging | **2** | 0 | 0 | none | 🔴 AF-03 |
| `/certificates` | 7 | 1098 | ✅ | **2** | 0 | 0 | none | 🔴 AF-03 |
| `/verify` | 7 | 1158 | ✅ | **3** | 0 | 0 | none | 🔴 AF-03 |
| `/friends` | 7 | 954 | ✅ | **3** | 0 | 0 | none | 🔴 AF-03 |
| `/help-support` | 7 | 1801 | ✅ | **3** | 0 | 0 | none | 🔴 AF-03 |
| `/winners` | 6 | 379 | ✅ | 0 | 0 | 0 | none | ✅ |
| `/wallet` | 6 | 512 | ✅ staging | 0 | 0 | 0 | none | ✅ |
| `/dashboard` | 7 | 2261 | ✅ | 0 | 0 | 0 | none | ✅ |
| `/notifications` | 7 | 2239 | ✅ | **2** | 0 | 0 | none | 🔴 AF-03 |
| `/edit-profile` | 7 | 4290 (26 inputs, 1 file input) | ✅ | **3** | 0 | 0 | none | 🔴 AF-03 |
| **`/referrals`** | 6 | 2872 | ✅ | 0 | 0 | 0 | none | 🔴 **AF-04** |
| `/g10-control-does-not-exist` | 7 | 943 | — | 0 | 0 | 0 | none | ✅ **negative control** |

**AF-04 · `/referrals` does not render the Referrals page.** It lands on **`/admin/health`** with
`<h1>Admin Panel</h1>`. Reproduced twice, in separate batches. Observed under the admin identity;
whether it also affects members is **untested**.

**Negative control passed:** an unknown route lands on `/not-found` and renders — so "rendered" and
"not rendered" are genuinely distinguishable by this instrument.

**Across all 18 routes: production-apex hits 0, production-Supabase hits 0, console errors 0**
(console reads taken only after the I-1 control armed tracking).

Third-party hosts observed: `fonts.googleapis`/`gstatic`, `cloudflareinsights.com`, `picsum.photos`
(placeholder imagery on `/feed`, `/discover`, `/courses`, `/competitions`). No unclassified host.

**42 of 60 routes were not executed** — all parameterised routes (`/post/:id`, `/journal/:slug`,
`/competitions/:id`, `/profile/:userId`, `/verify/:token`, `/page/:slug`, …), the auth forms, the
creator editors, the judge panel, and the dev/QA routes. **OPEN.**

---

## 5. ROW 2 — FUNCTIONAL FLOWS: 1 OF 10 EXECUTED END TO END

### Flow 6 — Follow / friend request ✅ **VERIFIED**

| | |
|---|---|
| **Start** | `/feed`, admin session, "People You May Know" → Owen Blake |
| **Action** | clicked **Add** |
| **Expected** | request created, UI reflects it, staging DB row, no production traffic |
| **Actual UI** | button changed **"Add" → "Sent"** |
| **Staging DB effect** | `friendships`: **+1 row, status `pending`, created 04:51:35** (table held 0 rows before) |
| **Side effect** | `user_notifications`: **+1 row in the same window** |
| **API calls** | `rest:friendships`, `rest:profiles_public_data`, `rest:user_badges`, `rest:rpc`, `rest:site_settings`, `rest:ad_creatives` — **all `[staging]`** |
| **Production calls** | **0** |
| **Result** | ✅ **VERIFIED** — UI, database and network all confirm |

### Flow 7 — Notification 🟡 **PARTIAL**

**Generation VERIFIED** (the +1 `user_notifications` row above, caused by a real user action).
**Delivery/display OPEN** — the notification targets the *recipient*, and `/notifications` under the
admin identity does not show it. Confirming display needs Owen Blake's session. `/notifications`
itself renders correctly (kids 7, len 2239).

### Flows 1, 2, 3, 4, 5, 8, 9, 10 — **OPEN, not executed**

Upload · Edit · Delete · Comment · Like · Search · Profile edit · Article path.
`/edit-profile` was confirmed to expose **26 inputs and 1 file input**, so the upload surface exists
— it was not exercised. **Flow 4 (Comment) additionally has no data to act on: `comments` is empty
on staging.**

---

## 6. ROW 6 — EDGE FUNCTIONS: 1 OF 74 EXERCISED

| Function | Invoked from | Endpoint | Response | Stayed on staging |
|---|---|---|---|---|
| `dashboard-init` | `/feed`, `/dashboard` | staging project | served, pages rendered with data | ✅ **yes** |

**Production function endpoint calls across the entire run: 0.** That negative result holds.

But passive browsing plus one flow invokes **one** of 74 ACTIVE staging functions. The criterion is
*"every function the staging lane invokes responds correctly"* — coverage is **1/74**, so
**row 6 stays OPEN**. Reaching the rest requires the nine unexecuted flows.

---

## 7. ROW 3 — AUTHENTICATION

| Item | Status | Evidence |
|---|---|---|
| Session belongs to **staging** | ✅ **VERIFIED** | session user `25d4916c-…` matches the `admin` holder in **staging** `user_roles`; all API traffic to the staging project; `aud: authenticated` |
| Existing-account authentication | ✅ **VERIFIED** | admin session drove 18 routes and a write flow with correct elevated visibility |
| Sign-in / refresh / sign-out | 🔴 **OPEN** | not exercised — signing out would destroy the owner's session mid-run |
| Sign-up | 🔴 **OPEN** | owner-performed by agreement; not yet performed |
| **Password reset** | 🔴 **OPEN — STRUCTURALLY UNTESTABLE** | staging has **no email send path**: 0 `smtp_settings` rows, `BREVO_API_KEY` absent. The reset mail cannot arrive. Making this testable would require giving staging a live email credential, which would **destroy the row 9 result**. |
| N7 cross-lane negative | ✅ **PRESERVED** | 401 both directions with 200 controls |

⚠ **Carried forward from the G1–G9 audit and still governing:** staging's GoTrue **does not enforce
Turnstile captcha**; production does. A passing staging auth run therefore **cannot** prove the
production auth path. This caps row 3 permanently, independent of how much QA is done.

---

## 8. ROW 10 — RESPONSIVE / MOBILE

| Item | Status | Evidence |
|---|---|---|
| **No `server.url` override** | ✅ **VERIFIED** | `capacitor.config.ts` in tree T contains only `androidScheme: 'https'` — no `server.url` |
| Android `versionCode` | 🔴 **OPEN — NOT OBTAINABLE FROM THE TREE** | **there is no `android/` native project in T at all**; only `capacitor.config.ts` and `resources/android/*.png`. B10 cannot be closed from the repository. |
| Breakpoints | 🔴 **OPEN — INSTRUMENT FAILED** | see I-3: `resize_window` reported success three times while `innerWidth` stayed 1536. **No breakpoint was actually tested.** |
| Desktop layout | ✅ observed | screenshot at 1536 px: header, left rail, feed column, right rail all correct; no horizontal overflow (`scrollW` 1526 ≤ 1536) |

---

## 9. CHANGE LEDGER — NEW ENTRY

| Change ID | What | Surface | Reversible | Status |
|---|---|---|---|---|
| **CHG-G10-004** | **Staging test data created by this QA run:** 1 `friendships` row (`pending`) + 1 `user_notifications` row, 04:51:35 | Staging Supabase data | Yes — staging is rebuildable | ⚠ **APPLIED, NOT CLEANED UP** |

Left in place deliberately: it is legitimate QA evidence for Flow 6, and deleting rows was outside
what this session should do unilaterally. **Owner decides: delete or accept.** All RLS write tests
were rolled back and left **no** residue. No production row was written at any point.

---

## 10. NEW AUDIT FINDINGS

| ID | Finding | Severity |
|---|---|---|
| **AF-03** | 46 production-CDN references in live staging `site_settings`; production-CDN assets requested on 8 of 18 routes. **§15 row 1 negative criterion fails on evidence.** The bundle guard structurally cannot see data-borne references. | **HIGH** |
| **AF-04** | `/referrals` lands on `/admin/health` instead of the Referrals page. Reproduced twice. | **MEDIUM** |
| **AF-05** | Staging pages emit `meta robots: index, follow`; no `X-Robots-Tag`. Non-indexability rests entirely on `robots.txt`. | **MEDIUM** |
| **AF-06** | `sitemap.xml` is empty — row 8's positive criterion is vacuous, not passed. | **LOW–MEDIUM** |
| **AF-07** | Duplicate/conflicting SEO meta blocks; the injected set carries production `og:image` / `twitter:image`. | **MEDIUM** |
| **I-1…I-4** | Four instruments that reported success while measuring nothing. Recorded so the same false greens are not produced by the next run. | **PROCESS** |

---

## 11. UPDATED §15 MATRIX

| # | Area | Before this run | **After** | Movement |
|---|---|---|---|---|
| 1 | UI | 🔴 OPEN | 🔴 **FAILS (AF-03)** + 42/60 routes OPEN | **worse — now disproven, not just untested** |
| 2 | Functional flows | 🔴 OPEN | 🟡 **PARTIAL** — 1/10 verified | improved |
| 3 | Authentication | 🟡 PARTIAL | 🟡 **PARTIAL** — staging-ownership verified; reset structurally untestable | slight |
| 4 | Database / RLS | 🟡 PARTIAL | ✅ **VERIFIED** (behavioural, 3 tiers, 4 controls) — magnitude parity OPEN | **best gain** |
| 5 | Storage / R2 | 🟡 PARTIAL | 🟡 **PARTIAL** — no upload performed | none |
| 6 | Edge Functions | 🔴 OPEN | 🟡 **PARTIAL** — 1/74, 0 production calls | slight |
| 7 | Security / isolation | ✅ VERIFIED | ✅ **VERIFIED** (preserved, not re-run) | — |
| 8 | SEO / headers | 🟡 PARTIAL | 🟡 **PARTIAL** — robots/canonical/headers VERIFIED; og:image FAILS; sitemap vacuous | mixed |
| 9 | Email | ✅ VERIFIED (vacuous) | ✅ **VERIFIED (vacuous)** — preserved | — |
| 10 | Responsive / mobile | 🔴 OPEN | 🟡 **PARTIAL** — `server.url` VERIFIED; breakpoints OPEN; versionCode unobtainable | slight |
| 11 | Regression | 🟡 PARTIAL | 🟡 **PARTIAL** — §18 dependency retained | — |
| 12 | Cross-lane | 🟡 PARTIAL | 🟡 **PARTIAL** — N3–N8 preserved; **N1/N2 still OPEN** | — |

**Tally: 2 VERIFIED → 3 VERIFIED · 6 PARTIAL → 7 PARTIAL · 4 OPEN → 1 OPEN + 1 FAILING.**

Row 1 moved from *unknown* to *known-bad*. That is progress, but it is **not** progress toward approval.

---

## 12. BLOCKERS

**Unchanged and still owner-only:** B5 (4.7b R2 write test), B6 (N1/N2 dispatch), B7 (§5.3 re-test),
B8 (D-2 misnamed migrations), B10 (versionCode — now known to be **absent from the tree**),
B11 (DB rollback binding), B12 (ledger closure), B13 (§14 countersignature).

**Changed:** B3 (RLS) → **CLOSED at the database layer**. B1/B2/B4 → still open, now precisely sized.

**New:**

| # | Blocker | Resolver | Action |
|---|---|---|---|
| **B14** | **AF-03** — 46 production-CDN refs in staging `site_settings` | **OWNER** | Rewrite the 6 keys to staging URLs, or accept in writing. Until then §15 row 1 cannot pass. |
| **B15** | **AF-04** — `/referrals` → `/admin/health` | **OWNER + session** | Diagnose; confirm whether members are affected |
| **B16** | **AF-05/06/07** — meta robots, empty sitemap, duplicate SEO blocks | **OWNER** | Rule on each |
| **B17** | Breakpoint testing has **no working instrument** | **OWNER + session** | Needs a browser whose window actually resizes, or device emulation |
| **B18** | **CHG-G10-004** staging test rows | **OWNER** | Delete or accept |

---

## 13. HONEST STATEMENT OF COVERAGE

Executed: **18 of 60 routes · 1 of 10 flows · 1 of 74 edge functions · 18 RLS assertions across 3
tiers with 4 positive controls · 4 SEO/header checks · 1 breakpoint attempt that failed.**

Not executed: 42 routes, 9 flows, 73 edge functions, the R2 upload, all breakpoints, sign-in/refresh/
sign-out, sign-up.

**Phase 5 is not complete and Phase 7 cannot open.** The single most consequential result of this run
is that **§15 row 1 is now failing on measured evidence rather than merely unexecuted** — and the
second is that four separate instruments reported success while measuring nothing, which is the
strongest available argument that the remaining rows must be *executed* rather than *inferred*.

*No secret, token, cookie, or session value was requested, displayed, or recorded.
`main` untouched · T untouched · PR #103 unmerged · production unwritten · RC NOT APPROVED.*
