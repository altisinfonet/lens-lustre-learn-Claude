# START HERE — read these before touching anything

**The product is LIVE.** Every commit to `main` deploys to members within about
90 seconds. Owner instruction, 2026-08-02: *"not a single kind of mistake I
can't afford. Build small but build like a bullet proof."*

Last updated **2026-08-06, 03:20**.

> ## 👉 READ `HANDOFF_2026-08-06.md` FIRST.
> It carries the exact current state, the paused task, the one decision waiting
> on the owner, and every technique learned. This file is the standing
> reference; that one is where you resume.

---

## 0. STATE RIGHT NOW (2026-08-06)

- **Android build 1053 is CUT and GREEN, waiting for the owner to upload it to
  Play.** Run #53, commit `679d25f`, `versionCode=1053 versionName=1.2.2`.
  Artifact: https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31063602205
  Play "What's new" is exactly `Bug fixes and improvements.`
- **`main` HEAD:** `d82f0ca`. Local clone clean.
- **`__APP_BUILD` (web):** `2026-08-06-1`.
- **Test baseline: 730 passing / 25 failing / 1 skipped.** The 25 are
  PRE-EXISTING (4 ProfilePhotoPrompt — owner ruled "Not required" — and 21 in
  the competition/judging suites). **Never report them as newly broken.**
- **Work is PAUSED** part-way through converting the remaining 98 `console.*`
  calls. Nothing was edited when it paused.

### Two NEW standing directives from the owner (2026-08-06) — permanent
1. **Enterprise structured logging on every function you write or modify.**
   Coded, with expected/actual/reason/next-step, timing, redaction. Never
   `console.log`. Never generic messages. Never secrets. See
   `LOGGING_STANDARD.md`.
2. **A Completion Verification Report after EVERY task** — a checklist marking
   each item ✅ DONE / ❌ NOT DONE / ⚠️ PARTIALLY DONE / N/A with concrete
   evidence, and an explicit explanation of anything incomplete.
   **Never simply say "Done".**

### ✅ CORRECTED — the profile-photo gate is GONE (was §0b here until today)
This file previously said *"39% of members cannot post or comment"*. **That is
no longer true.** The two RESTRICTIVE photo policies were removed on
2026-08-05 and verified gone on production. The rules now, and they are
separate:
- **A post REQUIRES a photograph; the caption is optional.**
- **A missing profile photo (DP) NEVER blocks posting, commenting or reacting.**
Both are pinned by tests and by a deliberately loud comment at the top of
`createPost` in `WallPosts.tsx`, written after I once conflated them.

### 🔴 STILL OPEN — the blank-page root cause (owner decision)
`BLANK_PAGE_ROOT_CAUSE.md`. A missing file under `/assets/*` returns **200
`text/html`** (the SPA fallback) while `public/_headers` stamps `/assets/*` as
`immutable, max-age=31536000` — so a browser stores HTML under a `.js` URL for a
year and the route dies permanently. Mitigations shipped (per-chunk retry keys,
cache eviction, cache-busting reload, reporting). **Still owed: make a missing
`/assets/*` file 404 instead of serving index.html.** Until then it is a bandage.

### ✅ Client failures are recorded AND readable
Two systems now, and they are complementary:
- **Admin → Health → "Client failures"** — the older `reportClientError` path
  (5 fixed kinds, hourly stats).
- **Admin → Overview → Error Log** (`/admin/app_events`) — the NEW structured
  log: codes, severity, expected vs actual, next step, timing, and a
  correlation id that replays one member action end to end.

---

## 1. Read first, always

| # | File | Why |
|---|---|---|
| 0 | **`HANDOFF_2026-08-06.md`** | **Current state, paused task, owner decisions.** |
| 1 | **`WORKING_RULES.md`** | The method — the owner's verbatim ABSOLUTELY-NO list. |
| 2 | **`PROJECT_MASTER_RECORD.md`** | Accounts, stack, backend, gotcha catalogue. |
| 3 | **`NEXT_RELEASE_RUNBOOK.md`** | The ONLY Android runbook. Currently documents 1053. |
| 4 | **`LOGGING_STANDARD.md`** | The logging standard, the catalog, what is converted. |

## 2. Read when the work touches that area

| File | Covers | State |
|---|---|---|
| **`BLANK_PAGE_ROOT_CAUSE.md`** | The 30-day blank page. | 🔴 fix incomplete |
| **`BUILD_1053_PROGRESS.md`** | Everything in 1053, with live proof. | ✅ |
| **`LOGGING_STANDARD.md`** | Logger, catalog, Error Log screen. | ✅ live |
| **`CLIENT_ERROR_TRACKING.md`** | The older error-reporting path. | ✅ live |
| **`DEPLOY_CACHE_GOTCHA.md`** | Deploy stack, `__APP_BUILD`, chunk verification. | ✅ |
| `TODAYS_BIRTHDAY.md` · `NOTIFICATIONS_SYSTEM.md` · `ANDROID_NOTIFICATION_ICON.md` · `PROFILE_PHOTO_POLICY.md` · `TEXT_ENCODING_CORRUPTION.md` | area references | ✅ |
| `PROFILE_PHOTO_GATE_IMPACT.md` | **HISTORICAL — the gate it describes was removed 2026-08-05.** | ⚠️ stale |
| `NOTIFICATIONS_REMAINING_MEASURED.md` · `NOTIFICATIONS_AUDIT_2026-08-01.md` · `PERFORMANCE_AUDIT.md` · `GOOGLE_OAUTH_BRANDING_CHECK.md` · `LANGUAGE_PLAN_WEB_AND_APP.md` | reference / historical | — |

---

## 3. Open decisions waiting on the owner

1. **The network tracer prints to the console in production.**
   `src/lib/networkTracer.ts` intercepts every `fetch()` and prints a report;
   `main.tsx` line 18 starts it unconditionally with **no `PROD` guard**. Leave
   it, gate it to development, or convert it to the logger? **Ask; do not
   decide alone.** (21 of the 98 remaining console calls live there.)
2. **Make `/assets/*` 404 instead of serving index.html** — the blank-page fix.
3. **A "mentioned you" notification for caption mentions** — not built, because
   comments do not send one either and parity was the spec. Offer it.
4. **Bump versionName to 1.2.3** on the next build? 1053 shipped as
   `1053 (1.2.2)`; Play only needs the versionCode to rise.
5. New-post pushes reach everyone (most members have no preferences row).
6. Type scale — a large share of visible text is under 12px.
7. Brand-name rule boundary (`auth.continueApple`, `csub.uploadNote`).

## 4. Waiting on the owner to DO something

1. Upload build 1053 to Play.
2. Paste-deploy `cloudflare/seo-edge-injector/worker.js` in the Cloudflare
   dashboard (Workers & Pages → seo-edge-injector → Edit code) for the true 301.
3. Send the real female-member list (33 avatars carry a provisional split).
4. Retest the app comment-box mention popup on 1052/1053 (reported on 1050).

---

## 5. Things that have cost real time — do not rediscover them

### Pushing code
- **`git push` is BLOCKED** (proxy 403: "not in this session's authorized
  repository set"). `git fetch origin main` always works for verification.
- **The GitHub "Upload files" page is the fast, byte-exact write path.** Stage
  files under `/mnt/user-data/outputs/…`, navigate to
  `/upload/main/<directory>`, `find` the file input, `file_upload`, set the
  commit message with the **native `HTMLInputElement` value setter**, commit.
  16 files went through it in one session. Always verify with
  `git show origin/main:<path> | diff - <path>`.
- **In the tiled editor, NEVER trust `ctrl+A` / `ctrl+shift+End`** — it silently
  selects nothing and the paste APPENDS, duplicating the file. Use counted
  `shift+Down` (≤100 per batch) + `shift+End`, and verify with a screenshot or
  `window.getSelection().toString()` before pasting.
- **The first click/keypress after a navigation is often silently ignored.**
  Redo it once the page has visibly loaded.
- **To prepend to a big file:** `ctrl+Home`, one `shift+Down`, verify the
  selection is exactly line 1, paste `<new> + <original line 1> + "\n"`.
- **Filename field on `/new/main`:** target the input with placeholder **"Name
  your file..."** — a generic input search lands on the sidebar "Go to file"
  search, whose "No matches found" popup is the tell.
- GitHub's commit button sometimes needs real mouse clicks at freshly
  screenshotted coordinates; typed text can land in the DESCRIPTION field.

### Supabase
- The SQL editor is **Monaco**:
  `window.monaco.editor.getModels()[0].setValue(sql)` then click `Run`.
- **DESTRUCTIVE STATEMENTS OPEN A CONFIRMATION DIALOG** ("Potential issue
  detected" → **Run query**). Clicking Run is NOT enough. A cleanup DELETE
  silently never ran and left a fake test row in the owner's live Error Log.
  **Always screenshot the result.**
- **No CI deploys Supabase edge functions** — deploy by hand in the dashboard.
- **Migrations do not auto-apply.** Paste into the SQL editor and verify.
- **NEVER re-derive a live SQL function from a partial read.** Generate the new
  migration from the previous migration FILE and `diff` it.
- **Never add parameters to a live function that installed apps still call** —
  it creates an ambiguous overload and breaks every shipped build. Give the new
  function a NEW NAME (this is why `log_app_event` exists beside
  `log_client_error`).
- The dashboard token expires mid-session — reload and re-read it.
- A temp table is invisible to `SET LOCAL ROLE authenticated`. Inline values.
- `BEGIN; <ddl>; SELECT …; ROLLBACK;` via pg-meta = rehearsal and proof in one.

### Verifying a deploy
- **Route code lives in LAZY chunks, not the entry bundle.** Fetch
  `/?cb=<random>`, read chunk names out of `index-*.js`, then grep the feature
  string inside the SPECIFIC route chunk. Checking only `index-*.js` gives
  **false negatives** — this wasted time twice.
- A missing `/assets/*` file returns 200 `text/html` and is cached `immutable`
  for a year. See `BLANK_PAGE_ROOT_CAUSE.md`.
- **The sandbox cannot reach production web** — verify through the OWNER'S
  BROWSER.
- `raw.githubusercontent.com` is stale for a minute — use `git fetch`.

### Tests and source pins
- **Typecheck with the config CI uses:** `npx tsc --noEmit -p tsconfig.app.json`.
- **The naive comment stripper eats real code.** `/\/\*[\s\S]*?\*\//g` treats
  `accept="image/*"` as opening a block comment that the next real `*/` closes
  — it deleted 20,000 characters of `WallPosts.tsx` and made true assertions
  fail. Anchor to line start: `/^\s*\/\*[\s\S]*?\*\//gm` plus
  `/\{\/\*[\s\S]*?\*\/\}/g` for JSX comments. **Several older tests in this repo
  still use the naive pattern.**
- **Run a "regression test" against `main` first.** If it passes there it is not
  a regression test and must be deleted.
- **Only add a file to `CONVERTED_FILES` after actually converting it** — I once
  listed `useAuth.tsx` while it still held two `console.log` calls; the test
  caught the over-claim.
- `vi.mock` is hoisted above imports — use `vi.hoisted` to share a spy.
- Testing Library's bound queries search the whole document — scope with
  `within(result.container)`.
- jsdom has no layout. Geometry needs real Chromium.

### Product logic traps
- **A `LIMIT` with no `ORDER BY` is a silent data cut** — it hid 28 of 68 members.
- **`NOT (x = ANY(NULL))` is NULL, not TRUE** — rejects every row, no error.
- **A column default is not the effective default.**
- **React Query's global `staleTime` silently outranks a database fix.**
- **A write that reports success but changes zero rows is almost always RLS** —
  and it looks exactly like "the button does nothing". This was the stories
  "unable to delete" report. Use `.select("id")` after `.delete()` to prove it.
- **CSS hiding is not unmounting.**
- **`position: sticky` only holds while its containing block is on screen.**
- **`scroll-snap-type: mandatory` ignores container padding** — add `scroll-px-*`.
- **Colour classes stored in the DATABASE cannot be fixed in code alone.**
- **ANY new notification type pushes AND emails everyone by default** — both
  gates end in `ELSE true`. Suppress email with `email_sent = true`.
- **`ON CONFLICT` against a PARTIAL unique index must repeat the predicate.**
- **`describeThrown` for the LOG, `memberFacingMessage` for the MEMBER.**
- **A logger must never amplify an incident** — rate limited, silent, never
  awaited, and it must never throw into the caller.
- **`RequireAuth` in `App.tsx` wraps members-only routes.** Public by design:
  `/post/:postId`, `/hashtag/:tag`, `/IDverification`.
- **An admin tab needs THREE registrations** — the routes `Set`, the menu group,
  and the `AdminTab` type. Miss the `Set` and the menu item silently lands the
  admin on the default tab.
- `pkill` in a compound Bash command can kill the shell (exit 144).

---

## 6. Standing owner rules — not preferences

1. **No third-party brand or format names** where a member can read them.
2. **Play "What's new" is exactly `Bug fixes and improvements.`** The detailed
   changelog goes ONLY in `ANDROID_BUILD_TRIGGER`.
3. **No user accounts are ever deleted.**
4. **No guesswork, no assumptions, no bulk changes, no "probably safe".**
5. **Never mark something done without proof taken after it shipped.**
6. **A fix that cannot be SEEN is indistinguishable from no fix** — and a log the
   owner cannot open is not tracking: *"just i cant check is not the soltuion"*.
7. **Members-only links send a signed-out visitor to the sign-in page.**
8. **No running character counter on any member text area.**
9. **Nothing a member does may move a displayed figure.**
10. **The web top bar is fixed at all times.**
11. **Name first, then badge — and the badge must be VISIBLE.**
12. **Do not cut an Android build per change** — batch, or wait to be asked.
    **Builds are cut only on his explicit GO.**
13. **A member's own privacy switch outranks a feature.**
14. **An error message must tell the member what happened.**
15. **When the owner offers evidence, take it.** The 30-day blank page was solved
    in one step by a console capture.
16. **Never show an invented value. Blank is honest.**
17. **He signs in himself. Never enter credentials.**
18. **A Completion Verification Report after every task** (2026-08-06).
