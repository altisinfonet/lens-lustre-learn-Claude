# Phase 3 — Frontend. COMPLETE AND LIVE

**50mm Retina World · 2026-08-11 · STOPPED. Phase 2 not started.**

---

## Live now

```
🏆 Top Contributors                    Last 30 Days

🥇  Dipannita Sen
    ✦ 5,334
🥈  Mainak Mridha
    ✦ 3,922
🥉  Amit Baran Sen
    ✦ 3,820
```

Merged as **PR #65** → `main` is now `4cbec25`.

---

## Files changed — six, nothing else

| File | Change |
|---|---|
| `src/hooks/useTopContributors.ts` | calls `get_top_contributors_v2`; query key → `top-contributors-v2`; returns `contributor_score` + `rank_position` |
| `src/pages/Index.tsx` | score under the name; label → "Last 30 Days"; bar scaled by score |
| `src/components/sidebar/SidebarTopContributors.tsx` | same treatment for the signed-out sidebar |
| `src/i18n/home.ts` | `home.last30Days` added to all 7 locales |
| `src/__tests__/topContributorsV2.test.ts` | **new** — 14 guard assertions |
| `src/components/admin/AdminCommentReports.tsx` | **typecheck fix you approved** — see below |

`git diff a57bb82..main` = 6 files, 220 insertions, 24 deletions. No other file touched.

---

## Verification results

| Check | Result |
|---|---|
| Home page loads | ✅ |
| Top 3 comes from `get_top_contributors_v2` | ✅ **proved from the browser's own resource log** — `get_top_contributors_v2` present, `get_top_contributors_v1` absent |
| Page matches the database exactly | ✅ live RPC returns `#1 Dipannita Sen 5334 // #2 Mainak Mridha 3922 // #3 Amit Baran Sen 3820` — identical to the screen |
| Contributor Score displays correctly | ✅ under the name, small, `✦ 5,334` with thousands separator |
| Label | ✅ "Top Contributors" / "Last 30 Days" |
| Only Top 3 shown | ✅ |
| Admin absent | ✅ the `50mm Retina World` account holds 12 public posts and 4 comments and does **not** appear |
| No Active Engagement shown | ✅ no time, minutes, session or activity figure anywhere |
| No 30-day score shown | ✅ v2 never returns it |
| No console errors | ✅ none across three loads |
| No unrelated files changed | ✅ 6 files, all listed above |

---

## ⚠️ The order is not what I predicted, and that is correct

I told you to expect **Dipannita, Amit, Mainak**. It is live as **Dipannita, Mainak, Amit**.

Mainak Mridha went from **3,668 → 3,922** in the ~2.5 hours between my measurement and the deploy — he posted or commented in the meantime. Amit is unchanged at 3,820, so Mainak moved past him.

Nothing is wrong. This is the rolling 30-day window doing exactly what it is meant to do: **rankings move as members contribute.** I am flagging it because I gave you three specific names in an order that has since changed, and you should know why rather than wonder.

---

## The typecheck fix (the 10 errors you approved)

All in `src/components/admin/AdminCommentReports.tsx`, all mine from this morning's ad-comment-reports work:

| Fix | What it was |
|---|---|
| `sourceType` union widened to include `"ad_comment"` | the branch below it already assigned that value |
| `ad_comment_id` read explicitly off the row | the spread came from a row type that predates the column |
| `supabase.from(table as any)` ×4 | `ad_creative_comments` is absent from the generated `types.ts` — the same `as any` already used across `src/lib/ads/adEngagement.ts` |

**Result: CI Typecheck 13 errors → 3.** All 5 checks green before merge.

The remaining 3 pre-date all of today's work and were left alone as you instructed:
`src/hooks/notifications/useNotificationPreferences.ts` (2), `src/hooks/competition/useAdminEntryOverride.ts` (1).

**Root cause, worth fixing properly one day:** `src/integrations/supabase/types.ts` is generated and stale — it knows nothing about `ad_creative_comments`, `comment_reports.ad_comment_id`, or the new contributor functions. Every `as any` in this area exists to work around that. Regenerating it would remove the need for all of them. Separate job, not started.

---

## Pre-existing, unchanged

The test suite is **1145 pass / 2 fail**. Both failures are in `src/test/complete-round-progression-decisions.spec.ts` and I proved they pre-date this work by reproducing them with my changes stashed. Untouched.

---

## Not verified by hand

**The signed-out sidebar** (`SidebarTopContributors`, shown only to signed-out visitors) — verifying it live would mean signing out of the account in the browser. It is covered by the guard test, which asserts it renders `contributor_score` and no longer references `posts_count`, and it ships in the same bundle. Say the word if you want it eyeballed.

---

## Rollback

Change one line in `src/hooks/useTopContributors.ts`:

```
supabase.rpc('get_top_contributors_v2' as any)  →  supabase.rpc('get_top_contributors_v1')
```

and restore the three count fields. `get_top_contributors_v1` is untouched in the database — `prosrc` md5 still `6156d9a4b9d6d927b2fe73c3d194f38d`, length 711.

---

## STOPPED

Not started, and will not start without your word:

- **Phase 2 — Active Engagement.** Web + Android collector, foreground/idle detection, UTC minute buckets, `/admin/*` and `/judge/*` excluded, 30-minute cap, admin reporting. Design approved in `claude/CONTRIBUTOR_FINAL_DESIGN_2026-08-11.md`.
- **The score count-up animation.** You chose "plain number first" — it is a plain number now.
- **An Android build.** The app will not show this until one is cut. Web is live.
