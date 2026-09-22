# 2026-08-03 — the complete day log, every point, in order

> Written for the NEXT session. Read `START_HERE.md` first; this file is the
> detailed record of one day. Everything here was verified when it happened;
> where something is NOT proven, it says so.

---

## 0. Where things ended (the short version)

| Thing | State at end of day |
|---|---|
| **Android build to upload** | **1044** — run `30842007275`, artifact `8867251397`, 9,188,383 B. All steps green incl. signing + icon-in-bundle assertion. ⚠️ raw-log "SIGNED" line not read for this one (owner took the browser); every other build that day logged it. jarsigner never run. versionName still 1.2.2. |
| Web build | `2026-08-03-07` (7 deploys this day: -01 … -07) |
| main | `187018b` (merge of PR #56) + trigger commits for 1043/1044 |
| Superseded builds | 1039, 1040, 1041, 1042, 1043 — do NOT upload any of them |
| Owner's last instruction | "Update all .md files so the next chat understands every minor point" — this file is that |

---

## 1. Corrupted characters ("why all font is just unreadable") — FIXED, live

- Owner screenshot showed `SEE ALL Ã¢ÂÂ`. **Not a font problem.** Live DOM
  read: `See All` + `U+00E2 U+0086 U+0092` where `→` (U+2192, UTF-8 E2 86 92)
  belongs. UTF-8 read as Latin-1 and re-saved; U+0086/U+0092 are C1 controls —
  no font has glyphs → boxes.
- **First count was WRONG (41 → actually 74).** I enumerated by a hand list of
  3-byte signatures and missed every 4-byte emoji. Lesson (now in
  WORKING_RULES): enumerate damage by PROPERTY, not by list.
- 74 runs / 6 files; 41 member-visible: every competition placement badge
  (🏆🥈🥉🎖⚖️🌟✨⭐👁), every round icon (✓★✗⚠), sidebar medals, 4 sidebar
  arrows, 📌 pin, both comment placeholders (…), "2× the reward".
- Repair = re-encode Latin-1 → decode UTF-8 (exact inverse; nothing typed by
  hand). 0 false positives across 1497 files incl. ~120k Indic chars.
- Tripwire test `src/__tests__/sourceEncoding.test.ts` fails CI if it returns;
  it caught corruption IN ITS OWN FILE on first run (sample was literal —
  rebuilt from `String.fromCharCode`).
- PR #50, merged `51f26f8`, verified live: 0 garbled nodes.
- Full doc: `TEXT_ENCODING_CORRUPTION.md`.

## 2. Fonts (owner asked "one font or multiple? change from one master file?")

- Effectively ONE font: **Inter**. Declared 4 places: `index.css:1-3`
  (@imports Inter+Lora+Space Mono), `index.css:77-79` (`--font-display/
  heading/body` — all three the IDENTICAL string), `index.css:86-88`,
  duplicate in `tailwind.config.ts:123-155`.
- Real usage: **2091 inline `style={{fontFamily: var(--font-*)}}`** props in
  248 files (heading 1358 / body 568 / display 165) + 83 `font-mono`.
  `font-sans`/`font-serif`: 0 uses. **Lora loads on every page and is used
  NOWHERE.**
- Changing the site font = `index.css:77-79` (3 lines). Full change = + the
  @import + `tailwind.config.ts` mono + `index.html:59` splash.
- Fallback stack has NO -apple-system/Segoe UI/Roboto → pre-Inter flash shows
  Arial. Fix designed ("Tier 1"), owner never said go — **NOT shipped**.
- Indic reality: Inter/Roboto/Geist/Manrope contain **zero glyphs** for
  Devanagari/Bengali/Tamil/Telugu/Gujarati (measured by rendering vs null-font
  reference on the live site). Any Latin font choice is cosmetic for 6 of 7
  shipped languages. Noto Sans per-script loads verified working.
- **THE REAL READABILITY BUG, STILL OPEN:** of 168 visible text elements on
  the live feed, 70 (42%) are <12px; 41 at 9px; 6 at 7px; body 14px at
  line-height 1.34. iOS min 11pt, Material min 12sp. Owner shown the numbers;
  approval for a type-scale pass never given. Do NOT ship without his
  screenshots-approval.

## 3. Comment box — the full evolution (owner: "exactly like Instagram")

All in ONE component `src/components/MentionInput.tsx` (11 call sites).
Tests: `SendButtonTapTarget.test.ts` (15) — every step mutation-checked.

1. **PR #51**: send button tap target 24×24 → 44×44 (Android min 48dp, iOS
   44pt, thumb ≈45px). type="button" added; fires pointerdown+click with
   `sentRef` 500ms guard (no double post); `enterKeyHint="send"`.
2. **PR #52 multiline**: removed `singleLine` → react-mentions renders
   `<textarea>`. KEY MECHANISM: in multiline the textarea is absolute
   height:100% over the HIGHLIGHTER, and the highlighter (normal flow) SETS
   the height → auto-grow needs no JS. Therefore input & highlighter must
   share IDENTICAL padding and lineHeight (both pinned 20px) or @mention
   pills drift on wrap. Radius 9999px→18px (capsule bows when tall).
   Cap maxHeight 116px (≈5 lines) then scrolls — on control AND highlighter.
   Enter: touch=newline (no Shift key on phones!), desktop=post,
   Shift+Enter=newline — via `matchMedia("(pointer: coarse)")`.
   `enterKeyHint` REMOVED (a "Send" key would lie when Enter makes newline).
   `autoCapitalize="sentences"` added.
   BUG CAUGHT BY RENDERING: send button hung OUTSIDE the pill — wrapper
   (containing the char counter) was the positioning context. Fix: inner
   `<div className="relative">` around the field only.
3. **PR #53 visible disc**: owner called the invisible 44px zone "fraud —
   button same size as before". He was right in substance: a fix you cannot
   see is indistinguishable from no fix (now WORKING_RULES). 30px filled
   `bg-primary` disc inside the 44px zone; test forbids disc==target.
4. **PR #54 centring**: owner: "alignment must be middle and compact".
   Geometry: pill=36px (8+20+8); last-line centre is ALWAYS 18px from bottom;
   44px button centre = bottom+22 → `bottom-[-4px]` puts disc centre at 18px
   exactly — dead centre at 1 line AND centred on the last line when grown.
   Disc 30→28px. Rendered proof: 0.0px error both cases.

Verified live end-to-end after each PR. Posting a real comment was never
exercised (would create live data); the submit path itself was untouched.

## 4. Mentions & keyboard suggestions — verified, not broken

- Keyboard suggestion strip is drawn by the OS keyboard; apps can only avoid
  disabling it. Comment box disables nothing (autocomplete/spellcheck/
  autocorrect all default-on). GlobalSearch disables them deliberately.
- @mention path proven 3 ways: (a) exact query via anon REST returns 6 rows;
  (b) dropdown renders on-screen, tappable, at 412px (network mocked in
  harness because sandbox blocks supabase.co from headless — see §8);
  (c) old-vs-new component A/B identical → multiline broke nothing.
- Suggestion overlay root has height 0 (its list is out-of-flow) — measure
  the `ul`, not the overlay, or you get false "off-screen".

## 5. Profile-completion ring panel — FIXED (PR #55)

- Owner screenshot: panel "outside of page". Measured: ring 80px at x=16;
  panel 224px centred on 40px midpoint → starts at −56px (⅓ off-screen);
  hover-only gating meant first tap opened it forever (synthetic mouseenter,
  never a mouseleave).
- Fix: `left-0` + `max-w-[calc(100vw-2rem)]`; hover gated to fine pointers,
  click-toggle gated to coarse. FIRST FIX WAS WRONG: ungated click-toggle +
  tap's mouseenter→click sequence = open-then-instantly-close; caught by
  rendered harness, not by reading. Tests: `AvatarCompletionRing.test.ts` (4).
- Rendered proof: tap opens x16..240 fully on-screen; second tap closes.

## 6. Google avatars 503 — FIXED server-side, live for ALL builds

- Owner: "login time image not loading, joining time image not loading."
  Network capture on the signed-in feed: every cdn.50mmretina.com image 200;
  every lh3.googleusercontent.com image **503**. 27/81 members carried such
  URLs; 44 CDN photos + 2 legacy uploads fine.
- Two triggers kept writing them: `handle_new_user` (signup) and
  `sync_oauth_on_login` (re-writes when avatar_url IS NULL — the sneaky one).
- Migration `20260803210000_no_hotlinked_avatars.sql`: both triggers stop
  copying the OAuth picture (names still sync); backfill 27 → NULL.
  Rehearsed BEGIN/ROLLBACK (27→0→27), applied, verified: counts 0/44/2,
  `pg_proc.prosrc` clean, triggers attached. After: feed load = 0 google
  requests, 0 broken imgs. Full story in `PROFILE_PHOTO_POLICY.md` §2026-08-03.
- Consistent with policy: OAuth pictures never counted as profile photos;
  onboarding still forces a real upload. NOTHING was copied to our storage.

## 7. Auth guard — FIXED (PR #56): members-only links → /login

- Owner: logged-out visitors opening members-only links must land on sign-in.
- No central guard existed; pages hand-rolled `navigate("/login")`; NINE
  forgot: `/profile` (fake skeleton), `/photos` (**literally blank body** —
  `if (!user) return null`; one confirmed "blank page"), `/notifications`
  ("Nothing here yet." — a lie), `/entry/:entryId` (entries NOT anon-readable
  → members-only by data), `/journal/new`, `/journal/edit/:id`,
  `/courses/new`, `/courses/edit/:id`, `/courses/:slug/lessons/:lessonId`
  (parent guarded, child forgot).
- Fix: `RequireAuth` outlet-wrapper in `App.tsx` around EXACTLY that list;
  waits for auth `loading` before deciding (redirecting during hydration
  would bounce real members). Census + reasons in the code comment.
  `authGuardCensus.test.ts` (13) pins list + semantics.
- NOT wrapped, with evidence: `/hashtag` (its own UI says "public posts"),
  `/IDverification` (public staff-card check), `/post/:postId` (posts ARE
  anon-readable → share links), `/admin` + `/judge` (role-gated internally,
  redirect to `/` — stricter, untouched), `/settings/notifications` (already
  redirects via its own hook).
- Proof: logged-out census re-run on built output — all nine → /login;
  logged-in live /profile renders fully (no hydration bounce); guard present
  in deployed bundle. **In the app only from build 1044.**

## 8. FALSE ALARM corrected on the record (important method lesson)

- I claimed on PR #56 that shared /post links were broken for logged-out
  visitors. WRONG: the sandbox proxy **blocks 50mmretina.com and supabase.co
  from headless Chromium** (curl is allowed!), so every remote query in the
  census failed → "Post not found" was an environment artifact.
- Re-verified query-by-query as an anon client against production: post row,
  author profile, reactions, comment count (2), share count (0) — all
  succeed. Share links WORK logged-out. Correction comment posted on PR #56.
- RULE: never trust a sandbox-headless verdict about remote data.

## 9. Blank pages in the APP — NOT reproduced; status honest

- Owner screenshots (old installed build, status bar showed **29.8 KB/s**):
  internal pages blank. Current code at phone size: 6 routes render, 0 JS
  errors. Contributors found & fixed: /photos truly blank logged-out (§7),
  27 broken avatars on every page (§6). App.tsx already carries the
  2026-07-28 blank-page fix (lazyRetry + synchronous Suspense fallback).
- VERDICT ONLY AFTER 1044 IS INSTALLED. If any page is blank on 1044, get the
  page name — that reopens the investigation with a real target.

## 10. Notification icon — logo, unchanged today, still proven

- 1041+ ships the owner's logo silhouette (per-density cuts). Every build runs
  the assertion that opens the .aab and fails if `ic_notification` is missing
  from `base/resources.pb` or either manifest meta-data entry is absent.
  1042/1043/1044 all passed it. Doc: `ANDROID_NOTIFICATION_ICON.md`.

## 11. Builds cut today

| build | run | contains | status |
|---|---|---|---|
| 1042 | 30818147074 | char repair + 44px send + icon | superseded |
| 1043 | 30837299201 | + multiline, disc, completion panel | superseded |
| **1044** | **30842007275** | + auth guard | **UPLOAD THIS** |

Play "What's new" for any of them: `Bug fixes and improvements.` — nothing else.

## 12. Techniques that worked today (details in START_HERE §4 / runbook)

- Supabase SQL WITHOUT the dashboard UI: localStorage access token as Bearer
  + `x-connection-encrypted` = `connectionString` from
  `GET api.supabase.com/platform/projects/<ref>` → POST
  `/platform/pg-meta/<ref>/query`. Works from a hidden tab. Rehearse
  BEGIN/ROLLBACK in ONE body.
- GitHub in a hidden tab: dispatch full event chains
  (pointerdown→mousedown→pointerup→mouseup→click) on buttons;
  `form.requestSubmit(btn)` for PR create/merge; read CodeMirror back via the
  undocumented `.cm-content.cmTile` walk; verify bytes via
  api.github.com `?ref=<sha>` + `crypto.subtle.digest`, never raw.githubusercontent.
- Rendering harness: temp `mention-harness.{html,tsx}` + vite on :5199 +
  `/tmp/node_modules/playwright-core` with
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; ALWAYS delete the
  harness before staging (`git status` must be clean of it).
- Build-log reading: navigate the tab to
  `/commit/<full-sha>/checks/<job-id>/logs`, classify echo-vs-output by the
  nearest `##[group]`/`##[endgroup]` above each line.
- `pkill` in a compound Bash line can kill the whole shell (exit 144) BEFORE
  later commands run — run pkill last/alone and re-check what didn't execute.
- GitHub sometimes replaces a JS-set commit message with its AI suggestion
  (happened on the 1043 trigger commit: "Release Build 1043 with UI
  improvements..."). Content was byte-verified; treat message as cosmetic,
  verify content always.

## 13. Open items (decisions/backlog — do NOT do unasked)

1. Type-scale fix (§2) — needs owner approval on before/after screenshots.
2. New-post push honours "in-app only"? One trigger line; changes what 12
   handsets receive. `NOTIFICATIONS_SYSTEM.md` §8.
3. Brand-name boundary (`auth.continueApple`, `csub.uploadNote`).
4. jarsigner byte-check on 1044 before store upload (offered, not run).
5. Emoji picker + `:` emoji suggestions in comments — designed, owner never
   said go.
6. Tier-1 font plumbing (fallback stack, drop Lora, `<link>` loading) —
   designed, not approved.
7. Phone-only verifications pending on 1044: keyboard suggestion strip,
   Enter=newline, one end-to-end comment post, blank-page verdict.
