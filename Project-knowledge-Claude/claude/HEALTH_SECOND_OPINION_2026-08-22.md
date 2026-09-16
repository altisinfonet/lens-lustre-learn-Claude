# Health second opinion — 2026-08-22

## Verdict: HEALTHY

All checks pass. Nothing for the owner to do about the live site.

| Check | Result |
|---|---|
| Posts with images (last 1000, avatar posts excluded) | 235 |
| Thumbnails misaligned with images | 0 |
| Posts missing thumbnails | 0 (recent-3-day: 0) |
| Supabase-hosted thumbnails sampled | 25, broken 0 |
| Thumbnail hosting split | 194 CDN / 41 Supabase |
| Activity, last 36h | 13 posts, 19 comments |
| GitHub Actions, latest run of each workflow | all green (Android Build, Security, Typecheck, UI gate, Web build, Schema dump) |
| Health workflow (2-hourly, DEEP=1, live site + CDN) | green — latest run #148, 17–28s |

The CI Health workflow is the authoritative watchdog and it is green, which
means the live site and the CDN photos are being reached and are fine. Live
checks stayed skipped in the sandbox as designed (egress allowlist, not an
outage).

## One real finding — the Cowork second-opinion run can no longer configure itself

The scheduled Cowork task's setup step does:

    curl .../main/.env -o /tmp/hc/.env

`.env` was removed from the repo on 2026-08-21 by
`web: environment isolation — remove committed .env, add bundle-isolation guard`
and is now in `.gitignore`. That curl returns the 14-byte string
`404: Not Found`, so `health-check.mjs` finds no key and exits 2 with
`CANNOT RUN — no Supabase key available`. It never reaches a single check.

This is **not** a production problem:

- `.github/workflows/health.yml` was updated in the same commit and supplies
  `SUPABASE_ANON_KEY` explicitly, so the 2-hourly CI watchdog is unaffected.
- Only the slower Cowork second opinion is broken, and only in its setup step.

### Fix

Update the scheduled task's STEP 1 to source the public anon key from
`.github/workflows/health.yml` (where the isolation commit put it) instead of
from `.env`, and export it as `SUPABASE_ANON_KEY` before running the script —
the script already prefers the environment variable over the file.

For this run the checks were reproduced independently instead: checks 1–3 via
direct SQL against the production project, check 2's image loads by fetching
the sampled thumbnail URLs, and check 4 by reading the Actions run list.

## Verification notes

- `api.github.com` is blocked for this session (session-bound repo access), so
  CI status was read from the Actions web UI rather than the API. This matches
  the script's own behaviour, which downgrades an unreachable GitHub API to a
  note rather than a problem.
- No code was changed, nothing was pushed, no build was cut.
