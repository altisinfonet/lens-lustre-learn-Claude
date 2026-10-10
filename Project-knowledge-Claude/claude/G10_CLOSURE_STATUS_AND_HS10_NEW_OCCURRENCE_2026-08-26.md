# G10 — CLOSURE STATUS · G9 EXCLUDED · A NEW HS-10 OCCURRENCE

**2026-08-26. Read-only throughout. Nothing deployed, merged, pushed, rotated or configured.**
G10 scope only. No G9, G11 or G12 work performed.

---

# 1 — G9: RECORDED AS EXCLUDED

> ## **G9 = EXCLUDED FROM G10.**
>
> **Reason:** 29 of 71 production edge functions drift from the candidate repository; 3 of those would
> **regress production** if redeployed; and no credible function-level rollback currently exists.
> G9 requires its own future release with deployed-state snapshots and per-function review.

Evidence: `G10_PHASE1_EVIDENCE_DRIFT_INVENTORY_2026-08-26.md` (21 MATCH · 21 pre-G9-CORS-only ·
29 DRIFT · 0 UNKNOWN). **No production edge function was redeployed. No G9 implementation was started.**

This ruling must be entered under §14 as a written residual-risk acceptance naming what stays open:
all 71 functions run pre-G9 CORS; ten functions sign S3/R2 delete calls with no storage-lane guard;
and `submit-judge-decision` serves `Access-Control-Allow-Origin: *`.

---

# 2 — HS-10: A SECOND, LIVE, PREVIOUSLY UNRECORDED OCCURRENCE

Found today while gathering the staging-email evidence — **not** by looking for it.

## The defect

**Production `process-email-queue` v27 (ACTIVE) writes part of the live email-provider credential into
Supabase function logs on every invocation.**

Read from the deployed production source (not the repository):

- One log statement in the top-level request handler emits: the **credential's source**, its **full
  character length**, and a **9-character prefix** of the key.
- It sits immediately after the "no key configured" guard, **unconditionally** — so it runs on every
  invocation that resolves any key, including runs that process zero messages.
- The identical statement is present in the deployed **staging** copy.

**No log output was retrieved and no credential value was seen** — this is a source-code finding.

## Severity, stated honestly rather than inflated

Brevo API keys are documented as beginning with the fixed vendor prefix `xkeysib-`, which is 8
characters. **If the key follows that documented format, 8 of the 9 logged characters are a public
constant and the actual secret material disclosed is approximately one character, plus the key's
length.** That is a low-severity leak in practice.

It is nevertheless a real defect and it is **live and continuous**, and it meets HS-10's own literal
trigger — *"if a secret value ever appears in … a log … treat it as compromised and rotate it."*

## Why it changes the shape of HS-10

1. **A second secret class is now identified.** The project record's three occasions concern the
   **Supabase personal access token**. This is the **Brevo (email-provider) API key** — a different
   credential, exposed through a different channel, never recorded.
2. **Rotation alone does not close it.** The logging is in deployed code. A rotated Brevo key is
   re-exposed on the very next invocation. Closing this requires either a code fix (a redeploy of
   `process-email-queue`) or an explicit written acceptance of continuing exposure.
3. **The fix is not surgical.** `process-email-queue` is DRIFT class C: its deployed `index.ts` and 16
   template files differ from the candidate. Redeploying it from the repo would carry the whole
   lane-config change set with it — which is precisely the G9-class action now excluded from G10.

## Where the production credential lives — OWNER MUST CHECK

The deployed production code resolves the Brevo key with the **database taking precedence**:

1. `BREVO_API_KEY` env secret is read and trimmed;
2. `site_settings` where `key = 'smtp_settings'` is read — if `provider = 'brevo'` and `api_key` is
   non-empty, it **overwrites** the env value;
3. if neither yields a key, HTTP 500.

**Net precedence: the database row wins; the environment secret is the fallback.**

I attempted a read-only existence check on production `site_settings` — selecting only `provider`, a
boolean "has api_key", and a length, never the value. **The action was blocked by this environment's
safety classifier, and I did not attempt to work around it.** So:

> **OWNER ACTION:** determine whether production `site_settings` holds an `smtp_settings` row with a
> non-empty `api_key`. If it does, a live email credential is stored in a database table and rotation
> must cover that location, not only the environment secret.

---

# 3 — HS-10: EXACTLY WHAT IS STILL REQUIRED TO CLOSE IT

**Not closed. Not ROTATED. No rotation has occurred and I cannot perform one.**

## The unresolved gap in field (b)

The record cites **three** occasions and identifies the class of **one**. A targeted search of the
project records returned **no document identifying the other two**. Per instruction they are **not
guessed**. They remain **UNIDENTIFIED**, and only you can recall or reconstruct them.

## Owner actions required — in plain terms

| # | Action | Notes |
|---|---|---|
| **1** | **Identify the other two exposures.** For each: which credential class, and where the value appeared. | Class only — never the value. If they cannot be recalled, say so explicitly; "unidentified" is an admissible answer, "probably the same one" is not. |
| **2** | **Rotate the Supabase personal access token.** | ⚠ This will likely break this session's Supabase access. Expect it. |
| **3** | **Prove the OLD Supabase token is dead.** Attempt one authenticated call with the old token and confirm it is rejected. | Must be *tested*, not assumed. Do not paste either token anywhere. |
| **4** | **Decide on the Brevo key.** Rotate it, and rule on the ongoing logging: fix the function, disable it, or accept the exposure in writing. | Rotation without a code fix does not stop re-exposure. |
| **5** | **Check `site_settings.smtp_settings` on production** (section 2 above) so rotation covers every location. | |
| **6** | **Confirm no replacement value appears anywhere** — repository, logs, CI output, screenshots, release artefacts — and say how you checked. | |

## The evidence needed afterwards

For **each** affected credential class, all five C5 fields:

| | Field | Acceptable form |
|---|---|---|
| a | Did rotation occur? | yes / no |
| b | Which secret class? | the class name — never a value, fragment or hash |
| c | Rotation completion timestamp | UTC |
| d | Is the OLD credential invalid? | **how it was tested**, and the result |
| e | Does any replacement value appear in repo, logs, CI, screenshots or artefacts? | must be **no**, with the check described |

Plus, for the Brevo key specifically, a sixth: **the ruling on the ongoing log exposure**.

**Admissible outcomes:** `ROTATED` (all fields answered) or `ACCEPTED` (explicit written acceptance of
residual risk, fields answered as far as they can be). Anything else leaves §17-3 failing, and §17-3
gates the entire twelve-line checklist.

## Surface impact — correction retained

Rotating the **Supabase PAT** changes **no surface** in the step 0.0 inventory: it is not stored in
GitHub, and no workflow deploys functions. Rotating the **Brevo key** changes surface 10 only if it is
held as a GitHub secret — it is **not** among the five measured — so its locations are the Supabase
function-secrets store and possibly the production database. **Neither rotation changes surfaces 9 or
10 as previously proposed.**

---

# 4 — STAGING EMAIL (OPTION 1): §15 CANNOT BE CLOSED GREEN

Decision retained: **staging sends no email.** Minimum read-only verification performed; **no staging
configuration was modified and nothing was deployed or invoked.**

## What the deployed staging code actually shows

Three of the four email functions **cannot send at all** — `send-transactional-email`,
`send-reengagement-emails` and `auth-email-hook` render and enqueue into pgmq queues and read no
provider credential. **`process-email-queue` is the sole egress point**, and it POSTs to Brevo.

**The claim does not hold as a property of the system:**

- `process-email-queue` prefers a **database-sourced** key from `site_settings.smtp_settings` over the
  environment secret. **An unset `BREVO_API_KEY` therefore does not, by itself, prevent sending.**
- Verified read-only: staging `site_settings` currently has **no `smtp_settings` row**, so the database
  path is unpopulated **right now**. That is a **runtime state, not a code property** — any admin write
  to that table re-arms sending with no deploy.
- The guard is genuinely fail-closed once **both** sources are empty (HTTP 500, no send, no silent
  no-op, no swallowed exception on the send path).
- ⚠ The deployed staging code **unconditionally rewrites every sender address to `@50mmretina.com`** —
  the production domain. If staging ever did send, it would send **from the production sender domain**,
  violating §15's refusal directly.

## Verdict

**"Staging sends no email" is TRUE TODAY, as a conjunction of code and current database state. It is
not a guaranteed property.** Recording it as a §15 GREEN row would overstate the evidence.

### 🛑 STOPPED — THIS NEEDS YOUR APPROVAL

To close §15's email row honestly, one of the following is required. **I have taken neither.**

| Option | What it needs | Your approval required for |
|---|---|---|
| **A · Runtime negative test** | Invoke staging `process-email-queue` with the provider key unset and record the HTTP 500 and literal response, together with a re-check that `site_settings` has no `smtp_settings` row **at the moment of the claim** | **Invoking a staging edge function** — a staging action, outside my standing instruction |
| **B · Record it accurately as conditional** | Enter the §15 row as *"staging sends no email as of <timestamp>, conditional on `site_settings.smtp_settings` remaining absent"*, with the DB check as evidence and the conditionality stated | Nothing — but §15 is then **conditional, not GREEN** |
| **C · Make it structural** | Change the code so the DB credential source is dropped or lane-gated | A code change and an eventual deploy — **outside G10 scope** |

**Tell me which. I will not invoke anything on staging without you saying so.**

---

# 5 — SCHEMA GUARD A2: IMPLEMENTATION PREPARED, NOT APPLIED

**Prepared. Not committed, not pushed, not merged. `Require status checks to pass` NOT enabled.**

The amended `verify-schema-dependencies.yml` is delivered as a file. Validated locally:

- **YAML parses.** Triggers: `pull_request`, `workflow_dispatch`.
- **`workflow_dispatch` is intact** — both inputs, the choice list and the default preserved verbatim.
- **`pull_request` is restricted to `branches: [main]`** — staging-targeted PRs are not gated, so no
  staging database binding and no new secret, exactly as A2 requires.
- **Zero unguarded `inputs.*` references remain** (checked programmatically). Every one is wrapped in
  `github.event_name == 'workflow_dispatch' && inputs.X || '<default>'`, which is what prevents the
  self-block: on a `pull_request` the expression yields `production`, binding the environment that
  actually holds `SUPABASE_DB_URL`.
- The credential-ref assertion, the 41-case harness gate and the guard step are **unchanged in
  substance**; only `${{ inputs.* }}` became `"$TARGET"` / `"$SOURCE_DIR"`.

### The ordering that must be followed

1. Commit via PR into `staging` (Phase 2, step 2.2)
2. Promote to `main` (Phase 8) — **still not required**
3. **Watch one real run report on a `main`-targeted PR**
4. **Only then** enable `Require status checks to pass` — the surface-9 change

⚠ **Enabling it before step 4 makes the G10 promotion PR unmergeable.**

---

# 6 — G10 CHECKLIST

## 🟢 GREEN — evidence exists

| Item | Evidence |
|---|---|
| Phase 0 baseline — Pages config, 10 variables, build command, production branch | Measured 2026-08-26 |
| Phase 0 — `robots.txt`, `sitemap.xml` byte-exact sha256; apex behaviour | Measured; **no apex→www redirect exists** |
| Phase 0 — 11 production schema fingerprints; ACL delta re-derived through 5 hash-independent counters | HS-4 does not fire |
| Phase 0 — error-rate baseline, two windows | 3×502 in both — pre-existing, not release-caused |
| Phase 0 — deployment ID, source commit, tree; rollback target present | `6a383d3b-…`, `b671e1f`, `db8df567…` |
| Phase 0 — 71-row edge-function baseline | All ACTIVE |
| Phase 0 — GitHub ruleset (3 rules, empty bypass), environments, secret names | Read visually; a11y tree was wrong |
| Phase 0 — DNS (13 of 19 records), R2 buckets and lane mapping | Lane separation confirmed |
| **G9 drift inventory — 71/71 compared, 0 UNKNOWN** | The basis for excluding G9 |
| **A2 implementation prepared and validated** | Delivered as a file, not applied |

## ✅ CLOSED — decided and recorded

| Decision | Outcome |
|---|---|
| **G9 CORS scope** | **EXCLUDED from G10** — separate future release. §14 ruling still to be written by you |
| **Schema-guard mechanism** | **A2** — prepared; requirement enabled only after promotion |
| **Staging email policy** | **OPTION 1** — chosen and retained. The *policy* is closed; its *evidence* is not |

## 🔴 OPEN — blocking

| # | Item | Why |
|---|---|---|
| 1 | **HS-10 — Supabase PAT** | Not rotated. Owner action; I cannot perform it |
| 2 | **HS-10 — other two occurrences** | Unidentified. Not guessed. Owner recall required |
| 3 | **HS-10 — Brevo key, NEW live occurrence** | Ongoing per-invocation partial logging in production. Needs rotation **and** a ruling on the logging |
| 4 | **HS-10 — `site_settings.smtp_settings` on production** | Existence check blocked by the safety classifier; owner must check |
| 5 | **§15 email row** | Cannot be GREEN. Needs your choice of option A, B or C in section 4 |
| 6 | **§17-3** | Fails while any of 1–4 is open — and it gates all twelve lines |

## ⏸ NOT STARTED — correctly, because HS-10 gates them

Phase 2 (candidate merge), Phase 3 (freeze), §10 RC record, §11 approval, Phases 8–9 (promotion and
reconciliation), §18. Also still outstanding from Phase 0: Zero Trust policies, R2 per-bucket
CORS/public access, and 6 unenumerated DNS records — none blocking Phase 1, all required before Phase 2.

## Is G10 ready to proceed to the next phase?

# **NO.**

**Phase 2 must not begin.** §17-3 requires that no §14 hard stop is live. **HS-10 is live**, now with
a second identified secret class and an ongoing automated exposure that rotation alone will not stop.
Two of the four owner decisions are recorded in substance (G9, A2); **none of the four can be formally
recorded as complete** while HS-10's five C5 fields are unanswerable.

## Exact owner actions required

1. Identify the other two exposure occurrences — class and channel — or state that they cannot be identified.
2. Rotate the Supabase personal access token, and **test** that the old one is rejected.
3. Rule on the Brevo key: rotate it, and decide fix / disable / accept for the ongoing log exposure.
4. Check whether production `site_settings` holds an `smtp_settings` row with a non-empty `api_key`.
5. Choose option **A**, **B** or **C** for the §15 email row — and if **A**, explicitly authorise me to invoke one staging function.
6. Write the §14 ruling recording G9 as excluded with its named residual risk.

*Read-only throughout. No deploy, no merge, no push, no secret change, no protection change, no
production or staging write. No secret value, fragment or hash was displayed or recorded. One
read-only query was refused by the safety classifier and was not worked around.*
