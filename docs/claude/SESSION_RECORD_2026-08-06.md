# SESSION RECORD — 2026-08-06. Everything done, in one place.

Companion to `STATE_2026-08-06.md` (which is the "what is true now" file). This
one is the **record of the work**: what was done, what was measured, what was
got wrong, and what is still open.

**`main` HEAD at end of session: `2c31230`** ("fix: the support address is
mail@50mmretina.com"). Web marker `2026-08-06-10` (a parallel session was
working on the 1055 zoom feature). Android **1054 built, run #54, green**.

---

## 1. THE NUMBERS

| | |
|---|---|
| Console calls converted | **78 call sites across 50 files** — the codebase now has **zero** real `console.*` outside tests and the logger's own transport |
| Error codes created | **0 → 69** |
| Files pinned by tests | **42** |
| Tests | 730 → **860 passing**; the 25 failures are the same pre-existing set all day |
| Commits | ~45, every one byte-diffed against `origin/main` |
| Web deploys | `2026-08-06-1` → `-10`, each verified live in the owner's browser |
| Android builds | **1054 cut** (run #54, success, 4m 11s) |

---

## 2. WHAT WAS BUILT

### The logging standard, completed
Groups A (member-facing), B (judging/admin) and C (misc) — all converted.
Catalog at `src/lib/errorCodes.ts`, document generated to `docs/error-codes.md`,
a test fails CI if they drift. A **69-code Word document** was produced for the
owner to read.

**A fourth rule was added to the standard**, learned the hard way:
`redact()` is not a safety net for anything you deliberately pass in. It drops
keys that *look* like secrets; it does not know that `content`, `query` or
`caption` hold a member's own words. **Log a length, a count or a boolean.**

### Bugs fixed

| Bug | Root cause | Code | In 1054 |
|---|---|---|---|
| Network tracer ran on every member's phone | `main.tsx` called `startNetworkTrace(8000)` unguarded; it wrapped `fetch`, read every response body, printed 22 console lines | `SYS-9003…9007` | ✅ |
| Members' comment text printed to the console | `commentModeration.ts` logged `content: text` on every block; `useAddComment` logged the whole moderation reply | `CMNT-2101…2103` | ✅ |
| A crashed route told nobody | `AppErrorBoundary` only wrote a console line | `SYS-9002` (the catalog's only `fatal`) | ✅ |
| **Deleted account stayed signed in** | `checkRestricted` had `if (error \|\| !data) return false` — "row gone" treated as "lookup failed". Realtime guard listened for `UPDATE` only, blind to `DELETE` | `AUTH-1005` | ✅ **owner-confirmed working** |
| **Members could not post** | `reader.onerror = reject` in `fileSecurityScanner.ts:78` handed reject a DOM Event and discarded `reader.error` — the exception that names the cause | `FILE-5007`, `FILE-5009` | ✅ |
| Photo read up to 5× from the Android handle | scan ×2, compression ×2, preview ×1 | read-once refactor | ✅ |
| Admin list not live | `AdminUsers` never loaded on mount, so `activeQueryRef` stayed null and the realtime handler discarded every event | `ADMIN-8107` | ✅ (verification pending) |
| Owner's personal e-mail on a public page | Help & Support, in the `mailto:` href **and** the visible text | — | web |
| `generate-error-codes.ts` had never run | `__dirname` in an ES module — the documented command always threw | — | — |

---

## 3. WHAT WAS MEASURED — facts to not re-derive

- **The app bundles its own copy of the site.** `capacitor.config.ts` has
  `webDir: 'dist'` and **no `server.url`**. Web fixes are invisible on a phone
  until a build is cut and installed. **This cost most of the day.**
- **The deleted account really was deleted.** `auth.users` and `profiles` both
  returned 0 rows; **0 orphaned comments table-wide**. The purge works.
- **The "ghost comment" was never written.** The post in the screenshot has
  exactly one comment, and **zero comments were created anywhere** in the
  two-hour window. It was an optimistic UI render.
- **`post_comments.user_id` has NO foreign key.** Verified live against
  `information_schema`: 6 FKs on those tables (`post_id`, `parent_id`,
  `article_id`, `entry_id`) and **none on `user_id`**. A latent authorization
  weakness — writes are authorised on the JWT alone.
- **Access token lifetime is 3600s.** Read from the dashboard. That is the size
  of any post-deletion window.
- **`profiles` has REPLICA IDENTITY FULL** and `supabase_realtime` has
  `pubdelete = true`. Without both, the DELETE fix would have shipped and
  silently done nothing.
- **`profiles` RLS allows admins to view all profiles** — so RLS is NOT why the
  admin list fails to update. Eliminated.
- **26 post failures, 100% from the app, 0 from web**, two real members:
  Mainak Mridha (23 in one morning) and Shadequl Islam (3).

---

## 4. MISTAKES MADE — recorded so they are not repeated

1. **Shipped app-bug fixes to web only, repeatedly**, and treated "needs a
   build" as a closing footnote rather than a blocking condition. The owner
   tested on his phone, saw nothing change, and called it fake. He was right.
2. **Concluded "not called" from a `head`-truncated grep** — sent an entire
   investigation at the wrong file until `createPost` was read line by line.
3. **Reasoned from a screenshot to a mechanism** without checking whether the
   comment existed. Four queries reversed the conclusion.
4. **A stale-closure variable nearly shipped inside a log** (`query` instead of
   `q`). A log line is code; it can carry a bug.
5. **A test pin too blunt** — forbade the word `res` anywhere, flagging a
   legitimate `Boolean(res?.error)`.
6. **Miscounted the catalog in a doc** (31 vs 27) by doing arithmetic from
   memory instead of counting the file.
7. **A commit silently did not happen** — clicked, swallowed, navigated away.
   Only the byte-diff caught it.
8. **Raised a false alarm** about `@use-gesture/react` being a missing
   dependency; it was in `package.json` and the sandbox was stale.

---

## 5. STILL OPEN

| # | Item | Next action |
|---|---|---|
| 1 | **Admin list live-sync** | Owner hard-refreshing. **The refresh is one-time — to load the fixed bundle. After that it must update with no refresh at all.** If it still does not, suspect `useLastActive` route coverage. RLS and socket auth are ELIMINATED |
| 2 | **Bug 3 — perceived delay** | `src/App.tsx:180` — `refetchOnWindowFocus: false` + 5-min `staleTime`. One line. Do it early in a session so it can be watched and reverted |
| 3 | **Bug 4b** | One `FILE-5007` row on 1054 names the file-read exception |
| 4 | **Deleted user lands on `/login`** | Owner wants the home page. Needs his call: a deleted person on `/` can still browse public content |
| 5 | **Missing `user_id` foreign keys** | Latent P1. Orphan check returned 0 rows, so the constraint **can be added safely** |
| 6 | **Build 1055 — zoom** | Spec at `SPEC_1055_IMAGE_ZOOM.md`; a parallel session is implementing it |

**Owner's own list:** paste-deploy `cloudflare/seo-edge-injector/worker.js` ·
send the real female-member list · retest the app mention popup.
