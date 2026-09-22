# Build 1053 — ✅ LIVE ON THE PLAY STORE (2026-08-06)

The owner uploaded it and it went live the same day. **Nothing outstanding on
this build.** Everything below was byte-verified local==remote, covered by tests
on `main`, and live-verified in the deployed lazy chunks before the cut.

- Run **#53**, commit `679d25f`, **Success in 3m 39s**.
- `versionCode=1053 versionName=1.2.2` — read from the raw "Set app version"
  step log, not assumed. versionName deliberately unchanged; Play needs only a
  higher versionCode. In-app label reads "1053 (1.2.2)".
- Artifact `app-release-aab` (8.86 MB):
  https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31063602205
- **Play "What's new" was exactly:** `Bug fixes and improvements.`

### ⚡ Now that it is live
1. **App members start appearing in the admin App/Website column** as they
   update — 1053 is the first build that records `last_platform` from the app.
   Every row before this read "Website", and that was correct, not a bug.
2. **Item C is testable at last:** the app comment-box mention popup (reported
   on 1050, never retested).
3. Worth asking the owner to confirm on his handset: bigger story rings, a story
   opening full-page, the 10-second timer, deleting a story and seeing it
   vanish, and typing `@` in a post caption.

---

## ✅ WHAT IS IN 1053

### B — MENTIONS IN POST CAPTIONS (the headline item)
Owner: *"typing @name in a post caption tags a member, like comments do."*
Commits `7764a49` + `acc2456` + `a30a809` + `c78c7f9`. 18 tests green.

- Typing `@par` opens a member dropdown UNDER the box (avatar + name, same look
  as the comment box); tap or Enter picks.
- The picked name is inserted as visible text `@Partha Dalal`; at Post time it
  converts to the SAME `@[Name](id)` markup comments store, so `Caption.tsx` /
  `RichContentRenderer` render the profile link with ZERO changes.
- **HONESTY RULE: only PICKED names convert.** A hand-typed "@Someone" stays
  plain text — guessing which member was meant could tag the wrong person. An
  edited pick ("@Partha Dal") degrades to plain text, never a wrong tag.
- The plain `<Textarea>` + over-limit yellow highlight + auto-grow were KEPT
  ("never break what works"); mentions layer on top via
  `src/hooks/feed/useCaptionMentions.ts` + `src/lib/captionMentions.ts`.
- Dropdown taps use `onPointerDown` (the Android-WebView tap rule from
  `MentionInput`/`GlobalSearch`). Keyboard: arrows + Enter/Tab + Escape.
- Works for both **Post now AND Schedule** (both submit sites convert).
- **NOT included:** a "mentioned you" notification. Comments do not send one
  either, so parity was the spec. Adding it = new DB work (ACTION_CATALOG + the
  SQL parity copy). **Offer it; do not build it unasked.**

### Stories — all four owner rules (he sent an Instagram screenshot)
1. **Bigger rings** `h-20 w-20 sm:h-24 sm:w-24` (80→96px), feed bar + profile.
2. **Delete anytime** — root cause below.
3. **Full-page viewer** — profile stories render full-bleed with progress bars,
   tap zones and timed auto-advance; highlights keep their boxed modal.
4. **10 seconds** — shared `STORY_DISPLAY_MS = 10_000` in
   `src/lib/storyTiming.ts`; both viewers import it so they cannot disagree.
- Pinned by 9 tests in `StoriesOwnerSpec.test.ts` (`1ff074f`).

#### "Unable to delete" — the real cause (measured, not guessed)
- **RLS was NOT the problem.** `pg_policies` shows "Users can delete own
  stories" (DELETE, `user_id = auth.uid()`) plus an admin ALL policy.
- The bug: `handleDeleteOwn` deleted the row but never removed the story from
  local state — the ring and story stayed on screen until a full reload. That
  reads exactly as "unable to delete".
- Fix (`e21f7ef` + `66b47b4`): `.delete().eq(...).select("id")` so the database
  returns what it deleted (0 rows ⇒ honest error, never a false "Story
  removed"), then local state filtered and the bar reloaded so the delete is
  SEEN.

### E — Admin users list: last-active + App/Website origin
- DB: `profiles.last_platform` (`'app'|'web'`) — applied on production.
- `useLastActive.ts` writes both fields every 5 min from
  `isNativeCapacitorApp()` (`2dd1a51`).
  **NEVER derive origin from `client_errors`** — pinned in code and test.
- `AdminUsers.tsx` shows last-seen (green "Active now") + an App/Website pill,
  both conditional on non-null (`73411c3`). 7 tests (`3d59e14`).
- **Data exists from 2026-08-05 onward ONLY.** Blank = "not recorded yet".
- **App entries begin only with this build**, as members update.

### F — Bare `50mmretina.com` → `www`
- `index.html` inline script (`b38a193`) — self-deploying, VERIFIED LIVE.
- True 301 in `cloudflare/seo-edge-injector/worker.js` (`0018271`).
  **OWNER ACTION STILL OPEN: paste-deploy in the Cloudflare dashboard**
  (Workers & Pages → seo-edge-injector → Edit code). Until then the inline
  script covers browsers; the 301 covers crawlers/SEO.

### Web build marker
`src/main.tsx` → `2026-08-06-1`.

---

## 📌 SHIPPED TO WEB AFTER THE 1053 CUT — RIDES INTO 1054

The **enterprise logging standard**: logger, error catalog, database sink, the
converted risky paths, and the **Admin → Error Log** screen. Live on web now;
reaches the app with the next build. Full detail in `LOGGING_STANDARD.md`.

---

## ⏳ WHAT REMAINS AFTER 1053

- **Owner:** paste-deploy `worker.js` in Cloudflare (the true 301).
- **Owner:** the real female-member list (33 provisional avatars) — item H.
- **Owner:** retest the app comment-box mention popup — item C, now possible.
- **Us:** ~98 `console.*` calls in 44 files still unconverted — see
  `HANDOFF_2026-08-06.md` §5 for the exact file/line list and the planned order.
  **PAUSED** pending an owner decision on `networkTracer.ts`.
- **Cut 1054 ONLY on the owner's explicit GO.** Next run will be #54 → 1054.
