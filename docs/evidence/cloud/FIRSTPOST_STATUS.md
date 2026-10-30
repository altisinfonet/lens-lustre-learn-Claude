# [status] first-post + platform runner

Updated 2026-10-30 ~04:30 UTC. Base: `staging`.

## Unit A — "Admin → Users: members show neither App nor Website" — DONE: live on production (code + SQL), live check PASS
**Proven cause** (measured on production, then reproduced against the real server code; each cause red before the fix):
1. The platform had one writer, `record_session_end` (`supabase/migrations/20260920_0001_p1_session_end_and_backfill.sql` §2),
   which runs only when a session ENDS — nothing recorded it while a member was using the app or site.
2. `profiles.last_active_at` is `DEFAULT now()` (`20260330142754…sql:3`): a new member's first session ending within 60 s of
   sign-up was skipped by the 60-second rule, and `backfill_last_seen` moves only the time.
3. Switching website → app kept "Website" until the app session ended.
Production split of the 39 blank chips (run 40997658613): 21 last seen before platform recording existed; 17 never active
after sign-up in 40 days; 1 active only in the first 10 minutes after sign-up. Only real record for any blank row: 1 push token
(not a sign-in record) → nothing backfilled; they now show a grey "Unknown".

| step | PR | sha | SQL runs (UTC 2026-10-30) |
|---|---|---|---|
| diagnosis PROBE 0100 | #621 → staging / #624 → main | 748964b / 3f2deea | staging 40992860687 PASS 02:40 · production 40994307608 PASS 02:54 |
| diagnosis PROBE 0101 | #627 → staging / #629 → main | 0e4c6f0 / 38471cb | staging 40996083401 PASS 03:14 · production 40997658613 PASS 03:31 |
| fix 0102 + client | #630 → staging / #631 → main | 2279a13 / 38dea28 | staging: PROBE FAIL 41000278671 03:59 → apply 41000357693 03:59 → PROBE PASS 41000398439 04:00 · production: PROBE FAIL 41001845163 04:15 → apply 41001914536 04:16 → PROBE PASS 41001960552 04:16 |

- Gate numbers (production, 04:16): members active in the last 24 h with no platform = **0 of 18**; last 7 days = 1 of 25
  (that member has not been back since the fix; fills on their next visit — web now, app after the next app build).
- **Live check PASS** (04:17 Chromium local; 04:36 Chromium + Firefox + WebKit, job 123893217752 in run 41003553819): live
  bundle carries the fix; home + /feed 200 in all three; same text on two loads; console errors are only pre-existing kinds
  (X-Frame-Options in a meta tag, Cloudflare beacon blocked by CSP, signed-out 401 on profiles_public_data, Firefox cookie
  notice on the realtime socket) — none from this change.
- Needs the next Android app build: yes (the app-side "session start" call).

## Unit B — "First post after registration" (switch `first_post_nudge`: OFF on production, ON on staging for tests)
- Built: (1) "Share your first photo" step after the welcome form (one Choose-a-photo button into the normal post flow,
  category pre-filled; "Later"); (2) a promise checked against the live feed SQL; (3) reminders at 1/3/7 days — bell + push +
  e-mail, stopped forever by the first post, opt-outs respected, existing push sender + e-mail queue reused (no edge-function
  deploy needed); (7) Admin → Health "New members who posted within 7 days" (8 weeks).
- PR #632 → staging `f0cad78` (CI 35 green / 2 skipped; independent review: nothing blocking) · carry #633 → main (CI running)
- SQL runs (UTC 2026-10-30):
  - staging 0200: PROBE FAIL 41006142223 05:02 → apply 41006224072 05:03 → PROBE PASS 41006272343 05:03
  - staging switch ON (tests): PROBE FAIL 41006325952 → switch-on 41006374289 → PROBE PASS 41006420935 (05:05)
  - production: after #633 lands — 0200 only; the switch stays OFF
- Gate evidence (fixture, both lane shapes, CI job "first-post reminders + Health number on lane-shaped databases"): switch off =
  nothing; queued at +1/+3/+7 d; due → bell + push + e-mail with the post link; first post cancels the rest; opt-outs; late /
  suspended never sent; Health 50.0 % on a known week; admin only. Step: vitest render tests (Later, web hand-off with
  category = 2 taps after choosing a photo: Next, Post; app = 1: Share).
- Needs the next Android app build: yes (the in-app step + category pre-fill).

## Owner list (plain words)
1. Unit A works on the website now. Members using the Android app get the fix with the **next app build** (another runner does the version bump).
2. Members shown "Unknown" were last active before we recorded App/Website, or never came back after signing up. Their chip changes the next time they open the app or site.
3. To see it yourself: open Admin → Users after a member uses the site — the chip appears within about a minute.
4. The "first post" helper is built and switched OFF on the live site. To switch it ON yourself: GitHub → Actions → "Apply a database migration" → Run workflow on `main`, target `production`, and type this path in both boxes: `supabase/migrations/UNAPPLIED_20261102_0201_first_post_nudge_switch_on.sql`. To switch OFF again, the same with `supabase/rollback/20261102_0201_first_post_nudge_switch_on_ROLLBACK.sql`. (Only after the carry is merged — this file will say when.)
5. Try it first on staging, where it is already ON: sign up a new test account on staging.50mmretina.com and finish the welcome form — you should see "Share your first photo".
6. The Auditor's frozen file `docs/gates/P1-interface.md` says only the "session end" call writes App/Website; this fix adds a second writer, as you asked. The Auditor should note it.
