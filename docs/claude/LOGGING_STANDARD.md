# Enterprise logging standard — how it works here

Owner directive, 2026-08-06: production-grade structured logging with error
codes, an error catalog, timing, redaction, and no `console.log` anywhere.
This document is the map. **The rollout he chose: foundation first, then the
risky paths** (not a big-bang conversion of all 46 files).

## The six pieces

| Piece | Where | What it is |
|---|---|---|
| The logger | `src/lib/logger.ts` | Levels TRACE→FATAL, JSON output, ambient member id, timing (`timed()`), redaction, correlation ids |
| The catalog | `src/lib/errorCodes.ts` | **Single source of truth** for every code — **27 codes** (22 + the 5 tracer codes added 2026-08-06; counted with `grep -c '^  {$'`, and `docs/error-codes.md` renders exactly 27 rows) |
| The document | `docs/error-codes.md` | **GENERATED** from the catalog — never hand-edit |
| The generator | `scripts/generate-error-codes.ts` | `npx tsx scripts/generate-error-codes.ts` |
| The sink | `client_errors` table + `log_app_event()` | Live on production since 2026-08-06 |
| **The screen** | `src/components/admin/AdminAppEvents.tsx` | **Admin → Overview → Error Log** (`/admin/app_events`) — LIVE |

## The three rules the code enforces

1. **The logger never becomes the incident.** Every path is wrapped; a logging
   failure cannot throw into the caller, block it, or reach a member. Proven by
   tests that make the database call throw and reject.
2. **This runs on members' phones, not in a data centre.** ERROR/FATAL/WARN are
   persisted; INFO/DEBUG/TRACE are console-only (and DEBUG/TRACE only outside
   production). Persisting every entry/exit line from 84 members over mobile
   data would cost their data, the app's speed and the free-tier quota, and
   would bury the failures under a million successes.
3. **Nothing sensitive leaves the device.** `redact()` drops secret-named keys
   (password, token, jwt, key, secret, otp, auth, cookie, session) and masks
   e-mails in free text. A member id is kept — it is the point of the log.

## Reading the logs — the screen

**Admin → Overview → Error Log.** Three sections, in the order a real
investigation needs them:

1. **What is failing** — codes by frequency, with how many members each hit.
   Click a card to filter.
2. **Events** — every field: code, severity, message, why, expected vs actual,
   the recommended next step (falling back to the catalog's resolution),
   function · file, member, build, platform, duration.
3. **One member action** — click a correlation id to see every log line of that
   single action in order (started → uploaded photo 1 → insert refused …).

Filters: window (1h → 30d), code (populated from the catalog, so it can never
go stale), severity. Reads only through `get_app_event_counts_admin()` and
`get_app_events_admin()` — both admin-only; the table itself has RLS with no
policies, so there is no other way in.

SQL fallback, if ever needed:

```sql
select created_at, code, event, severity, fn, reason, expected, actual, next_step
  from public.client_errors where code is not null
 order by created_at desc limit 100;

select created_at, code, event, reason from public.client_errors
 where correlation_id = '<id>' order by created_at;
```

## Adding a code

1. Add the entry to `ERROR_CATALOG` in `src/lib/errorCodes.ts` (format
   `PREFIX-NNNN`; ranges are reserved per subsystem in that file).
2. Run `npx tsx scripts/generate-error-codes.ts`.
3. Commit both files. `errorCatalog.test.ts` fails CI if you forget step 2.

**A shipped code is permanent.** Members and the owner quote codes; recycling a
number makes every historical row a lie. Retire, never recycle.

> **⚠️ The generator was broken until 2026-08-06 — and step 2 above had never
> actually run.** `package.json` declares `"type": "module"`, so the script's
> `__dirname` threw `ReferenceError: __dirname is not defined in ES module
> scope`. Reproduced on `main` at `d82f0ca` before it was touched, so this was
> not a new fault. Fixed with `fileURLToPath(import.meta.url)` in `f11eec1`.
> Implication: any `docs/error-codes.md` written before that date can only have
> been produced by hand, which is the exact thing this file forbids. **The
> command works now — use it, and do not hand-edit the markdown.**

> **SYS-9002 is deliberately empty, not missing.** It is reserved for "error
> boundary caught" in `src/components/AppErrorBoundary.tsx`, which is still
> unconverted. A comment in `errorCodes.ts` says so. Do not fill the gap with
> something else.

## Converted so far (2026-08-06)

`logger.ts` · `errorCodes.ts` · `FeedStoriesBar.tsx` · `ProfileStories.tsx` ·
`WallPosts.tsx` · `useCaptionMentions.ts` · `useAuth.tsx` ·
**`networkTracer.ts`**

The list lives in `CONVERTED_FILES` / `MUST_LOG` in
`src/lib/__tests__/loggingStandard.test.ts`. A file named there can never
regress to `console.log`, and must keep emitting logs carrying catalog codes.

**Still unconverted: 77 console calls in 43 files** (measured 2026-08-06 after
the tracer conversion, with a pattern that requires an actual call — the older
count of "98 in 44" included two things that were not calls at all: a string
literal in `AdminSEO.tsx` and a comment in `useAuth.tsx`). The list is
deliberately explicit rather than a glob so the checklist grows truthfully
instead of turning into 46 red files overnight.

## `networkTracer.ts` — the conversion worth reading before you do the others

It is the model for the rest, and it carries a lesson the others do not.

**What was wrong:** `main.tsx` called `startNetworkTrace(8000)` with no
environment guard. In production the tracer replaced `window.fetch` for the
first 8 seconds of every visit, `.clone()`d and fully read every API response
body just to measure its length, and printed a 22-call forensic report into the
member's console. It was a developer tool that had escaped into the product.

**Owner decision, 2026-08-06: gate to dev AND convert.** Both were done.

**Three independent guards, because it shipped to members once already:**

1. `main.tsx` only calls it inside `import.meta.env.DEV` — Vite resolves that at
   build time, so the branch leaves the production bundle entirely.
2. `startNetworkTrace()` and `stopNetworkTrace()` each return early outside
   development, so a future call site cannot re-open it. Same pattern as
   `decisionParityProbe.ts`.
3. Every log it emits is `debug`, which is neither printed in production nor
   ever persisted.

**Two decisions worth copying into the other conversions:**

- **Log the endpoint, never the raw URL.** `guessEndpoint()` drops the query
  string, and the query string is where row ids, filters and OAuth parameters
  live. The raw URL stays on `window.API_TRACE`, where it never leaves the
  machine that produced it. A test pins that no tracer log carries `url:`.
- **Pick the level so the owner's Error Log stays readable.** All five new codes
  (`SYS-9003`…`SYS-9007`) are `debug`. At `warn` a single developer page load
  would have pushed dozens of rows into the live Error Log and buried the real
  failures. **Ask "what does this do to the Error Log?" for every code you add.**

**Also note what was deliberately NOT done:** no log was added inside the fetch
interceptor's catch branch. It runs on every request the app makes, the caller
already logs its own failure with a meaningful code, and a second line there
would double every network incident for no new information.

**Proof taken on production after shipping** — `__APP_BUILD` is `2026-08-06-2`,
`window.API_TRACE` is `undefined`, and `window.fetch` is native code rather than
`tracedFetch`.

## Three defects caught while building this

Recorded because they are the argument for the tests and the checks:

1. **The logger leaked an e-mail to the database.** The printed line was
   masked; the persisted copy used the raw fields. Fixed by making `persist()`
   take the already-scrubbed payload. Test: "masks e-mails in the message
   itself, not just in detail".
2. **A comment-stripping helper ate 20 000 characters of `WallPosts.tsx`** —
   `accept="image/*"` opens a fake block comment that the next real `*/`
   closes. Fixed by anchoring block-comment stripping to the start of a line.
   Worth remembering: several existing tests in this repo use the naive pattern.
3. **A cleanup DELETE silently never ran.** The Supabase SQL editor puts
   destructive statements behind a "Potential issue detected → Run query"
   dialog. Clicking Run is not enough; the dialog must be confirmed and the
   result checked. A test row sat in the owner's live Error Log until a
   screenshot exposed it.

## Editor/browser techniques that made this practical

Pushing 16 files through the GitHub tiled editor would have been ~120 browser
round-trips. **GitHub's Upload files page takes real files, byte-exact**:
navigate to `/upload/main/<directory>`, `find` the file input, `file_upload`
the staged copies (they must live under `/mnt/user-data/outputs/…`), set the
commit message with the native value setter, click Commit. Overwrites existing
files cleanly. Every file verified with `git show origin/main:<path> | diff -`.

**A commit can silently NOT happen — always byte-diff every file afterwards.**
On 2026-08-06 one of five uploads (`scripts/`) never committed: the click was
swallowed and the next action navigated away, so the page state was lost with
no error anywhere. The `git show origin/main:<path> | diff -` loop caught it;
nothing else would have. **Clicking the commit button is not evidence that it
committed.**

**The commit button resists coordinate clicks.** The page scrolls between the
screenshot and the click, so the click lands in the description textarea
instead. Two coordinate attempts failed that way. What worked:
`document.querySelector('button[type="submit"]').click()` from
`javascript_tool` after setting the message with the native value setter.

**The Chrome bridge can drop its tab group between calls.** Three consecutive
attempts died with "Tab … no longer exists" until the extension was
re-activated. If it happens: stop after three, say so, and ask — do not loop.
Once it is healthy, `browser_batch` keeps a navigate + find in one round trip.

## What is NOT done

- 77 console calls in 43 unconverted files. Next: **Group A member-facing**,
  starting with `src/lib/imageUpload.ts` (see `HANDOFF_2026-08-06.md` §5).
- No logging yet in: image upload internals, notifications, competitions,
  judging, admin modules.
- The Error Log screen ships to the app too, but it is an admin screen —
  members never see it. It reaches the app with build 1054.
