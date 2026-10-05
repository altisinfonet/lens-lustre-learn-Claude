# F-AUD-1 — the P15 push job waits until the served build = the pushed commit

**Finding (Auditor, MASTER R-94, 14:00 UTC):** "the P15 push job races the Pages deploy (D2: wait until the served build = the
pushed commit, then measure)." Main's push-run #12 (run 37206638044) failed at deploy time and went green on re-run.

## Cause
`d2-compression.yml` measured `https://www.50mmretina.com` (or staging) the moment the push landed. Pages was still building
that push, so the job read the previous build or a half-switched one. Nothing on the served page said which commit it was,
so the job could not tell.

## Change
- `scripts/web-build-commit.mjs` + `vite.config.ts`: every **build** stamps
  `<meta name="build-commit" content="<sha>">` into `index.html` (source: `CF_PAGES_COMMIT_SHA` › `GITHUB_SHA` ›
  `git rev-parse HEAD` › `"unknown"` — never fails a build). Build only: the dev server and UI-gate harness are untouched.
- `scripts/web-wait-for-deploy.mjs`: polls the origin's stamp every 20 s; proceeds when it names the pushed commit, or a newer
  one that contains it (`git merge-base --is-ancestor`, checkout `fetch-depth: 0`); after 20 min it **fails** and names what
  was served. It never measures an unidentified build.
- `.github/workflows/d2-compression.yml`: on `push`, waiter self-test → wait → measure (job timeout 15 → 30 min).
  `workflow_dispatch` still measures whatever is live, by design.

## Proofs
| instrument | reading | UTC |
|---|---|---|
| staging-lane `npm run build` with `GITHUB_SHA` = this branch's base | `dist/index.html` carries `<meta name="build-commit" content="cb188b05e3c97a5db271f1929355f0d3fddf24a3" />`; `verify-html-tokens` OK | 2026-10-04 15:35 |
| that `dist/` served locally; waiter with the same sha | `served build = pushed commit`, exit 0 | 15:35:41 |
| same server; waiter with a different sha (main `2e5a2b7`) | `served build is cb188b05e3c9, not 2e5a2b7 yet` → after the timeout exit 1, "Not measuring the wrong build" | 15:35:41 |
| live staging today (built before this change, no stamp), 5 s timeout | `no build-commit stamp served yet` → exit 1 — the waiter refuses rather than guesses | 15:34:45 |
| `src/__tests__/buildCommitStamp.test.ts` (7) | source order; stamp once before `</head>`, re-stamp replaces; no stamp → null; plugin registered; waiter decisions; the workflow waits **before** measuring | ~15:34 |
| mutant: waiter accepts any served stamp | 2 red | ~15:34 |

## Note for the first run after merge
The first push after this lands is the first build that carries a stamp, so the waiter matches it as soon as Pages finishes.
