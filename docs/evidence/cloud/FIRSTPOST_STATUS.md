# [status] first-post + platform runner

Updated 2026-10-30 ~02:40 UTC. Base: `staging`.

## Unit A — "Admin → Users: members show neither App nor Website"
- Step: MEASURE done on staging + production (first PROBE); second PROBE on production pending (#629).
- **Measured on production** (run 40994307608, 2026-10-30 02:54 UTC, counts only): 139 members; 39 show
  no chip; 36 of those 39 were last seen before 2026-09-20; of 25 members active in the last 7 days, 1 shows no chip.
- **Cause (proven on the fixture with the real server code, red before the fix):** the platform has one writer,
  `record_session_end` (supabase/migrations/20260920_0001…sql §2), which runs only when a session ENDS:
  1. nothing records the platform while a member is using the app or site (so the chip cannot appear "within 1 minute");
  2. `profiles.last_active_at` is `DEFAULT now()` (20260330142754…sql:3), so a brand-new member's first session that
     ends within 60 s of sign-up is skipped by the 60-second rule, and `backfill_last_seen` moves only the time;
  3. a member who switches from the website to the app keeps "Website" until the app session ends.
  Old blank rows: no real platform record exists for them (0 error rows, 1 push token among 39) → "Unknown", never a guess.
- Ruled out by measurement: "the call is lost when a tab is closed" (Chromium delivered it 5/5).
- PRs: #621 → staging `748964b` · #624 → main `3f2deea` · #627 → staging `0e4c6f0` · #629 → main (CI running)
- SQL runs (all read-only PROBEs, PASS):
  - staging PROBE_0100 · run 40992860687 · 2026-10-30 02:40 UTC
  - production PROBE_0100 · run 40994307608 · 2026-10-30 02:54 UTC
  - staging PROBE_0101 · run 40996083401 · 2026-10-30 03:14 UTC
  - production PROBE_switch_states_readonly · run 40991090922 · PASS (`personal_feed` = everyone)
- Fix (built, fixture green, not yet pushed): record the platform when a session starts / returns to the foreground
  (writes only when it changes); grey "Unknown" chip for members with no record.

## Unit B — "First post after registration" (switch `first_post_nudge`, OFF on live)
- Step: IMPLEMENT (local, not yet pushed — Unit A goes first).
- Built and passing locally: the "Share your first photo" step; category pre-fill; reminders at
  1/3/7 days (bell + push + e-mail, stop after the first post, opt-outs respected); Admin → Health
  "New members who posted within 7 days". DB fixture passes in both lane shapes.
- No edge function needed: reminders reuse the existing push sender and e-mail queue.
- PR: — · SQL runs: — · live check: —

## Owner list (plain words)
1. Nothing needed from you yet.
