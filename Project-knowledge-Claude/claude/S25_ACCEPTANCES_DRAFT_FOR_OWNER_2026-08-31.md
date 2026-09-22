# §25 — eight acceptances, DRAFTED FOR THE OWNER TO EDIT AND SIGN

**Status: DRAFT. Not signed. Not in force. Closes nothing.**

Drafted 2026-08-31 by the compiler/audit session at the owner's instruction, from the measured record. **The compiler does not sign these and cannot.** §25.4: *"No row below may be marked closed by the compiler. The compiler is not a second party."*

**Owner: change any wording you disagree with. If a sentence overstates or understates what you are willing to carry, rewrite it — the words have to be yours for the acceptance to mean anything.** Then date and sign at the bottom.

**Route: §25.7.3 second limb** — *"recorded as a named residual risk the owner has accepted in writing"* — the D-12 / B13 pattern. Route (a), verification by a separate auditor holding read-only access, is unavailable: there is no separate auditor.

---

## ROW 1 — Production database policy state

> I accept as a **named residual risk, bounded to this release**, that production's `ad_creative_comments` table carries **7 RLS policies where staging carries 9**, measured 2026-08-31T06:24:00Z.
>
> I have been told what the two missing policies are, and that **both are RESTRICTIVE — both tighten access**. I accept that, **in production today**: a **banned user can comment on ads**, and **ad comments are readable regardless of whether the parent creative is visible**.
>
> I accept that **this promotion does not fix it**. It is fixed by applying `20260828082136` to production, which is **D-10**, already ruled, and post-merge. I accept that the gap stays open until I run that migration.
>
> This acceptance does not carry forward to any later release without being re-taken.

---

## ROW 2 — Staging database policy state

> I accept as a **named residual risk, bounded to this release**, the measured state of the staging lane: **9 RLS policies on `ad_creative_comments`, RLS enabled**, measured 2026-08-31T06:24:03Z, with the other seven identical to production on name, permissive flag, roles, command, `qual` and `with_check`.
>
> I accept that this row was measured by the compiler and **not verified by a second party**, and that it is therefore OWNER-ATTESTED and not audited.
>
> I record that **staging is the correct state here and production is the deficient one**, and that this row exists mainly to make Row 1 legible.
>
> This acceptance does not carry forward without being re-taken.

---

## ROW 3 — Deployed edge-function state

> I accept as a **named residual risk, bounded to this release**, that `submit-judge-decision` is deployed at **v23** and serves **`Access-Control-Allow-Origin: *`**, measured 2026-08-31T06:24:49Z **as served, not as written** — four preflights, including one from `https://evil.example.org` and one with no Origin at all, **all returned `*`**.
>
> I accept that **a judging-decision endpoint answers any origin on the internet**. I record that **no `Access-Control-Allow-Credentials` header is served on any probe**, which bounds the exposure, and that this bound is part of what I am relying on.
>
> I further accept that the 71-function comparison has been **re-measured against the true candidate `a42b209e`** — not the stale 2026-08-26 `702e5ce` baseline — by two instruments sharing no code, agreeing by membership, and that it shows **50 of 71 deployed bundles differ from the candidate**.
>
> I accept that **this promotion changes none of it**: §23.5.1 condition 2 excludes all edge-function deployment from this release. This is B13's accepted risk 2, still live, and I re-affirm it here rather than treat it as closed.
>
> This acceptance does not carry forward without being re-taken.

---

## ROW 4 — R2 token policy and bucket scope

> I accept as a **named residual risk, bounded to this release**, the measured scope of R2 token **`73a7920647481fd93553f9c1f68bf5a3`** (`staging-upload`): **one bucket scope only — `50mm-staging`, with no policy naming `50mm`** — confirmed 2026-08-31 from the token's own configuration.
>
> I record the two facts measured beyond what was asked: the token has **TTL = Forever** and **no client-IP filtering**, so a leak of it has no natural expiry and no address restriction.
>
> I record that **bucket-level lane separation holds** — no token spans both buckets — and separately that **the production bucket runs on a User API token while staging runs on an Account token**, which is the reverse of Cloudflare's own guidance. I accept that as a hardening item for after the promotion, not a blocker to it.
>
> This acceptance does not carry forward without being re-taken.

---

## ROW 5 — GitHub `staging` Environment  *(RE-DRAFTED 2026-08-31, after the replacement candidate landed)*

*(Owner: the previous draft of this row asked you to accept a live injection path. **That exposure is closed** — the patch landed on `staging` at `5ca0d256a994fcab9e5beecfae8b8513d2799446`. Accepting a risk that has since been fixed would have put a false statement in your own ledger, so the row is rewritten rather than signed as it stood. What remains to accept is smaller, and different in kind.)*

> I accept as a **named residual risk, bounded to this release**, that the `staging` environment carries its own **`SUPABASE_DB_URL`**, created by me on 2026-08-31 at approximately 07:35Z and verified present at 07:40:40Z, and that the `production` environment carries one too — verified at the provider on 2026-08-31, **names only, no value viewed**.
>
> **I record what has changed since this row was first drafted, because the change is the point of it.** When the secret was created, the candidate's `apply-migration.yml` carried a live `environment:` line and interpolated free-text input into shell **above** its own validation. A dispatch from `staging` reached that line. It no longer does: at `5ca0d256` **no `${{ … }}` interpolation appears inside any `run:` block of that workflow, or of `verify-schema-dependencies.yml`** — measured on the pushed object, 11 occurrences to 0 and 5 to 0. Every validation the file performs survives, in its original order.
>
> **I accept that the merge therefore no longer creates a production-credentialed injection path**, which it would have done had it been performed before this patch — because the `production` environment holds that credential and admits `main` only, so the merge is what would have made `target=production` operable against an unfixed workflow.
>
> **What I am accepting, stated as a risk and not as a reassurance:**
>
> 1. **The credential exists and is reachable by legitimate means.** `apply-migration.yml` is now injection-free, but it is still a workflow that runs SQL against a live database, dispatchable by anyone with repository write access, with **no required reviewer and no wait timer** on either environment and administrator bypass enabled. The controls that stand between a mistaken dispatch and production are the lane gate, the ref assertion, the confirm-match and the allowlist — **and those now actually execute**, which was the whole defect. I accept that this is a meaningful control surface and not an absence of risk.
> 2. **The patch was written and checked by the same party.** The audit session authored it under my ruling and verified it against a specification it published before writing the code. **That is not a second party**, and §25.4 is explicit that such work is OWNER-ATTESTED, not verified. I accept this row on that basis, and I record that independent verification at `5ca0d256` by a party that did not write the patch is outstanding.
> 3. **It is not Developer 1's `9384ba9a`.** That branch was never pushed and none of its measurements carry over. This is a new object, measured from zero.
>
> This acceptance does not carry forward to any later release without being re-taken.

---

## ROW 6a — Cloudflare R2 bucket state

> I accept as a **named residual risk, bounded to this release**, that **both R2 buckets report Public Access: Enabled** — `50mm` at 1.15 GB and `50mm-staging` at 178.37 MB — measured 2026-08-31, and that production holds a **`national-ids/`** prefix under that setting.
>
> I accept that **this promotion changes neither bucket**, and that the `national-ids/` prefix warrants its own examination **separately from this release and not as a condition of it**.
>
> This acceptance does not carry forward without being re-taken.

---

## ROW 6b — the `isolation-probe/` prefix

> I accept as a **named residual risk, bounded to this release**, that the `isolation-probe/` prefix returns **zero objects in both buckets**, measured 2026-08-31 at 13:46:54Z and 13:47:52Z.
>
> I accept the limit the ledger itself records at §25.4: this is an **after-only measurement**. **No before-baseline exists for run `33079091310` and none can be created retroactively.** I accept that it shows nothing is under that prefix **now**, and that it **can never be shown that nothing was ever written there**.
>
> I record that **the permanent absence of that baseline is part of what I am accepting**, not a gap that later work will fill.
>
> This acceptance does not carry forward without being re-taken.

---

## ROW 6c — Cloudflare Zero Trust posture

> I accept as a **named residual risk, bounded to this release**, the **first measurement ever taken** of this row, made 2026-08-31 and **recorded expressly as NOT a pass**, per §25.4's instruction that it *"must not be recorded as a pass"*.
>
> Measured: **zero reusable Access policies**, and **one legacy policy** — `Allow Members - Cloudflare Pages`, id `6f38b454-64f3-4cd9-9518-9f0142c3babd`, action Allow, a single email rule, **MFA Off** — covering **`*.lens-lustre-learn-claude.pages.dev`** and nothing else.
>
> I accept that **no Cloudflare Access application covers `staging.50mmretina.com`**, and that whatever protects the staging site, it is not Access.
>
> I record the trap for anyone re-checking this: the Access **Applications** page shows a plan paywall that reads as *"nothing is configured"*, while the **Legacy** tab shows the live application. **The Legacy tab must be opened.**
>
> This acceptance does not carry forward without being re-taken.

---

## Signature block

> **These eight acceptances are made under §25.7.3, in my own words, having read what each row carries.**
>
> **I record that none of these rows was verified by a second party.** Every measurement above was taken by the compiler or by a developer session, and §25.4 is explicit that such measurement is OWNER-ATTESTED and does not close an audit row. **I am closing these rows by acceptance, not by verification, and the ledger must say so.**
>
> **I accept that this is the weaker of the two routes §25.7.3 allows, and that I am choosing it because no separate auditor with read-only access is available to me.**
>
> Ruled by: `______________________`  ·  Date (UTC): `______________`
>
> **Not signed by the compiler.**

---

## Compiler's note, and it belongs in the record

**I drafted these at the owner's instruction and I do not sign them.** The four rows that cost something to accept are **1, 3, 5 and 6c**; the four that cost little are **2, 4, 6a and 6b**. I have not softened the language on any of them, and the signature block states plainly that this is the weaker route — because a future reader must be able to tell an accepted risk from a verified one at a glance, and every failure this engagement has recorded came from that distinction being blurred.

**Row 5 HAS been re-drafted, 2026-08-31, after the replacement candidate landed at `5ca0d256`.** The exposure the first draft named is closed, and asking you to accept a fixed risk would have put a false statement in your own ledger. What the row now carries is different in kind and smaller in size: a live credential reachable by legitimate dispatch, and a patch whose author and auditor are the same party. **Read it again before signing — it is not the paragraph you saw first.**\n\n**The other seven rows are unchanged.** Rows 1, 3 and 6c remain the ones that cost something to accept.
