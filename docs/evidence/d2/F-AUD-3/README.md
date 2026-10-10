# F-AUD-3 · health check: 36 h without posts/comments is a WARNING (R-82)

Rule (Owner R-82, BOARD "Owner decisions in force"): live traffic readings are monitors only and never block a close.
Finding F-AUD-3: the scheduled "Is the live site healthy?" run (health.yml → scripts/health-check.mjs)
failed main when there were no posts or comments for 36 h.

Change: `checkActivity` calls `warn` instead of `fail`. Warnings print under WARNINGS, add a
`::warning` annotation, and never change the exit code. Every other rule still fails.
health.yml (Auditor's file) is not touched.

Fail-first (2026-10-10 UTC, node scripts/web-health-activity.test.mjs, the real script + fixture fetch):
- `before.txt` — staging 4a5c78a script: 5 assertions FAIL (quiet 36 h → exit 1, "PROBLEMS FOUND").
  Controls PASS on the old script too (busy day healthy; query error and misaligned thumbnails fail),
  which proves the fixture backend is sound.
- `after.txt` — 9/9 PASS.
CI: `.github/workflows/d2-health-activity.yml` runs the self-test on every PR touching these files.
