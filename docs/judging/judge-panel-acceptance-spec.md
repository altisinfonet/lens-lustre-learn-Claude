# Judge Panel — Acceptance Spec v3 (Plain English)

**Date:** 2026-04-25
**Author:** Claude (per Lockdown plan)
**For:** Project owner (non-technical) — read this like a movie script.
**Status:** v3 — incorporates ALL user corrections from v1 yellow-highlight pass.

> **What changed in v3 vs v1/v2:** Eight corrections from your annotated spec are now baked in:
> 1. Closing a round = TWO steps: judge **locks**, admin **declares** (Golden Rule).
> 2. **Marks are NEVER public** — internal record only, every round.
> 3. **All tags live in Round 4 only** — R1/R2/R3 have no tag UI.
> 4. **All 10 criteria are MANDATORY** in R2/R3/R4.
> 5. R2 panel surfaces a **Total Average Score** to judge + admin only.
> 6. R3 wording fixed to "Shortlisted for **Final**".
> 7. R2/R3 certificate eligibility = status only, no tag dependency.
> 8. Confirmed R1 has no sliders, no tags, no comments.

---

## 🔑 GOLDEN RULES (do not break)

1. **Two-step round close.** Judge clicks "Complete Round" = LOCK only. Admin clicks "Declare Round N" = PUBLISH (emails + badges + certificates + public visibility). Never automatic.
2. **Marks are private.** The 10-criteria scores never leave the admin/judge boundary. Public, participants, and other judges never see numbers — ever.
3. **Tags only in R4.** Top 100, Top 50, Winner, Runner-Up, Honorary, Special Jury — every tag is assigned in Round 4 only. R1/R2/R3 have no tag UI.
4. **10 criteria mandatory in R2/R3/R4.** A photo is not "judged" until all 10 sliders carry a value. Save/Next/Complete is blocked otherwise.
5. **Judge identity hidden.** Public sees "Judge #1, Judge #2" — never the real name.

---

## 0. Before judging begins

**The judge logs in.**

1. Judge goes to the site, signs in with email/password or Google.
2. On the left sidebar, they see a **"Judge"** menu item (only visible because their role = `judge`).
3. They click "Judge". They land on a page listing every competition they've been assigned to.
4. Each competition shows: **competition name, cover image, current phase** (Submission Open / Voting / Judging / Result), and a button.
   - Phase = **Submission Open** or **Voting** → button reads **"View Submissions"** (read-only).
   - Phase = **Judging** and voting end-date has passed → button reads **"Start Judging"** (enabled).
   - Phase = **Result** → button reads **"Completed"** (disabled, grey).
5. Judge identity is **never** visible to the public or to other judges.

✅ **Confirmed by you:** This landing page is fine as-is.

---

## 1. Round 1 — Initial Screening (decision-only)

**The judge clicks "Start Judging" on a competition.**

1. The screen goes **full-screen Cinema Mode**. Three columns:
   - **Left:** sidebar with photo buckets (Accepted, Shortlisted for R2, Needs Review, Rejected).
   - **Middle:** the current photo, large, with photographer name + avatar shown above it.
   - **Right:** evaluation panel.
2. The right panel shows **four big buttons only — no sliders, no tags, no comments** (✅ confirmed by you):
   - **Accept** (`A`)
   - **Shortlist for R2** (`S`)
   - **Needs Review** (`N`)
   - **Reject** (`R`)
3. The judge clicks one button. The decision saves. The screen auto-advances to the next photo.
4. Top of screen: a **smart button** changes state — "Begin Judging" → "Pause" → "Complete Round" → "Completed".
5. Pause-and-resume works (`judge_sessions`).
6. **Multi-photo entries:** decided per-photo. Entry status = `Shortlist > Accept > Reject`.
7. **Cannot Complete** while any photo is "Needs Review".
8. When the judge clicks **"Complete Round"** → Round 1 is **LOCKED for judges**. Participants still see nothing.

**What the participant sees:** **NOTHING** until the **Admin clicks "Declare Round 1"** (Golden Rule #1). Then the participant gets an email + in-app badge — *Accepted* / *Rejected* / *Move to R2* / *Needs Review*.

**Marks visibility:** ❌ **Marks are never shown to anyone in any round. Internal record only.** (Golden Rule #2 — overrides the earlier SOW snippet about "marks visible to public after declaration".)

---

## 2. Round 2 — Scoring (no tags)

**The judge opens the same competition. Round 1 is locked + declared. Round 2 is open.**

1. Judge clicks **"Round 2"** in the left sidebar.
2. **Only photos that were "Shortlisted for R2"** in Round 1 appear. Everything else is hidden.
3. The right panel shows:
   - **10 scoring sliders (0–10 each):** LINE, SHAPE, FORM, TEXTURE, COLOR, SPACE, TONE, BALANCE, LIGHT, DEPTH.
   - Each slider has a small number box for typing the score directly.
   - A **Total Average Score** read-out is shown live to the judge (and to admin in audit views). It is **not** shown publicly.
   - A **comment box** for judge notes (optional, internal only).
   - ❌ **No tag chips.** All tagging happens in Round 4 only (Golden Rule #3).
4. **Auto-tier rule (SOW):** when the judge has scored all 10 criteria for a photo, the system computes the average and writes the per-photo decision automatically:
   - Average **0** → Needs Review
   - Average **1.0–6.9** → Qualified for R2
   - Average **7.0–10** → Qualified for R3 (Shortlisted)
5. **All 10 criteria are MANDATORY** (Golden Rule #4). Save / Next / Complete is blocked while any criterion is empty. The judge cannot leave a photo half-scored.
6. Sidebar buckets update live: "Qualified for R2 (1–6)", "Qualified for R3 (7–10)", "Needs Review (0)".
7. Same Pause / Complete logic. Cannot complete while Needs Review > 0 OR any photo has fewer than 10 scored criteria.
8. Round 1 photos visible in a "History" tab, read-only.

**What participants see:** Nothing until **Admin Declares Round 2**. Then: status badge only — no marks, no scores, no comments.

---

## 3. Round 3 — Same as R2, narrower pool

**Same UI as R2. Differences:**

1. Only photos with R2 status = **Qualified for R3 (Shortlisted)** appear.
2. ❌ **No tag chips.** All tagging happens in R4 only.
3. **All 10 criteria mandatory.** Same auto-tier:
   - **0** → Needs Review
   - **1.0–6.9** → Qualified for R3
   - **7.0–10** → **Shortlisted for Final**
4. R1 + R2 visible read-only in History.

**What participants see:** Nothing until **Admin Declares Round 3**. Status badge only.

---

## 4. Round 4 — Final + Awards (the only round with tags)

**Same scoring UI as R3. PLUS the full tag palette.**

1. Only photos that were **Shortlisted for Final** (from R3) appear.
2. **All 10 criteria mandatory.** Auto-tier:
   - **0** → Needs Review
   - **1.0–6.9** → Qualified for Final
   - **7.0–10** → Award-eligible
3. After scoring, the judge assigns **tags** to award-eligible photos. **This is the only round where tagging exists.** Full palette:
   - **Top 100** (no cap)
   - **Top 50** (no cap)
   - **Winner** — exactly ONE per competition, mandatory to declare R4
   - **1st Runner-Up** — optional, no cap
   - **2nd Runner-Up** — optional, no cap
   - **Honorary Mention** — optional, no cap
   - **Special Jury** — optional, no cap
4. **"Complete Round" button** is enabled only when:
   - Every photo has all 10 criteria scored, AND
   - Needs Review = 0, AND
   - Exactly one Winner has been assigned.
5. Judge clicks Complete → R4 is **LOCKED**. Participants still see nothing.
6. **Admin clicks "Declare Final"** → competition phase moves to **Result**. Public results page goes live. Participants get emails + in-app badges. Certificates become request-able. **Marks remain hidden** — only the placement (Winner / RU / Honorary / Special Jury / Top 50 / Top 100 / Qualified Final) is public.

---

## 5. Certificates (after each round is **Declared by Admin**)

Per SOW: *"Certificate can request for Download. PDF Copy Certificate will be Auto Generated and visible to his/her section"*

1. After each round is declared **by the Admin**, eligible participants see a **"Request Certificate"** button in their dashboard. (Locking on the judge side does NOT make certificates appear.)
2. They click it once. The PDF is generated and stored. Button → **"Download Certificate"**.
3. Eligibility (revised — tag dependency removed for R2/R3 because tags are R4-only):
   - **R1:** Accepted entries.
   - **R2:** "Qualified for R2" status (no tag needed).
   - **R3:** "Qualified for R3" status (no tag needed).
   - **R4:** Any tag (Winner / RU / Honorary / Special Jury / Top 50 / Top 100 / Qualified Final).

---

## 6. Hard rules across all rounds (do not break)

- **Two-step round close.** Judge "Complete" = lock. Admin "Declare" = publish. (Golden Rule #1.)
- **Marks are private.** Never shown to public, participants, or other judges. Internal record only. (Golden Rule #2.)
- **Tags only in R4.** No tag UI in R1/R2/R3. (Golden Rule #3.)
- **10 criteria mandatory in R2/R3/R4.** No partial scoring. (Golden Rule #4.)
- **No comments, no likes, no reactions** on any photo while in `voting` or `judging` phase (SOW p.2 line 33). Public engagement is hidden. Vote counts hidden too.
- **Judge identity hidden** — always "Judge #1, Judge #2".
- **Last update wins.** No "Clear Marks". Judges overwrite, never delete.
- **100% coverage to declare** — every assigned judge has decided every eligible photo AND scored all 10 criteria where applicable.
- **Locked rounds** (🔒) only editable for "Needs Review".
- **Mobile UI = full parity** with desktop for all evaluation actions.

---

## 7. What the participant sees (mirror view)

After each round is **declared by the Admin**, on **My Submissions**, for each photo:

- A **status badge**: *Accepted / Shortlisted / Qualified for R2 / Qualified for R3 / Shortlisted for Final / Needs Review / Rejected*.
- After R4: the **tag** (Winner / RU / Honorary / Special Jury / Top 100 / Top 50 / Qualified Final).
- An **email** notification.
- A **"Request Certificate"** button if eligible.
- ❌ **Never any marks**, criterion numbers, judge comments, or per-judge breakdown. Participants see status + tag only.

---

## 8. Out of scope (not building unless you say so)

- Blind judging mode
- Tie-breaker UI
- Mid-round disqualification
- AI "Recommendations" panel
- Public per-judge per-criterion score table (removed because marks are now private)

---

## ✅ Your job now (v3)

Read this v3 like a story. For each line:
- ✅ "Yes" → do nothing.
- ❌ "No, change this" → tell me, even one sentence.

If everything reads correctly, reply **"Spec v3 approved"**.

Then I move to **Step 2** of the Lockdown plan: I log into the live preview as a judge and walk every screen against this v3 spec, then come back with the **short blocker list** (the gaps between this spec and the live app). No code changes until you give me that step-2 approval.
