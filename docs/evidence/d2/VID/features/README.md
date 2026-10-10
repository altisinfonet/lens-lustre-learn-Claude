# VID-7 / R-103 · Admin → Features page (D2) · 2026-10-10

Unit: the admin screen for the three feature switches. Words on screen: **Off / Selected members / All members**.

- `/admin/features` (sidebar: Marketing & SEO → Features), admin only (`adminRoleAccess`: not in any sub-role list; moderator, finance, content_editor, judge are refused — tested).
- One card per feature (`video_posts`, `video_ads`, `copyright_music_check`) from `feature_admin_state()`: mode, note (≤ 500), Save, selected members as chips with ✕ (`feature_remove_member`), search by name / @username / email (`feature_member_search`, ≥ 2 chars, on Enter — no timer) with Add (`feature_add_member`), history of the last 50 changes with actor names.
- Save writes mode + note in one `feature_set_mode`; enabled only when something changed.
- Copyright check: the Selected / All options are disabled while `key_configured` is not true, and the server's FEATURE-003 is shown in words if it is attempted anyway. The server stays the enforcement.
- The member list is kept when the mode changes (said on screen).

## Evidence (2026-10-10 UTC)
- 35 new tests (featureSwitches 24, AdminFeatures 11); full vitest 3129 passed / 0 failed; `tsc -b` 0; staging-lane build + P13 budget 257 checks, 0 failures (entry 1674023 / 1700864, AdminFeatures is a lazy chunk).
- `mutants.txt`: 15/15 mutants killed.
- Not proven here: the live RPCs on staging (this PR reads them as merged in #380); a click-through on staging waits for the PR to deploy. ui:gate runs in CI.
