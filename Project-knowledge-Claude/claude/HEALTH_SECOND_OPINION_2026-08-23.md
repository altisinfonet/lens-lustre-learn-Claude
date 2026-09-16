# Health second opinion — 2026-08-23 (17:45 UTC)

## Verdict: HEALTHY

Nothing for the owner to do about the live site or the Android app.

| Check | Result |
|---|---|
| Posts with images (last 1000, avatar posts excluded) | 246 |
| Thumbnails misaligned with images | 0 |
| Posts missing thumbnails | 0 (recent-3-day: 0) |
| Supabase-hosted thumbnails fetched | 25, broken 0 (all HTTP 200, 5–62 KB) |
| Thumbnail hosting split | 205 CDN / 41 Supabase |
| Activity, last 36h | 9 posts, 11 comments |
| Newest post | 2026-08-23 16:01 UTC (1h44m before the run) |
| Avatar-only posts correctly excluded | 28 |
| Live site + CDN (DEEP) | skipped — sandbox egress allowlist, by design, not an outage |
| GitHub Actions status | **not verifiable this run** — see below |

Every image check that can be made from here passed, so the 2026-08-07 failure
shape (guessed thumbnail addresses, images failing in bulk) is not present. No
reason to look at search either — per the recurring-failure note, image failures
and the search freeze are one fault, and there are no image failures.

## The Cowork setup step is still broken — second consecutive day

Unchanged since `HEALTH_SECOND_OPINION_2026-08-22.md`. The scheduled task's
STEP 1 still does:

    curl .../main/.env -o /tmp/hc/.env

`.env` was removed from the repo on 2026-08-21 (environment-isolation commit)
and is in `.gitignore`. The curl returns the 14-byte body `404: Not Found`, so
`health-check.mjs` finds no key and exits 2 with `CANNOT RUN — no Supabase key
available`, reaching zero checks.

**Not a production problem.** `.github/workflows/health.yml` was fixed in the
same commit — verified again today, line 60 supplies `SUPABASE_ANON_KEY` at
step level — so the authoritative 2-hourly CI watchdog runs its full DEEP check
unaffected.

### Fix (unchanged from yesterday)

Change the scheduled task's STEP 1 to export the public anon key from
`.github/workflows/health.yml` as `SUPABASE_ANON_KEY` and drop the `.env` curl.
The script already prefers the environment variable over the file.

## How this run was verified instead

The instruction to verify independently was satisfied by reimplementing the
script's checks rather than running it:

- Checks 1 and 3 — direct SQL against production project `jtdtehuqtinjxropkkcn`
  (Supabase MCP), replicating the avatar-post exclusion (`image_urls` all under
  `/avatars/`), the misalignment test, and the 3-day recent-missing window.
- Check 2 — the 25 newest Supabase-hosted first-thumbnails fetched over HTTP
  from the sandbox; all returned 200 with non-empty bodies.
- Check 4 — **could not be run.** `api.github.com` and `github.com` are both
  403 for this session (session-bound repo access, not an outage), and the
  Actions web UI needed an approval no one was present to give. The script
  itself downgrades an unreachable GitHub API to a note rather than a problem,
  so this does not change the verdict — but unlike yesterday, CI green was not
  independently confirmed today. If the CI Health workflow had gone red, its own
  email would have reached the owner directly.

## Constraints honoured

No code changed, nothing pushed, no build cut, and the anon key was never
written into a file or a command in this session.
