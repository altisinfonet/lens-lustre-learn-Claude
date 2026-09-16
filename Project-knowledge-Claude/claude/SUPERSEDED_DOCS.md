# SUPERSEDED / STALE DOCS — read this before trusting an older file

Written 2026-08-06. Project docs are never deleted (they hold history worth
keeping), but several no longer describe reality. **If a doc is listed here,
check this page before acting on anything in it.**

---

## 🔴 ACTIVELY WRONG — do not act on these without re-checking

### `PROFILE_PHOTO_GATE_IMPACT.md`
Says **"39% of members cannot post or comment"** because two RESTRICTIVE
policies required an uploaded profile photo.
**THAT GATE WAS REMOVED ON 2026-08-05 and verified gone on production.**
Acting on this doc would mean "fixing" something that no longer exists, or
worse, putting the wall back.

The rules now, and they are SEPARATE:
- A post **REQUIRES a photograph**; the caption is optional.
- A missing profile photo (DP) **NEVER** blocks posting, commenting or reacting.

Keep the doc for the measurement history (32 of 83 members were blocked; 4 had
been posting before the rule landed). Ignore its "current state" framing.

---

## ⚠️ SUPERSEDED — accurate for their date, not for now

| Doc | Why it is stale | Read instead |
|---|---|---|
| `BUILD_1052_STATUS.md` | 1052 was superseded by **1053** (cut 2026-08-06, run #53). Its "still open" list is resolved: stories, mentions and the admin columns all shipped in 1053. | `BUILD_1053_PROGRESS.md`, `NEXT_RELEASE_RUNBOOK.md` |
| `OPEN_WORK_2026-08-05_EVENING.md` | Its open items were completed during the night of 2026-08-05→06. | `HANDOFF_2026-08-06.md` |
| `OPEN_REQUESTS_2026-08-05.md` | Same — the requests it tracks (stories ×4, admin columns, redirect, mentions) all shipped. | `HANDOFF_2026-08-06.md` |
| `SESSION_2026-08-05_STATE.md` | A point-in-time snapshot, now two builds behind. | `START_HERE.md` §0 |
| `LIVE_BUGS_2026-08-05.md` | Several entries fixed (images, stories delete, admin columns). Verify each against `BUILD_1053_PROGRESS.md` before treating one as open. | `BUILD_1053_PROGRESS.md` |
| `IMAGES_NOT_COMING_ROOT_CAUSE.md` | The cause it names was fixed in 1052 (the resizer that answered only one origin was removed; photos load direct). Kept because the investigation method is worth reusing. | — |

---

## ✅ STILL CURRENT — trust these

`HANDOFF_2026-08-06.md` (start here) · `START_HERE.md` ·
`WORKING_RULES.md` · `LOGGING_STANDARD.md` · `NEXT_RELEASE_RUNBOOK.md` ·
`BUILD_1053_PROGRESS.md` · `PROJECT_MASTER_RECORD.md` ·
`RULE_NEVER_BREAK_WHAT_WORKS.md` · `POST_RULE_PHOTO_REQUIRED.md` ·
`DEPLOY_CACHE_GOTCHA.md` · `BLANK_PAGE_ROOT_CAUSE.md` (🔴 fix still incomplete) ·
`CLIENT_ERROR_TRACKING.md` · `NOTIFICATIONS_SYSTEM.md` · `TODAYS_BIRTHDAY.md` ·
`PROFILE_PHOTO_POLICY.md` · `ANDROID_NOTIFICATION_ICON.md` ·
`TEXT_ENCODING_CORRUPTION.md`

---

## A note on the numbers that appear in old docs

Several docs quote platform figures measured on their date. The ones that have
moved:

| Figure | Old value (date) | Current (2026-08-06) |
|---|---|---|
| Members | 74 (07-31) → 83 (08-05) | **84** |
| Posts | 103 (07-31) → 150 (08-05) | 151 |
| Test baseline | 21 failed / ~594 passed | **25 failed / 730 passed / 1 skipped** |
| `__APP_BUILD` | `2026-08-04-7` | **`2026-08-06-1`** |
| Live Android build | 1047 → 1050 → 1052 | **1053 built, awaiting upload** |

**Re-measure before quoting any figure to the owner.** He notices.
