# The app's blank pages — root cause found and fixed, 2026-08-10

**Owner report:** *"after changing pages sometimes coming and sometime showing
blank pages"* — in the installed Android app.

`main` = `273d936`. Typecheck ✅ · Security ✅. On the web now; the app needs
**build 1059**.

---

## 1. This was found from evidence, not from reasoning

Admin → Site Health → **Client failures**, read live on 2026-08-09, build
`2026-08-07-7` (1058):

| When | Kind | Where | Times | Message |
|---|---|---|---|---|
| 9:30 PM | `sys` | **app** · 2026-08-07-7 | **13** | A route crashed; the member is looking at the Reload screen, not the page they asked for. |
| 9:30 PM | **Blank page / crash** | **app** · 2026-08-07-7 | **7** | `TypeError · crypto.randomUUID is not a function` |

**Twenty failures in one hour**, both rows `platform = app`. This is the owner's
bug, named exactly, by our own logging.

Worth recording: the reason this was findable at all is the client-failure
logging added on 2026-08-05. `BLANK_PAGE_ROOT_CAUSE.md` closed with a prediction
— *"a `blank_page` row with `platform=app` and no `cause: chunk_load` is a
different fault, and the log will now name it."* It did.

## 2. Why a browser API was missing

`crypto.randomUUID()` is not universal:

* it shipped in **Chromium 92 (July 2021)**. On Android the WebView updates
  through the Play Store **independently of the OS**, so a phone on a current
  Android can still be running a years-old WebView;
* it is exposed only in a **secure context**.

`crypto.getRandomValues()` has neither restriction — it has been there since
Chromium 11. So the capability to generate a UUID was never missing; only that
one convenience function was.

## 3. Why it blanked the page instead of failing quietly

Fourteen call sites used it bare. Every member-facing one sits in a render path
or a react-query `queryFn`:

| Call site | Runs when |
|---|---|
| `useTrustedDevice.ts` — device id | **every logged-in member, at start-up** |
| `useNavigationMenu.ts` — menu seed | **every page** |
| `adSlots.ts` — A/B session id + slot id | every page carrying an ad |
| `adConversionContext.ts` — click id | ad clicks |
| `CompetitionSubmit.tsx`, `EditEntryDialog.tsx` — upload filenames | submitting an entry |

A throw there reaches `AppErrorBoundary`, which replaces the page with the
Reload screen: header and bottom nav, **nothing in between**. Precisely what the
owner photographed.

**And that is why it looked random.** Different screens touch different paths,
so on the same phone some pages open and others are blank — "sometimes coming
and sometime showing blank."

## 4. What shipped

`src/lib/safeUuid.ts` — `safeRandomUUID()`:

1. uses `crypto.randomUUID()` when it exists (identical output to before);
2. catches the case where a hardened WebView exposes the name but throws;
3. otherwise builds a real RFC 4122 v4 from `crypto.getRandomValues()` —
   correct version and variant bits, not a lookalike;
4. cannot itself throw.

Documented as **not for secrets**: every caller wants a collision-free label,
never an unguessable token.

All 14 sites now call it. Edge functions under `supabase/functions/` are
untouched — Deno always has the API; this is a browser problem.

## 5. The gate that stops it coming back

`src/lib/__tests__/safeUuid.test.ts` — 6 tests:

* deletes `crypto.randomUUID` and proves a valid v4 still comes out — **the bug,
  reproduced**, which nothing did before;
* proves the same when it exists but throws;
* 2,000 fallback ids, zero collisions;
* checks the version and variant bits, not just the 8-4-4-4-12 shape;
* **walks all of `src/` and fails on any direct call.**

Mutation-checked: putting the raw call back into `useTrustedDevice.ts` turns the
gate red and it names that exact file.

**Zero exclusions.** The one file allowed to mention the pattern is
`safeUuid.ts`, whose prose explains the ban; the test's own strings were worded
to avoid it rather than adding an exemption a real offender could hide behind.

## 6. One honest note on the lint baseline

Adding an import shifted nine `as any` entries down one line in
`as-any-protected-baseline.json`, and that rule is keyed on `file:line` **by
design** ("if the offending line moves, the rule fires").

Those nine line numbers were shifted by +1 — derived mechanically from where the
import landed in each file, not regenerated. No cast was added, removed, widened
or newly excused, and no untouched file was touched. Lint error count is
**36 before, 36 after**.

## 7. Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Test suite | **946 passed**, 6 failed — the exact known pre-existing set (4 ProfilePhotoPrompt, 2 judging). Zero new |
| Lint, changed files | 36 errors vs 36 on origin — parity |
| Mutation check | gate goes red and names the file |
| CI | Typecheck ✅ Security ✅ on `273d936` |
| Byte-diff, all 17 files vs `origin/main` | identical |

## 8. What is NOT claimed

* The fix is **evidenced by production logs**, but it has not been watched
  working on the affected phone — that needs build 1059 installed on a device
  with an old WebView.
* This explains blank pages caused by that TypeError. If blank pages continue
  after 1059, the Client-failures panel will name the next cause — check it
  first, do not guess.
* The `sys` row ("a route crashed") counted **13**, the blank-page row **7**.
  The gap suggests route crashes with other causes. Left visible on purpose.

## 9. Also shipped in the same batch

`src/components/GlobalSearch.tsx` — the search freeze. `<AnimatePresence>` kept
the full-screen (`fixed inset-0`) search panel mounted until an exit animation
reported completion; on Android that completion may never arrive, leaving an
invisible full-screen layer that eats **every** tap. Same defect as
NotificationBell on 2026-08-01, same remedy: plain conditional rendering, no
`exit` prop. Pinned by `GlobalSearchDismiss.test.tsx` (7 tests).

Caveat kept from before: the freeze was **not** reproduced in a browser. It is a
strongly-evidenced fix matching a documented prior incident in this codebase —
not an observed reproduction.

---

## Open, for the owner

* **Build 1059** is needed for any of this to reach the app. 1058 is still
  waiting to go to Play.
* **LCP measured 77,480 ms** on `/admin/health` while reading the panel. That is
  77 seconds. Admin-only and full of scans, so it is not the member experience —
  but it is unmeasured elsewhere and worth a look.
* `localStorage` holds an auth token for a **second, unrelated Supabase project**
  (`isywidnfnjhtydmdfgtk`) alongside the real one. Harmless-looking leftover;
  noted so it is not rediscovered as a mystery.
