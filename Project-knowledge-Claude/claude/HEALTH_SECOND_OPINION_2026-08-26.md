# Health second opinion — 2026-08-26 12:26 UTC

**Result: HEALTHY (exit 0).** No action needed on the website or the Android app.

Context numbers:
- posts with images: 257
- Supabase-hosted thumbnails sampled: 25, broken: 0
- last 36h — posts: 8, comments: 8
- GitHub API rate-limited (unauthenticated) — CI not checked by the script this run
- live site + CDN checks skipped (sandbox egress allowlist — expected, not a fault)

## One thing to fix in the scheduled task itself (not a site problem)

The scheduled-task instructions still say to download `.env` from the repo:

    curl -s .../main/.env -o /tmp/hc/.env

`.env` was deliberately removed from the repo on **2026-08-21** (staging isolation
guard; it is now in `.gitignore`). That URL returns **404**, so the script finds no
key and exits **2 — "CANNOT RUN"**. Left as-is, every future run of this scheduled
task reports that instead of a health verdict.

This run worked around it by reading the PUBLIC anon key at runtime from the value
already committed in `.github/workflows/health.yml` (never written to a file or
typed into a command literal). The permanent fix is to change the task's STEP 1 to
drop the `.env` download and use that same source, e.g.:

    SUPABASE_ANON_KEY="$(curl -s .../main/.github/workflows/health.yml \
      | sed -n 's/^ *SUPABASE_ANON_KEY: *//p')" node /tmp/hc/scripts/health-check.mjs

The GitHub Actions "Health" workflow (every 2 hours, the primary alarm) is
**unaffected** — it supplies the key via its own `env:` block and was updated when
`.env` was removed.
