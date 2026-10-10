# Name Casing + One-Judge Rule — APPLIED (2026-08-15)

**Applied:** `20260815075500_one_judge_per_competition` · `20260815075526_person_name_casing` · `20260815075857_person_name_casing_comment_correction` (drift #15/#16/#17 — all repo files renamed to the connector-assigned versions).
**Commits:** `1cb37eb` `924a002` `a3482f0` `2ead2ed` `4c714f4`. All 10 files byte-identical on origin, 0 unpushed. Suite **1,640 passed | 1 skipped**, tsc clean, security-audit PASS.

## 1. Name casing — owner rule of 2026-08-15
> "Any name can not be ALL CAPS … AVIJIT SHEEL will be Avijit Sheel, SHIV SANKAR das will be Shiv Sankar Das."

Applied: `format_person_name(text)` + a `BEFORE INSERT OR UPDATE OF full_name` trigger on `profiles` + a backfill.
**Verified live:** 0 profiles ALL CAPS, 0 all-lower, 0 differ from the rule, 94 rows intact, platform account still `50mm Retina World`.

**The live data decided the design, not convention:**
- **No lowercased particles.** Every title-case library lowercases `das`/`de`/`van`/`bin`. This member base is Bengali — `sushanta das` → **Sushanta Das**, `SHARMISTHA DE` → **Sharmistha De**. Applying the fashionable rule would have got two real members' names wrong and contradicted the owner's own example.
- **Credentials preserved.** `featured_artists` holds `SOMNATH PAL - AFIAP, AFIP, EFIP` — FIAP distinctions. Title-casing them to `Afiap, Afip, Efip` is a demotion, not a tidy-up. Everything from the first ` - ` or `,` is kept verbatim.
- **Scope held** to `profiles.full_name`. `featured_artists.artist_name` is editorial; `office_staff` is one correct admin row; `profiles_public`/`profiles_public_data` are **views** and inherit it free.

**I gave the owner the wrong count first.** I said 14 (ALL-CAPS 9 + all-lower 5). The rehearsal said **15**: `Tariqul hossain middya` is mixed-case and matched neither bucket. Corrected before applying. *A count derived from two categories is not a count derived from the rule.*

## 2. SELF-CAUGHT: I deployed a false justification
The shipped function claimed `initcap()` turns `50mm` into `50Mm`. **It does not** — Postgres counts digits as alphanumeric; `initcap('50mm')` is `50mm`, verified on production.

I only noticed because the mutation *"delete the digit guard"* **PASSED** — impossible if any fixture depended on it, and none did, because the case I'd written down wasn't the case the guard protects. The guard **is** load-bearing, for `3D`: `lower()` makes it `3d` and initcap leaves it there. Added the `3D studio KOLKATA` → `3D Studio Kolkata` fixture, re-ran, now caught.

Then replaced the **deployed** function so the database stopped asserting the false claim — the comment lives inside the function body, so fixing only the repo file would have left prod and repo disagreeing. Behaviour byte-identical; two comment blocks changed.

**5 mutations:** digit guard (escaped → caught after fixture) · particles lowercased (caught on 3 live-member fixtures) · credentials split dropped in TS · credentials split dropped in SQL · trigger weakened to INSERT-only so a member could reintroduce ALL CAPS on edit.

## 3. One judge, one competition — owner rule
> "in any situation two judges wont be happen. One Judge One Competition this is hard rule."

**What was actually in place:** `UNIQUE (competition_id, judge_id)` — which stops the *same* judge twice and does **nothing** about a second, *different* judge. The constraint looked like the rule and was not the rule.

Now: `UNIQUE (competition_id)` is the guarantee; a trigger supplies a readable message. Delete the trigger and the rule still holds.

**Rehearsed, rolled back:** first judge accepted · second different judge **refused** with the plain-English message · remove-then-add still works, so reassignment stays a deliberate two-step. Safe *at this moment specifically*: 0 competitions, 0 judge rows.

## 4. Found while measuring: `notify_featured_artist` has NEVER fired
It identifies the member by matching a **display string**: `profiles.full_name = featured_artists.artist_name`. The one featured row is `SOMNATH PAL - AFIAP, AFIP, EFIP`; the profile is `SOMNATH PAL`. 0 matches, 0 such notifications ever. There *is* a NULL guard, so it fails **silently** — the photographer is featured and never told.

Matching a person by their rendered name is the defect regardless of casing. **Not fixed** — needs a schema decision (`featured_artists.user_id`) and was found inside a cycle approved for something else.

## Next
Instagram grid — owner asked for **both**: multi-select photo picker when posting, and the 3-column profile grid.
