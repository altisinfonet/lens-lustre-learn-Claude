# G1–G9 CONSOLIDATED FINAL AUDIT — 2026-08-24

Full report (formatted, with all per-gate records):
https://claude.ai/code/artifact/afc404ef-197f-4b6d-a64d-2f794999b912

Standard applied: **no previous GREEN inherited.** Every gate re-adjudicated against its
original exit criteria and against subsequent discoveries. Every current-state claim
re-measured 2026-08-24 with a control wherever a negative result was load-bearing.
G10 NOT started. No system was changed in producing this report.

`origin/main` 32930e75b1d87d361f44e4b4f90dabf9deeda3e1 — unchanged throughout the programme.
`origin/staging` e658062e462d089bab4094f0b9a2e62063db469f.

---

## 1. VERDICTS

| Gate | Verdict | Basis |
|---|---|---|
| G1 | **AMBER — not GREEN** | Core invariant met and probed, but the gate's own exit criterion ("no production resource modified except the authorized change") is falsified by the record. None of the three conditions its AMBER verdict named for GREEN was ever satisfied. No document records the AMBER→GREEN transition. |
| G2 | **AMBER — not GREEN** | Its own report says "GREEN on the git lane · AMBER overall". The deferred Pages-build reading (must still read 1558) was never taken. Branch protection on `main` is known ABSENT, not merely unconfirmed. |
| G3 | **GREEN** | Same-commit controlled experiment (runs 32592710546 FAIL / 32613930242 PASS), negative control retained, independently re-derived. Conditional on the org-secret scope check. |
| G4 | **GREEN** | Production `_headers` sha256 40b681e5… byte-identical; both lanes built for real; census not greps. Re-proven at G6 and G5b. |
| G5a | **GREEN (staging) / DEFERRED (production arming)** | First-ever armed shipped guard line at deployment 0ac877f2-f3c5-4d7e-b21e-6183022fb098, 2026-08-23T09:13:16Z. Production Pages has never redeployed, so R7–R13 have never run in a production build. |
| G5b | **GREEN + permitted deferral** | Exit checks re-executed against merged tree d33c91e, not inherited. Production-lane CI line deferred to G10 with "Not accepted as a substitute". Test line 47 liveness UNPROVEN, published. |
| G6 | **GREEN (scoped)** | Ten executed tests with both known-absent controls. GREEN strictly as its own re-examination scopes it: proves the rules work and the project is *configured*; does NOT prove the deployed artifact was scanned, does not cover R7–R10, does not cover R11. |
| G7 | **GREEN** | Deployment 0ac877f2, armed guard line, six-part DNS verification, two independent indexing mechanisms. Its last open criterion (the unexplained 403) is answered by this audit — see §3. |
| G8 | **GREEN** | Bidirectional read isolation with known-absent control, re-measured live today. `assertStorageLane` proven in Deno 7/7 in the runtime it runs in. |
| G9 | **BLOCKED — NOT GREEN** | No closure evidence exists in the project record; core judging flow never executed; staging auth diverges from production on captcha. |

---

## 2. PRINCIPAL FINDING — G9 HAS NO RECORD

Of 280 project documents there is **no G9 closure document, no G9 verification document,
and no document declaring G9 anything other than OPEN or BLOCKED.** The only G9-titled
artifact is `G4_G9_PREPARED_NOT_EXECUTED_2026-08-22.md`.

Yet substantial G9 execution has taken place — 74 edge functions deployed, CORS repaired,
17 email templates de-hardcoded, six storage-lane writers wired, rule **R13** added, 11
storage buckets and 42 storage policies created, 513 synthetic accounts built, upload
proven end to end. **All of it after the record ends; none of it written into the project.**

Four identifiers the audit brief named do not appear anywhere in the project record, and
all four are real and present in the code:
- **R13** — the record knows only up to R12. `SOURCE_ROOTS = ["functions","supabase/functions"]`.
- **`supabase/functions/_shared/laneConfig.ts`** — required lane values, no production default.
- **The `startsWith` CORS bypass** in `_shared/secureHeaders.ts` — a live PRODUCTION security
  defect (attacker-registrable look-alikes were ALLOWED while the staging origin was blocked),
  found and fixed by G9 work, recorded nowhere.
- **The `measure-post-media` import bug** — line 62 imported `./_shared/` where every sibling
  used `../`; the function could not deploy to any lane.

---

## 3. LIVE RE-VERIFICATION, 2026-08-24

**Staging Pages / frontend.** `staging.50mmretina.com/robots.txt` → **403** from the target.
Same client, same minute, `www.50mmretina.com/robots.txt` → served in full.
**This attributes G7's unexplained 403**: the only staging-specific control on that path is
the WAF rule `(http.host eq "staging.50mmretina.com" and cf.client.bot)`, and the client is a
declared bot. The rule is working as designed. Consequence: **no session can load the staging
frontend**; frontend rendering is necessarily OWNER-ATTESTED.

**Auth.** All 513 accounts log in (spot-checked 14/99/250/399/507 plus judges, editor, admin);
control `member508` correctly rejected. Real signup → immediate session, profile built by
`handle_new_user` with name, fallback avatar and role. `login_methods ["email","google"]`,
`email_confirmation_required false`.

**Edge functions.** 74 ACTIVE. 20/20 sampled callable; control `zz-control-absent` → 404.
`dashboard-init` called as a signed-in member returns
`["badges","cached","profiles","roles","settings","sidebar","user_id","user_meta"]`.

**CORS from `https://staging.50mmretina.com`.** ACAO echoes the staging origin on
`dashboard-init`, `s3-presign-upload`, `rank-feed`. Suffix look-alike NOT echoed — the
`startsWith` bypass is closed. Residuals: a disallowed origin receives `*` rather than no
header; `submit-judge-decision` returns `*` even to the staging origin (it does not route
through `getSecureHeaders`).

**R2 / CDN.** `g8-probe.txt` served from cdn-staging (body `g8`), 404 on production cdn;
production object 404 on cdn-staging; known-absent control 404. Read isolation holds
bidirectionally.

**Staging cannot reach production Supabase.** staging anon key → production REST **401**;
same key → staging REST **200** (the control).

**Production untouched.** tables 146 · vault secrets 4 · cron 16 · buckets 11 ·
site_settings 35 · RLS policies 686 · `s3_storage_settings.updated_at`
**2026-03-07 13:48:18.332+00 — byte-identical to baseline** · bucket `50mm`.
auth.users 102 (unchanged since G2), posts 277 (organic drift from 270 at G4).

**Structural parity, production vs staging (fingerprints):**
public RLS 686 = 686 (`1676b09acad6d1ab34333f72290ac8aa`) · storage RLS 42 = 42
(`fb9298d8c6f72220892c70cc1b6c2c41`) · public functions 381 = 381
(`3fa7ad43ad5f5b5095218f01577da41d`) · columns/constraints/indexes/enums all identical ·
realtime 29 = 29 · buckets 11 = 11 · triggers and extensions identical.

Method note: the function comparison first showed a FALSE difference because it was ordered
by internal object id, which legitimately differs between databases. Re-ordered by definition
hash — deterministic — the sets are identical. Recorded so the same mistake does not produce
a phantom defect later.

---

## 4. NEW DEFECT FOUND BY THIS AUDIT — TURNSTILE DIVERGENCE

`src/lib/turnstile.ts`: *"Supabase Auth has captcha protection ENABLED (provider: turnstile),
so every password sign-in, sign-up, and password-reset request must carry a valid captchaToken
or GoTrue rejects it server-side."*

Every staging password login above succeeded **with no captchaToken**. Staging's GoTrue does
not enforce captcha.

Consequences: staging auth is materially more permissive than production, and **the Turnstile
path cannot be exercised on staging** — an auth regression involving captcha would pass staging
and fail production. The site key `0x4AAAAAAD2cIy9cziOBz3e9` is a single hardcoded production
key; whether its Cloudflare domain allow-list includes `staging.50mmretina.com` was not
readable from any session.

Recorded nowhere previously.

---

## 5. CARRY-OVER RECONCILIATION (condensed)

CLOSED: G7 robots · G7 WAF/403 (attributed today) · G8 six storage-lane write bypasses (all six
now call `assertStorageLane`) · `CDN_HOST` third surface (guard now scans `supabase/functions`
via R13) · staging edge functions (74 ACTIVE) · CORS for the staging origin · 17 production-origin
email templates (0 literals; 15 of 19 on `laneConfig`) · `SITE_ORIGIN` for Pages Functions ·
DB/R2 runtime configuration · HS-1 (both senses) · HS-2 for staging.

OPEN: **HS-12 no branch protection on `main`** · G1 Access allow-list never read · G1 two
out-of-scope production changes never remediated (variable + deployment `9c0c1201`) · G2 "1558"
reading never taken · G3 organization-level secret scope never checked · G6 deploy-log line never
captured · G6 entry-chunk divergence (`index-CQNRLXfL.js` vs `index-DrppXY7Q.js`) · G5a/HS-2
production arming (Pages never redeployed) · **G8 scoped R2 token unevidenced** · `lane-config.mjs`
still defaults `VITE_SITE_ORIGIN` to production · `_redirects` invalid sitemap proxy rule, both
lanes · scratch branches and PR #88 · `g8-storage-lane-probe` and `g8-probe.txt` · scheduled
health task broken (fetches a `.env` deleted 2026-08-21; runs zero checks).

**The one material G8 gap raised here:** Finding R-2 called a bucket-scoped R2 token "the single
most important credential decision in the staging build", and no document records that a scoped
token was created or with what scope. Read isolation is proven; **write isolation to production
R2 currently rests on `assertStorageLane` alone** — application code, not a credential boundary.

---

## 6. G1–G9 FINAL READINESS

**Gates genuinely GREEN:** G3, G4, G5a (staging), G5b, G6 (scoped), G7, G8.
**Gates NOT GREEN:** G1 (Amber), G2 (Amber), G9 (Blocked).

**Mandatory blockers before G10**
1. HS-12 — branch protection on `main`.
2. Write the G9 closure record (R13, CORS repair, Turnstile, storage buckets all undocumented).
3. Execute the judging flow once end to end — currently 1 judge, 0 decisions, 0 rounds published.
4. Decide and record the Turnstile position for staging.
5. §12.4 step 7 — re-run the G3 secret probe (explicitly non-inheritable).
6. Check for an organization-level `SUPABASE_DB_URL`.
7. Read back the R2 token's actual scope.
8. Capture the production Pages deploy-log guard line.
9. Explain the entry-chunk divergence (read `NODE_VERSION` + `VITE_SUPABASE_PROJECT_ID`).
10. Read the G1 Cloudflare Access allow-list; take the G2 1558-deployment reading.

**Owner-only:** 1, 4, 6, 7, 8, 9, 10; plus acknowledge/revert the two out-of-scope production
changes; decide the 1,558 preview deployments; delete probe artifacts and scratch branches;
rotate the leaked Supabase account token; fix the scheduled health task; decide on rotating
`SUPABASE_DB_URL`.

**Claude / code-session:** 2, 3; prove `assertStorageLane` refuses on the *deployed* copy;
close the two CORS residuals; remove the production default from `lane-config.mjs`; fix the
`_redirects` sitemap rule; correct `apply-migration.yml`'s self-contradicting instructions;
copy the remaining 6 lessons and 4 journal articles; re-home 5 background images; re-take
G5b exit condition 2 (recorded NOT APPLICABLE when no staging Pages project existed).

**Permitted deferred items:** G5b production-lane CI line · G3 §12.4 step 7 · G3 C1 (four
`ANDROID_*` secrets) · G6 Pages-side owner attestation (§8.4 permits it) · G7's non-claim about
real crawler behaviour · G8 ENAM vs APAC region gap · G5b test line 47 liveness.

---

## 7. GO / NO-GO FOR G10

**NO-GO.**

One blocker alone is decisive: G10 is promotion to `main`, and `main` has no branch protection.
Every status document since 2026-08-22 records HS-12 as the sole hard stop and it is still open.
Promoting into an unprotected branch would undo the containment the programme exists to establish.

Beyond that: two gates are Amber on conditions never closed, one gate has no evidence record at
all, the core business flow has never been executed once, and three of the inputs G10's own
§12.4 promotion checks depend on — the secret-probe re-run, the production-lane guard line, and
the production deploy-log line — have not been taken.

Shortest credible path to GO: blockers 1, 2, 3, 5. The remaining six can proceed in parallel and
several are single dashboard readings.
