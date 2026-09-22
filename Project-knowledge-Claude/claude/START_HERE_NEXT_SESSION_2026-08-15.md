# Start here — 2026-08-15 handover

**OWNER'S STANDING ORDER:** finish audit items **3** and **5**, close the tail of
**6**, then cut the **final** Android build. Build #91 is a TEST build.

He also said: *"i told i trust you... dont ask me sooo many times which answer i
dont have, as i am a layman."* **Do not ask him technical questions.** Decide,
act, verify, tell him plainly what was done and what was not. Bring him only
product decisions he alone can make.

---

## ITEM 6 — nearly finished. Do the tail FIRST, it is small.

Findings today: **feed 29 → 10, profile 17 → 4, post detail 14 → 4, login 2 → 1.**

Fixed: header bell + search (both shared, so all four screens at once), composer
row, Add Photo, Add friend, album arrows, download, the post's own menu button.

The checker was also corrected twice, both written up in `tools/uishot/capture.mjs`:
- the rule is **44 in the long axis, 32 in the short** (owner-approved; this app
  already ruled that way for the post icons on 2026-08-10)
- **a line of text is not a tap target** — judged by SHAPE (an anchor holding
  only words whose box is one line high). Buttons are never skipped; the "See
  more" button at 52×16 is still reported, which is the positive control that
  the check was not simply switched off.

**What is left, and each needs a judgement, not a size bump:**
| finding | thought |
|---|---|
| avatar links 32×32 / 32×37 | the avatar is 32px BY DESIGN. Padding the link changes the row's layout. Decide: pad the link, or accept it. |
| carousel dots 8×8, 6×6 | indicators, not controls — Instagram's are the same. Probably belongs in the checker as a stated exception, like the two above. |
| "See more" 52×16, cookie 59×17, comment 49×16 | small text buttons. Real, and easy — give them `min-h-11`. |
| settings switches 44×24 (26 findings) | Radix Switch. Do NOT resize the switch. Make the whole ROW the target — that is the standard fix and it is what a thumb aims at anyway. |

## ITEM 5 — 20 test files on the naive comment stripper. **BY HAND.**
⚠ **AUTOMATED TWICE, REVERTED TWICE, ON PURPOSE.** Attempt 1 deleted the naive
`.replace(/\/\*[\s\S]*?\*\//g, "")` — the test then reads the file WITH its
comments and can pass by matching its own explanation, which is the exact bug
that started all of this. Attempt 2 tried to WRAP the read with `stripComments`
by regex; the 20 files have ~6 different shapes and it broke two of them
immediately.

Correct method, one file at a time:
1. Wrap that file's read with `stripComments` from `src/test-utils/sourceText.ts`.
2. Re-read every assertion in the file and confirm it still means what it claims.
3. Break one deliberately to prove the alarm still fires.

## ITEM 3 — react-day-picker v8 → v9.
`.npmrc` (`legacy-peer-deps=true`) is a HOLD, not a cure: v8 peers on React ≤18.
v9 supports React 19 and renames props on the Calendar component. Visible UI —
photograph the schedule date picker before and after. A test asserts the package
is still v8; that failure IS the reminder to revisit `.npmrc`.

## THEN the final build
Touch `ANDROID_BUILD_TRIGGER`. Before telling him it is ready, photograph
**feed, wall and post detail side by side at 360px** and confirm they are the
same card.

---

## Already done and GATED — do not redo
- `PostDetail` renders `<PostCard>` — one funnel, live and verified.
- Reach/views on the photograph (hover on web, FIRST TAP in the app);
  per-reaction icons right, total left.
- Header: no line, no borders on any control, Create/bell/search all bare
  glyphs, edge gaps measured at **26px both sides**, title centred on 360.
- Website deploys again (`bun.lock` had stayed on React 18 for nine hours).
- **Three gates**, all mutation-tested: no second post card
  (`onePostFunnel.test.ts`); no unruled engagement surface (owner ruled **"keep
  separate"** for stories, adverts, entries, lightboxes, journal, photos); both
  lockfiles must match `package.json` (`cleanInstallResolves.test.ts`).

## Traps
- **Cloudflare Pages installs with `bun`, not npm.** No Actions workflow for the
  web build until `web-build.yml` — check the commit's own status checks.
- `git push` 403s — transport via GitHub's web Upload UI, then verify each file
  with `git hash-object` vs `git rev-parse origin/main:<path>`.
- Bash `cwd` resets to `/home/claude` between calls. `cd` explicitly.
- A gate that runs after `node_modules` exists cannot see an install failure.

## The standing lesson
Before changing anything a member sees, ask **what else draws this**. One grep,
one file open. And measure the right thing: twice today a number was reported as
correct while measuring the wrong edge.
