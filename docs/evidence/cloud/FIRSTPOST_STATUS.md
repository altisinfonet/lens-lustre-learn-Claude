# [status] first-post + platform runner

Updated 2026-10-30 ~04:30 UTC. Base: `staging`.

## Unit A — "Admin → Users: members show neither App nor Website" — LIVE on production (code + SQL)
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
- Live check 04:17–04:25: live bundle carries the fix; Chromium home + /feed 200, same text on two loads; console errors
  are the pre-existing ones (X-Frame-Options meta, Cloudflare beacon CSP, signed-out 401 on profiles_public_data) — none
  from this change. **Firefox + WebKit: pending** — the sandbox has Chromium only; a report-only 3-engine live-check job is in
  Unit B's PR and runs there.
- Needs the next Android app build: yes (the app-side "session start" call).

## Unit B — "First post after registration" (switch `first_post_nudge`, OFF everywhere)
- PR #632 → staging (CI running; independent review: nothing blocking, follow-ups pushed and under re-review).
- Reminders reuse the existing push sender and e-mail queue — **no edge-function deploy needed**.
- Needs the next Android app build: yes (the in-app step and category pre-fill).

## Owner list (plain words)
1. Unit A works on the website now. Members using the Android app get the fix with the **next app build** (another runner does the version bump).
2. Members shown "Unknown" were last active before we recorded App/Website, or never came back after signing up. Their chip changes the next time they open the app or site.
3. To see it yourself: open Admin → Users after a member uses the site — the chip appears within about a minute.
4. The Auditor's frozen file `docs/gates/P1-interface.md` says only the "session end" call writes App/Website; this fix adds a second writer, as you asked. The Auditor should note it.
