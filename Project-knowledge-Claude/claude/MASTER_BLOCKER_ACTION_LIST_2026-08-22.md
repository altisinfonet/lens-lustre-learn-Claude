# MASTER BLOCKER / OWNER ACTION LIST

**Governing plan: Master Execution Plan Rev 3.0 + Erratum E-1 (clauses 1–8).**
Compiled 2026-08-22, ~17:55 UTC. Supersedes the scattered owner-action tables in
the earlier dated records. **No investigation runs until one of these completes.**

Statuses are unchanged and are not restated here beyond what each item gates:
G3 AMBER · G5b OPEN · G6 AMBER (Path A only) · G7 OPEN/STOPPED · G8/G9 OPEN ·
G10 BLOCKED. Everything else GREEN.

---

## ⚠ SEQUENCING PROBLEM — READ FIRST

Items 2 and 3 as written cannot be done the way the plan assumes.

A **Cloudflare Pages custom domain** and an **R2 custom domain** both create
their own DNS record. The record must be proxied, and Cloudflare writes it when
the domain is attached to the project or bucket. There is no correct standalone
record to hand-create first — a hand-made record is either wrong (wrong target,
DNS-only) or gets replaced.

So the real order is: **create the staging Pages project → attach
`staging.50mmretina.com` → Cloudflare writes the DNS**, and **create/confirm the
`50mm-staging` R2 bucket → attach `cdn-staging.50mmretina.com` → Cloudflare
writes the DNS**.

Creating the staging Pages project is the first step of G7, which E-1 clause 7
holds until DNS verification passes. That is circular as written. **It needs
your ruling — option A or B in item 2.** This does not change any status; it is
a sequencing correction surfaced before it wastes your time.

---

## THE LIST

### 1. Path B backend hostname — *classification, possible HS-1*

**Action:** In the browser Network panel on `www.50mmretina.com`, right-click any
column header → tick **Domain**. Send the domain shown on the `site_settings`
row. It looks like `<20-char-ref>.supabase.co`. Hostname only — no key, no token,
no query values.

**Gates:** G7 design (E-1 clause 7 item 2), and the E-1 clause 8 HS-1 assessment.

**On receipt:** hostname compared against `jtdtehuqtinjxropkkcn` (production) and
`ztzutckwdhetphwghuzj` (staging). Production → **stop, HS-1, no remediation**.
Staging → recorded. Neither → UNVERIFIABLE-BY-DESIGN, stop.

---

### 2. `staging.50mmretina.com` — *the critical path*

**Action — choose one:**

- **Option A (recommended).** Authorize me to re-sequence: I design G7, you
  create the staging Pages project and attach the custom domain from the
  dashboard, Cloudflare writes the DNS, and I then run the six-part DNS
  verification against it. Verification still gates everything downstream —
  only its position moves.
- **Option B.** You create a proxied placeholder record now
  (`A staging → 192.0.2.1`, **Proxied**), I verify it resolves with the
  Cloudflare signature, and G7 later replaces it via the Pages custom-domain
  flow.

**Gates:** G7, then G8, G9, the entire §15 testing matrix, RC and G10. **Nothing
downstream of G7 can move until this resolves.**

**On completion:** the six-part DNS verification runs immediately — three
recursive resolvers, the authoritative nameservers, the known-absent control in
the same run, target/signature check, conflicting-record check, and the zone SOA
serial compared against the recorded `2410539482`.

---

### 3. `cdn-staging.50mmretina.com`

**Action:** Same pattern, from R2. Cloudflare dashboard → R2 → bucket
`50mm-staging` → **Settings → Custom Domains → Connect Domain** →
`cdn-staging.50mmretina.com`. Cloudflare writes the proxied record. If the
bucket does not exist yet, say so — its creation belongs to G8 and needs its own
authorization.

**Gates:** G7 and G8. No servable staging CDN without it.

**On completion:** verified in the same DNS pass as item 2.

---

### 4. Production Pages `SUPABASE_PROJECT_REF`

### 5. Production Pages `SUPABASE_ANON_KEY`

**Action (one visit covers both):** Cloudflare dashboard → Workers & Pages →
the production Pages project → **Settings → Variables and Secrets** →
**Production** environment → add both. Values are the production project ref and
its anon/publishable key — both public values that already ship in every bundle,
so neither is a secret. Then redeploy so they take effect.

**Gates:** G5b. Until both exist, deleting the defaults in `functions/_seo.ts`
breaks production edge SEO — Pages Functions have no build step, so the values
cannot be inlined at build time.

**On completion:** G5b executes end-to-end — defaults removed, both variables
made required, guard scan extended to `functions/`, `.ts` added to the scanned
extensions, mutation harness re-run, CI evidence captured.

---

### 6. `main` branch protection — *hard stop HS-12*

**Action:** GitHub → repository **Settings → Rules → Rulesets → New branch
ruleset** (or Settings → Branches → Add rule) targeting `main`. Require a pull
request before merging; block force pushes and deletions.

**Gates:** G10 outright. HS-12 is live until this exists, and item 7 of the §17
final checklist re-attests it on promotion day.

**On completion:** recorded as **OWNER-ATTESTED** — no session can read this
setting, and it will never be reported as independently verified.

---

### 7. G3 §5.3 execution capability

**Action — either:** add `altisinfonet/lens-lustre-learn-Claude` to this
session's authorized sources (the git proxy names this remedy itself), **or**
hand the recorded §5.3 card to a session that can push and delete a branch.

**Gates:** G3 AMBER → GREEN. Required again at G10 step 7 regardless — this
evidence is never inherited into a release decision.

**On completion:** the throwaway branch and probe workflow are created, pushed,
the run observed, the run ID, UTC timestamp and literal `EMPTY` result recorded,
and the branch deleted. No secret value, length, hash, prefix or suffix is ever
printed.

---

### 8. Cleanup — `scratch/lane-check-g3` and PR #88

**Action:** GitHub → Branches → delete `scratch/lane-check-g3`; close PR #88.

**Gates:** nothing. Housekeeping, listed so it is not forgotten at RC freeze.

---

### 9. Production Pages deploy log line — *not in the original eight, but real*

**Action:** After the next production Pages deploy, open its build log and send
the isolation-guard line. It should read
`forbidden=[ztzutckwdhetphwghuzj]`.

**Gates:** **G6 AMBER → GREEN.** It is the only outstanding G6 item. Included
because omitting it would make this list knowingly incomplete — the guard-side
tests are already accepted as VERIFIED and are not repeated.

**On completion:** recorded as OWNER-ATTESTED, and G6's GREEN is worded to
**Path A only**, per Erratum E-1.

---

## PRIORITY

**Item 2 is the critical path** and item 1 is the cheapest. Items 4/5, 6, 7, 8
and 9 close gates in parallel but do not shorten the path to G10 — that path
runs entirely through item 2.

## COMMITMENT ON RESUMPTION

When an item completes, the corresponding gate runs **end-to-end including
verification** — not prepared and handed back. Once G7 starts, execution
continues G7 → G8 → G9 → full §15 staging matrix → RC → G10 without pausing
between substeps for confirmation, stopping only for a genuine hard stop, a
failed exit condition, or an owner-only action.

No status is manufactured GREEN. The project is not called complete until G10
and post-promotion verification are actually complete.
