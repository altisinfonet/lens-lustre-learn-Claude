# §25 — the eight rows, ready to rule. One sheet, one decision per row.

Issued 2026-08-31 by the compiler/audit session.
**This is not a ruling. It is the instrument the ruling needs**: every row with what was measured, when, by whom, and — stated plainly — **what you would be carrying if you accept it.**

---

## Why this sheet exists, and why it is the next step in the order

§24.1 step 4 now **passes**. Step 5 is ruled. Steps 6 and 6a come immediately before promotion. **Step 7 — §11 — cannot be signed while §25 is open**, by §11's own header.

So §25 is next in §24's order, and §25.7.3 gives exactly two ways to close a row:

> *"…every §25.3 row is either **verified** or **recorded as a named residual risk the owner has accepted in writing** — the D-12 / B13 pattern."*

**Route (a) — verification by a separate auditor holding read-only access — is unavailable.** There is no separate auditor. §25.4 is explicit that the compiler is not a second party, so nothing I measured closes anything, however carefully it was measured.

**That leaves the written-acceptance route, per row, with its basis.** This sheet is that basis.

---

## The eight rows

### Row 1 — Production database policy state

| | |
|---|---|
| **Measured** | `ad_creative_comments`: **7 policies**, RLS enabled |
| **As-of** | 2026-08-31T06:24:00.150559Z |
| **By** | Developer 2, SELECT-only statements over a `postgres` (superuser-class) connection |
| **Class** | Route (b), **with the limit its author stated**: the export is reproducible from the queries in the file, but a hash of one's own output is not provenance |
| **Agrees with the ledger?** | Yes — §13 AF-17 claims 7 |

**What the count hides, and it is the finding:** the two policies production **lacks** are both **RESTRICTIVE** — `Banned users cannot comment on ads` (INSERT) and `Ad comments follow the ad's visibility` (SELECT). Staging has both.

**Accepting this row means carrying:** *in production today, a banned user can comment on ads, and ad comments are readable irrespective of whether the parent creative is visible.* **The merge does not fix it. Applying `20260828082136` (D-10, post-merge) does.**

---

### Row 2 — Staging database policy state

| | |
|---|---|
| **Measured** | **9 policies**, RLS enabled |
| **As-of** | 2026-08-31T06:24:03.390207Z |
| **By** | Developer 2, same connection class and same stated limit |
| **Agrees with the ledger?** | Yes — §13 AF-17 claims 9 |

The other seven are identical across lanes on name, permissive flag, roles, cmd, `qual` and `with_check`.

**Accepting this row means carrying:** almost nothing. Staging is the correct state; production is the deficient one. **This row is the control that makes row 1 legible.**

---

### Row 3 — Deployed edge-function state

| | |
|---|---|
| **Measured** | `submit-judge-decision` **v23**, serving `access-control-allow-origin: *` |
| **As-of** | 2026-08-31T06:24:49Z |
| **Method** | **Probed as served, not read as written** — four OPTIONS preflights: production origin, staging origin, `https://evil.example.org`, and no Origin. **All four returned `*`.** No `access-control-allow-credentials` on any probe |
| **Corroboration** | The deployed bundle carries the literal `"Access-Control-Allow-Origin": "*"` at line 45. **Carried and served agree** |
| **The 71-bundle comparison** | Re-measured against the true RC `a42b209e` — **not** the stale 2026-08-26 `702e5ce` baseline — by **two instruments sharing no code**. MATCH sets identical **by membership**, symmetric difference **zero**, join recomputed independently by me |

**Accepting this row means carrying:** *a judging-decision endpoint answers any origin on the internet, and 50 of 71 deployed bundles differ from the candidate.* **§23.5.1 condition 2 excludes function deployment from this release, so the merge changes neither.** This is B13's accepted risk 2, still live.

**Note for the record:** §25.7.2 item 4 required this re-measurement and it is **done**. The absence of `allow-credentials` bounds the exposure and should be stated whenever the `*` is.

---

### Row 4 — R2 token policy / bucket scope

| | |
|---|---|
| **Measured** | Token id **`73a7920647481fd93553f9c1f68bf5a3`** confirmed **from the address bar**, not a label. Scope: *"Apply to specific buckets only"* → **`50mm-staging`, and nothing else.** Permission Object Read & Write |
| **As-of** | 2026-08-31, ~05:5x UTC |
| **By** | me, in the owner's browser, read-only. Only `Edit` was clicked — never `Roll`, never `Delete`. Form read and abandoned without `Update` or `Cancel` |
| **§25.4's claim** | *"exactly one policy, `R2 › 50mm-staging`, and no policy naming `50mm`"* — **CONFIRMED** |

**Two things §25.4 does not ask about, measured anyway: TTL = Forever, and no client-IP filtering.**

**Accepting this row means carrying:** *a never-expiring, IP-unrestricted read/write token on the staging bucket* — and separately, that **the production bucket runs on a User API token** while staging runs on an Account token, which is backwards from Cloudflare's own guidance. **Lane separation itself holds: no token spans both buckets.**

---

### Row 5 — GitHub `staging` Environment

| | |
|---|---|
| **Measured** | Environment exists **and now carries its own `SUPABASE_DB_URL`** |
| **As-of** | **2026-08-31T07:40:40Z** — verified live by me on the dashboard |
| **History** | Failed at 13:50:48Z, 05:06:13Z and 05:06:44Z. Secret created by the **owner** at ~07:35Z; I entered no value and the guard refused every keystroke into that dialog |
| **§24.1 step 4** | **PASS** |

**Accepting this row means carrying:** *`apply-migration.yml target=staging` is now operable, and at the candidate its `environment:` line is live* — so a dispatch from the `staging` branch now passes the `if [ -z "$DB_URL" ]` check at line 122 and reaches line 174, where free-text input is interpolated into shell before the step's own validation runs.

**This is the newest exposure on the list and it did not exist yesterday. It closes when the replacement RC is adopted.**

---

### Row 6a — Cloudflare R2 bucket state

| | |
|---|---|
| **Measured** | `50mm` 1.15 GB · `50mm-staging` 178.37 MB. **Both report Public Access: Enabled** |
| **As-of** | 2026-08-31T13:46:54Z / 13:47:52Z *(capture session times)* |
| **By** | me, read-only |

**Accepting this row means carrying:** *both buckets are publicly readable*, and production holds a **`national-ids/`** prefix under that setting. **Not a release item — the merge changes neither bucket — but it should not be accepted silently.**

---

### Row 6b — the `isolation-probe/` prefix

| | |
|---|---|
| **Measured** | **0 objects** in `50mm`; **0 objects** in `50mm-staging` |
| **As-of** | 13:46:54Z and 13:47:52Z |
| **Limit, from §25.4 itself** | *"**After-only**: no before baseline exists for run `33079091310` and none can be created retroactively… the missing baseline must be recorded, not glossed"* |

**Accepting this row means carrying:** *nothing is under that prefix now, and it can never be shown that nothing was ever written there.* **The absence of a baseline is permanent and is part of what is accepted.**

---

### Row 6c — Cloudflare Zero Trust posture

| | |
|---|---|
| **Measured** | **0 reusable Access policies. 1 legacy policy** — `Allow Members - Cloudflare Pages`, id `6f38b454-64f3-4cd9-9518-9f0142c3babd`, action Allow, one rule (a single email), **MFA Off**, created 2026-08-22 — covering **`*.lens-lustre-learn-claude.pages.dev`** |
| **As-of** | 13:49:22Z–13:49:55Z, re-confirmed 05:07:36Z and 05:07:50Z |
| **§25.4's instruction** | *"NEED EVIDENCE. Never measured… **Must not be recorded as a pass**"* |

**This is the first measurement ever taken of this row, and it is not a pass.**

**Accepting this row means carrying:** *no Cloudflare Access application covers `staging.50mmretina.com`.* Whatever protects staging, it is not Access.

**A trap that must travel with this row:** the Access **Applications** page shows a plan paywall that reads as *"nothing is configured."* The **Legacy** tab shows the live application. **Anyone re-checking must open the Legacy tab.** I nearly recorded the confident wrong answer.

---

## What an acceptance has to say to be one

The pattern already used twice in this ledger (D-12, B13). Each row needs, **in your own words**:

1. **Which row**, and that you have read what it says.
2. **The risk you are carrying**, stated as a risk — not as "measured and fine".
3. **That it is bounded to this release** and does not carry forward without being re-taken.
4. **Signed and dated by you.**

**What an acceptance is not:** agreeing that the measurement was careful. Every row here was measured carefully. §25.4's whole point is that careful measurement by the compiler is not verification, and calling it verified would be the single most damaging thing that could be written into this ledger.

---

## Rows that are close to costless, and rows that are not

**Low cost to accept:** rows 2, 4, 6a, 6b — configuration facts, measured, agreeing with the ledger, changing nothing about what the merge does.

**Real cost to accept:** rows 1, 3, 5, 6c — each carries a live production condition:

- **Row 1** — banned users can comment; ad comments ignore parent visibility
- **Row 3** — a judging endpoint answers any origin; 50 of 71 bundles drift from the candidate
- **Row 5** — the staging dispatch path is live against an unfixed workflow
- **Row 6c** — staging is not behind Access

**Three of those four are unchanged by the merge. Row 5 is the exception: it was created today, and adopting the replacement RC closes it.**

---

## Standing

**Eight rows captured. Zero closed.** Nothing in this document closes anything, and it is not written to persuade you toward acceptance — several rows read better as reasons to fix something first.

**§25 closes when eight acceptances exist in writing, or when the rows are verified by a second party. There is no third route, and I am not one.**
