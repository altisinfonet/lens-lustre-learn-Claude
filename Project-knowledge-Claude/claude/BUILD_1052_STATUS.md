# Build 1052 — CUT AND GREEN. Awaiting the owner's Play upload.

**2026-08-05 evening. The owner said "yes. build 1052 cut now" and the build
is done: workflow run #52, merge commit `24efda1`, Success in 4m 16s,
`versionCode=1052 versionName=1.2.2` read from the raw step log.**

**Owner action (the only remaining step):** download artifact `app-release-aab`
from run #52 → https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31019467407
and upload to Play. Play "What's new" is exactly `Bug fixes and improvements.`
Full changelog lives in `ANDROID_BUILD_TRIGGER`. Details in
`claude/NEXT_RELEASE_RUNBOOK.md`.

---

## ✅ INSIDE 1052 — every item verified on `main`, local==remote byte-checked

| # | What | Proof |
|---|---|---|
| 1 | **IMAGES FIXED — the big one.** Post photos were rerouted (1 Aug) through a resizer that only answers the bare domain; members are on www, the app is a third origin — post photos died everywhere while avatars/ads (direct URLs) kept working. Post photos now load DIRECT. | Measured in the owner's own browser; 0 placeholders on www after deploy; his two-browser comparison was the decisive evidence. Pinned by PostMediaFrame tests (3 red vs broken code). |
| 2 | **Post rule**: a post REQUIRES a photo, caption optional — and DP never blocks posting/commenting/reacting. | 7 tests red vs the mistake; DB rehearsals |
| 3 | **Downloads in the app**: photos + article PDFs save via Filesystem→CACHE + system Save/Share sheet. | 8 tests; `@capacitor/filesystem` literally visible in run #52's install log (line 5) — the fix is live, not inert |
| 4 | **Emoji in comments**: `<3`→❤️ `:)`→😊 `:(`→☹️ `;)`→😉, anywhere incl. trailing; keyboard emoji untouched; URLs/`(see 8)` never converted; idempotent. Submit-time conversion in useAddComment + CommentsSection + ImageEngagement. | 21 tests in src/lib/__tests__/emoji.test.ts, all on main |
| 5 | **Version beside Logout**: profile sheet bottom row = Logout (left half) + loaded build ("1052 (1.2.2)" in app, web deploy stamp on web, NOTHING when unknown — never invented). | src/lib/appVersion.ts + AppVersionLabel.tsx + 6 tests |
| 6 | **Deploys no longer break open tabs** (the /admin/users crash) — stale-chunk auto-reload, once per 30s, loop-guarded. | staleChunkReload.ts live |
| 7 | Everything from 1051 and earlier (photo retry, birthday, He/She, notification icon…). | run #51 record |
| 8 | Web build marker bumped to `2026-08-05-2`. | main.tsx |

Full verification before the cut: typecheck clean, 61 session tests green
(21 emoji + 8 saveFile + 25 PostMediaFrame + 7 PostRequiresPhoto) + 6
appVersion tests, `npm run build` green, every session file byte-identical
local==remote.

## ⏳ STILL OPEN after 1052 (owner-agreed: not in this build)

| # | What | State |
|---|---|---|
| B | **Mentions in post captions** — feature never existed (captions have no tagging, only comment boxes do). Owner agreed it goes to 1053 rather than risk the "final, no errors" build. | next build's headline item |
| C | Mention popup in the APP comment box — reported on 1050; retest on 1052 before treating as a live bug | test once 1052 installed |
| E | Admin users list: last-active + app/web origin (origin needs a new column; nothing records it today — do NOT derive from error rows) | web-side, no app build needed |
| F | Bare 50mmretina.com → www redirect (cures the "two headers on one link" two-origin confusion) | infrastructure; awaiting owner's word |
| H | Owner's real female-member list (33 avatars carry a provisional split) | awaiting list |
