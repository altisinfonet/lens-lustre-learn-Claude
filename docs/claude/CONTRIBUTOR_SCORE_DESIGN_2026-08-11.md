# Contributor Score — Mathematical Design

**50mm Retina World · 2026-08-11 · FOR APPROVAL — NO CODE WRITTEN**

Your standing instruction: *"DO NOT START CODING IMMEDIATELY. First audit the existing implementation… Do not implement until the audit and mathematical design are verified."*

The audit is done. This is the design. Nothing is built until you approve it.

---

## 0. Decisions you have already made

| # | Decision | Your answer |
|---|---|---|
| 1 | Score model | **Two numbers** — lifetime badge + rolling 30-day leaderboard |
| 2 | Active Engagement (20%) | **Launch now, engagement starts at zero** for everyone |
| 3 | When points become permanent | **End of each day**, then locked forever |

Everything below follows from those three.

---

## 1. The key structural idea

Both numbers are read from **one table of daily rows**.

```
contributor_daily_points   ← one row per member per day, written once, never changed
        │
        ├── SUM(all days)          = Contributor Score   (the public badge, lifetime)
        └── SUM(last 30 days)      = leaderboard ranking (Home page top 3)
```

This matters for a reason that is not obvious:

**Because a day's row is only ever INSERTed and never UPDATEd or DELETEd, "the score can never go down" is guaranteed by the shape of the data, not by a rule someone has to remember.** There is no code path that can subtract. A future developer cannot accidentally break it.

It also means there is only **one** set of point rules to write and maintain, not two.

---

## 2. What earns points

Measured **per member, per day**, counted at settle time (end of day) from what is **actually still there**.

| Source | Counted |
|---|---|
| **Posts** | Photos posted that day, `privacy = 'public'`, still present at settle |
| **Comments** | Comments **written** by the member that day, still present at settle |
| **Active Engagement** | Minutes of real active time that day — **no data source yet, so 0 for everyone** |

### Important correction to today's live behaviour

`get_top_contributors_v1` currently counts comments **RECEIVED** on your photos. Your spec asks for comments **WRITTEN**. These are opposite things. A member who comments generously on everyone's work scores **zero** on the live system today.

This design uses **written**, per your spec. It is a real behaviour change, not a tweak, and the top 3 will change the day it goes live.

### Which comments count

`post_comments` + `image_comments` — a member's comments on photographs.

**Not** `ad_creative_comments`. Commenting under an advertisement should not build a contributor score; that would turn ads into a points farm.

---

## 3. Diminishing returns — the point tiers

You asked for diminishing returns so nobody can dump 40 photos in an hour and own the leaderboard.

### ⚠️ These specific numbers are MY PROPOSAL

I do not have your original tier table in front of me — that part of your message was lost when the conversation was compacted, and I will not invent numbers and present them as yours. **If your spec had different tiers, paste them and I will replace these.** If you are happy with mine, say so.

**Posts, per day**

| Posts | Points each | Running total |
|---|---|---|
| 1st – 3rd | 10 | 30 |
| 4th – 6th | 5 | 45 |
| 7th – 10th | 2 | 53 |
| 11th onward | 0 | **53 max** |

**Comments written, per day**

| Comments | Points each | Running total |
|---|---|---|
| 1st – 5th | 4 | 20 |
| 6th – 15th | 2 | 40 |
| 16th – 30th | 1 | 55 |
| 31st onward | 0 | **55 max** |

**Active engagement, per day**

| Minutes | Points |
|---|---|
| 1 point per active minute | capped at **30 max** |

The 30-minute cap is yours, from the spec.

---

## 4. The weights — 45 / 35 / 20

A member's score for one day:

```
daily_score = round(
    450 × (post_points    / 53)
  + 350 × (comment_points / 55)
  + 200 × (engagement_pts / 30)
)
```

**A perfect day is exactly 1000 points.** Maximum 450 from posts, 350 from comments, 200 from engagement — the weights are literally 45 % / 35 % / 20 %, not approximately.

Because engagement has no data source yet, today the practical maximum is **800/day**, and every member is measured on the same 800. Nobody is disadvantaged. When the collector goes live, the missing 200 simply becomes available to everyone from that day forward — and because the badge is a lifetime sum, no past score has to be recalculated.

---

## 5. An important correction to what I told you earlier

Earlier I proposed **percentile-rank normalization** to make the score outlier-proof. **That was wrong and I am withdrawing it.**

Percentile rank is *relative* — your score depends on what everyone else did. If a very active member joins, your percentile falls, and **your score would go down**. That directly breaks the rule you just gave me.

The correct method for a never-decreasing score is **absolute caps**, which is what section 3 does: a member's daily points depend **only on their own activity** and on nothing anyone else does. That is what makes both "never decreases" and "fair" true at the same time.

The rolling 30-day leaderboard needs no normalization at all — it is a rank (`ORDER BY … DESC LIMIT 3`), not a score.

---

## 6. The daily settle — how "never decreases" is enforced

Once per day, a job:

1. Looks at yesterday, for every member.
2. Counts posts and comments **that still exist right now**.
3. Computes `daily_score` by the formula above.
4. `INSERT … ON CONFLICT (user_id, day) DO NOTHING` — writing twice is harmless, and a day already settled can never be rewritten.

Consequences, stated plainly:

- Post 20 photos and delete them the same day → at settle there are 0 photos → **0 points**. Farming fails.
- Post 20 photos and keep them → points awarded at midnight → **locked forever**. Delete them next year and the points stay. Score never falls.
- The badge moves **once a day**. A member who posts this morning sees the number change tonight.

### The one exception

An `admin_adjustment` column, admin-only, audit-logged. It is the only thing in the entire system capable of subtracting, and it exists for proven abuse. If you would rather have **nothing at all** that can subtract, say so and I will leave it out.

---

## 7. What day is "a day"?

The existing daily job on your site runs at **03:30 UTC = 09:00 IST**, so the platform is already reasoning in Indian time.

**My proposal: an IST day** (`Asia/Kolkata`). A member posting at 11 pm IST gets credited to that day, which is what they would expect. Settle at **00:30 IST = 19:00 UTC** of the previous calendar date.

If you would rather use UTC days, say so — it is a one-line difference, but it must be decided **before** launch, because changing it afterwards would move points between days.

---

## 8. Backfill — do old members start at zero?

The badge is a lifetime number, so it should reflect a lifetime. I propose running the settle over **all history**, day by day, from the first post on the platform.

Two honest consequences:

- Backfill can only count content that **survived**. A photo posted and deleted last year cannot be counted, because it no longer exists. This is correct, but it means the backfilled number is "what you built that is still here", not "everything you ever did".
- Long-standing members will launch with large numbers and new members with zero, permanently. That is exactly what you want from "higher score attracts" — **and it is precisely why the Home top-3 must stay rolling 30 days**, or those same members would hold the three slots forever and the leaderboard would be dead on day one.

---

## 9. Security — the score cannot be touched from a browser

- `contributor_daily_points` and `contributor_scores`: RLS on, **SELECT policy only**. No INSERT, UPDATE or DELETE policy exists for any member or admin, so the API cannot write a point at all.
- The settle function is `SECURITY DEFINER` with a fixed `search_path`, `REVOKE ALL … FROM public, anon, authenticated`, executable only by the scheduler.
- Every number is computed server-side from rows the member cannot forge.
- Admins and moderators: **excluded from the leaderboard** (as today) but **still carry a badge** — flag if you want them excluded from the badge too.
- Suspended and deleted accounts: no badge, no leaderboard, via the existing `account_is_live()` guard.

---

## 10. Refresh

| Thing | How often |
|---|---|
| Settle job | once daily, 00:30 IST |
| Home top-3 (rolling 30 days) | cached **15 minutes** |
| Badge beside a name | cached **15 minutes** |

Within your 15–30 minute requirement.

---

## 11. Home page — the visible change

**Now:** `Ramesh · 15 posts` / `Priya · 34 posts`
**After:** `Ramesh · 2,480` / `Priya · 3,910`

You are right that the post count confuses people — it invites members to compare two numbers that mean different things.

Later, the same number becomes the floating badge beside the name on feed, wall and profile. That is a separate piece of work and is not in this design; this design produces the number it will read.

---

## 12. Performance note

Today's `get_top_contributors_v1` has a **three-way cartesian LEFT JOIN** — `COUNT(DISTINCT)` makes the answers right and the cost wrong. It gets worse as the site grows.

The new leaderboard reads 30 pre-computed rows per member from a small indexed table. The expensive counting happens once a night, not on every Home page load. This should also help the Home TTFB (~1.6 s today).

---

## 13. Tests I will write

### ⚠️ Your 18 named test cases are not recoverable

That part of your message was lost in compaction along with the tier table. **Paste the 18 and I will write exactly those.** Below is what I would write otherwise — it is my list, not yours:

1. A member with zero activity scores 0
2. 1 post = 10 raw → 85 daily score
3. 3 posts = 30 raw (tier 1 boundary)
4. 4 posts = 35 raw (tier crossing)
5. 10 posts = 53 raw (cap reached)
6. 40 posts = 53 raw (cap holds — the anti-dump case)
7. 5 comments = 20 raw
8. 30 comments = 55 raw (cap reached)
9. 100 comments = 55 raw (cap holds)
10. A perfect day with engagement = exactly 1000
11. A perfect day without engagement = exactly 800
12. Engagement of 45 minutes counts as 30
13. Post-and-delete the same day = 0 points
14. Post, settle, then delete next week → points unchanged (**the monotonic guarantee**)
15. Running the settle twice for the same day changes nothing (idempotent)
16. A private post earns nothing
17. Comments written count; comments received do not
18. An admin appears with a badge but never in the top 3
19. A suspended account has no badge and no rank
20. A member's score is unaffected by another member's activity (**proves no relative normalization leaked in**)
21. An ad comment earns nothing
22. A post at 11:45 pm IST settles to that day, not the next
23. A member cannot INSERT into `contributor_daily_points` via the API
24. Rolling 30-day rank falls when old activity ages out, while the lifetime badge does not

---

## 14. What I need from you before writing a line of code

1. **Tier numbers** (§3) — accept mine, or paste yours.
2. **The 18 test cases** (§13) — paste them, or accept my 24.
3. **IST or UTC days** (§7).
4. **Backfill all history, or start everyone at zero from launch day** (§8).
5. **`admin_adjustment` — keep it, or have literally nothing that can subtract** (§6).
6. **Do admins carry a badge?** (§9)

Answer these and I will build it. Nothing before that.
