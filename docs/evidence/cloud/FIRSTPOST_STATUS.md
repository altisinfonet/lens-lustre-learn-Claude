FIRST-POST + PLATFORM COMPLETE

# [status] first-post + platform runner

Updated 2026-10-30 05:30 UTC. Both units are live on production. The first-post switch is **OFF** on production and ON on staging for tests.

## Unit A — "Admin → Users: members show neither App nor Website" — DONE (live, SQL applied, live check PASS)
**Proven cause.** It was measured on production first, then reproduced against the real server code. Each cause fails its test on its own before the fix (`supabase/tests/platform-badge/30_cause.sql`).
1. The App/Website value had exactly one writer, `record_session_end` (`supabase/migrations/20260920_0001_p1_session_end_and_backfill.sql` §2). It runs only when a session ENDS, so nothing recorded the platform while a member was using the app or site.
2. `profiles.last_active_at` is `DEFAULT now()` (`supabase/migrations/20260330142754_…sql:3`). If a new member's first session ended within 60 s of sign-up, the 60-second rule skipped it, and `backfill_last_seen` moves only the time, never the platform.
3. A member who switched from the website to the app kept "Website" until the app session ended.

**Where the 39 blank chips came from** (production run 40997658613):

| Group | Members |
|---|---|
| Last seen before App/Website was recorded at all | 21 |
| Never active after sign-up (last 40 days) | 17 |
| Active only in the first 10 minutes after sign-up | 1 |

There is no real record to fill these old rows from. The only trace is 1 push token, and that is not a sign-in record. They now show a grey "Unknown" chip; nothing is guessed.

**Ruled out:** "the call is lost when the tab closes". Chromium delivered it 5 out of 5 times.

**Fix:** `record_session_platform` writes the platform when a session starts or returns to the foreground, and only when it has changed. Members with no recorded platform show a grey "Unknown".

| step | PR | merged sha | SQL runs (UTC, 2026-10-30) |
|---|---|---|---|
| diagnosis PROBE 0100 | #621 staging · #624 main | 748964b · 3f2deea | staging 40992860687 PASS 02:40 · production 40994307608 PASS 02:54 |
| diagnosis PROBE 0101 | #627 staging · #629 main | 0e4c6f0 · 38471cb | staging 40996083401 PASS 03:14 · production 40997658613 PASS 03:31 |
| fix 0102 + client + "Unknown" | #630 staging · #631 main | 2279a13 · 38dea28 | staging: PROBE FAIL 41000278671 03:59 → apply 41000357693 03:59 → PROBE PASS 41000398439 04:00 · production: PROBE FAIL 41001845163 04:15 → apply 41001914536 04:16 → PROBE PASS 41001960552 04:16 |

**Gate, production (run 41008580806, 05:28)**
- Members active in the last 24 h with no App/Website: **0 of 18**.
- Members active in the last 7 days with no App/Website: 1 of 25. That member has not opened the site or app since the fix; their chip fills on their next visit (website now, app after the next app build).

**Live check: PASS** (job in run 41003553819, 04:36)
- The live bundle carries the fix.
- Home and /feed return 200 in Chromium, Firefox and WebKit, with the same text on two loads.
- The console shows only errors that were already there:
  - X-Frame-Options set in a meta tag
  - the Cloudflare beacon blocked by CSP
  - a signed-out 401 on profiles_public_data
  - a Firefox cookie notice

**On-device check on staging (web and Android chip within a minute):** not done by me. Staging sign-up needs e-mail confirmation and this runner has no mailbox or test login. The fixture proves this step (W and X), and the production numbers above show it working. Owner item 3.

**Needs the next Android app build:** yes, for the app-side "session start" call.

## Unit B — "First post after registration" — DONE (live, switch OFF; staging ON for tests)
**What it does**
1. **"Share your first photo" step** after the welcome form:
   - one big "Choose a photo" button that opens the normal post flow, with the category pre-filled from the member's first interest;
   - a small "Later" link.
2. **A promise checked against the live feed SQL:** "Every member's feed keeps a share of its places for photographers they haven't seen much of yet. A first photo has no views yet, so it is among the first in that line. It is also suggested to members who picked <interest>."
   - On production, `personal_feed` = everyone and the mix is 2/5/3, so the promise holds.
3. **Reminders at days 1, 3 and 7:**
   - delivered as bell + push + e-mail;
   - one tap opens the post flow;
   - stopped forever by the first post;
   - push opt-out, "We Miss You Emails" opt-out and suppressed addresses are all respected;
   - suspended members and late reminders are never sent;
   - they reuse the existing push sender and e-mail queue, so **no edge-function deploy was needed**.
7. **Admin → Health:** a new "New members who posted within 7 days" panel, by sign-up week, for the last 8 weeks.

**Merged**

| PR | merged sha |
|---|---|
| #632 (staging) | f0cad78 |
| #633 (main) | 2f4f5b2 |

**SQL runs (UTC, 2026-10-30)**

| Run | Lane | Steps |
|---|---|---|
| 0200 | staging | PROBE FAIL 41006142223 05:02 → apply 41006224072 05:03 → PROBE PASS 41006272343 05:03 |
| switch ON (tests only) | staging | PROBE FAIL 41006325952 → on 41006374289 → PROBE PASS 41006420935 05:05 |
| 0200 | production | PROBE FAIL 41008011999 05:22 → apply 41008142160 05:23 → PROBE PASS 41008188979 05:23 |
| switch | production | PROBE confirms **OFF**: 41008237132 05:24 |

**Gate evidence**
- **Fixture CI job**, run on both lane shapes. Each check below is a named case in that job:
  - switch off means nothing happens;
  - reminders queue at +1, +3 and +7 days;
  - a due reminder sends bell + push + e-mail with the post link;
  - the first post cancels the rest;
  - opt-outs are respected;
  - late and suspended members are never sent anything;
  - one failure is isolated from the rest;
  - the Health number is 50.0 % on a known week;
  - only admins can see it.
- **Vitest:**
  - the step shows;
  - "Later" closes it;
  - on the web, posting takes 2 taps after choosing a photo (Next, Post);
  - in the app, it takes 1 tap (Share);
  - with the switch off, the step is never offered.

**Live check: PASS** (run 41008319490, 05:27)
- Home and /feed return 200 in Chromium, Firefox and WebKit, with the same text.
- The console-error set is identical to the run before Unit B went live.

**Needs the next Android app build:** yes, for the in-app step and the category pre-fill.

## Owner list (plain words)
1. **App/Website chip.** It is fixed on the website now. Android members get it with the next app build; another runner makes the build.
2. **"Unknown" chip.** It means we never recorded App or Website for that member: they were last active before we recorded it, or they never came back after signing up. It changes on their next visit.
3. **Check it yourself.** On staging (staging.50mmretina.com), sign in with a test account on the website and on the Android test app. Then look at Admin → Users: the right chip should appear within about a minute.
4. **First-post helper.**
   - It is built and switched **OFF** on the live site, and ON on staging so you can try it. On staging, sign up a new test account and finish the welcome form; you should see "Share your first photo".
   - To switch it **ON** on the live site:
     1. Go to GitHub → Actions → "Apply a database migration" → Run workflow.
     2. Choose branch `main` and target `production`.
     3. Type `supabase/migrations/UNAPPLIED_20261102_0201_first_post_nudge_switch_on.sql` in both boxes.
   - To switch it **OFF** again, do the same with `supabase/rollback/20261102_0201_first_post_nudge_switch_on_ROLLBACK.sql`.
5. **Health panel.** Admin → Health now shows "New members who posted within 7 days" for each sign-up week. Watch it before and after you switch the helper on.
6. **Possible double e-mail.** A new member who is also inactive could get both a "We Miss You" e-mail and a first-post reminder on days 3 and 7. One switch in their notification settings stops both.
7. **For the Auditor.** The frozen file `docs/gates/P1-interface.md` says only the "session end" call writes App/Website. The fix adds a second writer, as you asked. The Auditor should record it.
