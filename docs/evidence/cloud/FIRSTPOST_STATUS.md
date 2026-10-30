# [status] first-post + platform runner

Updated 2026-10-30 ~02:40 UTC. Base: `staging`.

## Unit A — "Admin → Users: members show neither App nor Website"
- Step: INSPECT / MEASURE. **Cause not yet proven — nothing has been changed.**
- Ruled out by measurement: "the session-end call is lost when a tab is closed" — a real
  Chromium tab close delivered the call 5 out of 5 times (local Playwright, same supabase-js 2.97.0).
- Diagnosis PROBE (read-only, counts only): PR #621 merged to staging as `748964b`.
  Carry to main: PR #624 (needed to measure production).
- SQL runs:
  - staging · PROBE_20261102_0100 · run 40992860687 · queued
  - production · PROBE_switch_states_readonly (existing) · run 40991090922 · PASS 2026-10-30 02:2x UTC
    → `personal_feed` = everyone (used for Unit B's promise)
- PR: — · merged shas: 748964b (probe only) · live check: —

## Unit B — "First post after registration" (switch `first_post_nudge`, OFF on live)
- Step: IMPLEMENT (local, not yet pushed — Unit A goes first).
- Built and passing locally: the "Share your first photo" step; category pre-fill; reminders at
  1/3/7 days (bell + push + e-mail, stop after the first post, opt-outs respected); Admin → Health
  "New members who posted within 7 days". DB fixture passes in both lane shapes.
- No edge function needed: reminders reuse the existing push sender and e-mail queue.
- PR: — · SQL runs: — · live check: —

## Owner list (plain words)
1. Nothing needed from you yet.
