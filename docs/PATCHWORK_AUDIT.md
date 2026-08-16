# Where I patched instead of designing — 2026-08-15

Written because the owner asked for it in those terms, after finding that a post
opened from his wall rendered a second, older implementation of the card I had
just changed:

> "you are not maintaing one funnel - that is again creating issues multi funnel
> for same result... Again damaging rule established"
>
> "mark if anything more you have done mistake like this way like a patch work
> not a systemic product planning"

Every item below is a place where I changed the thing in front of me without
asking what else shares its job. They are listed whether or not they have been
fixed, and the ones still open are marked OPEN.

---

## 1. The post card had two implementations. FIXED, LIVE.

I changed `PostCard` — reach/views onto the photo, reactions to the right — and
never asked **who else draws a post**. `src/pages/PostDetail.tsx` held ~150 lines
that drew the same post a second way: its own header, media, counts row,
ReactionPicker, `displayEngagement` call and caption.

The cost was never tidiness. Every change had to be made twice, and when it was
not, the same post read one way in the feed and another way when opened. The
caption there never even got `break-words`, so a one-word caption was still
being sliced off the edge on that screen hours after it was fixed everywhere
else.

`PostDetail` is now page chrome plus `<PostCard>`.

## 2. The audit I gave him was itself a guess. CORRECTED HERE.

Immediately after being told off for not thinking systemically, I told him the
remaining duplicates were `WallPosts.tsx`, `ProfileStories.tsx` and
`AdEngagementBar.tsx` — a list produced by grepping for two import names and
never opening the files.

**`WallPosts.tsx` renders `<PostCard>` (line 1969). It was never a duplicate.**

The same failure, inside the message diagnosing the failure. The real remaining
surfaces are listed in §7, and this time they were opened and read.

## 3. `hidden sm:inline` on reach/views — a symptom fix. SUPERSEDED.

The figures were being sliced at 360px, so I hid the words on phones. It worked
and it was the wrong question. The row was fragile because those figures are
computed AFTER the card paints, so it reflowed under the member's thumb — which
is what he reported hours later as "reactions shifting". Moving them off the row
entirely was the design fix; the width fix only made the symptom smaller.

## 4. `.npmrc legacy-peer-deps=true` — a hold, not a cure. CLOSED 2026-08-16.

> **Numbering note.** In conversation with the owner this was **"item 3"** and
> §6 below was **"item 5"** — the spoken list skipped the already-closed
> entries. Same work, two numbers. Recorded so neither list reads as a
> different job.

`react-day-picker@8` peers on React ≤18, so every clean install failed after the
React 19 upgrade. The flag made the resolver permit it.

**The cure, applied: react-day-picker 8.10.1 → 10.0.1**, whose peer range is
`react: >=16.8.0`. **`.npmrc` is deleted.**

- **v9 was rejected on measurement, not taste.** 9.14 hard-depends on
  `date-fns-jalali` *and* a hijri converter; v10 carries only `date-fns` +
  `@date-fns/tz`. Fewer bytes to a member on mobile data.
- **Proved, not assumed:** `package.json` + `package-lock.json` copied to an
  empty directory with **no `.npmrc`**, `npm ci` run there → exit 0, zero
  ERESOLVE.
- **Bundle cost: none.** 439.44 kB gzip before → 439.42 kB after.
- **`security.yml` still passes.** Its gate is
  `npm audit --omit=dev --audit-level=critical`; re-run after the upgrade → exit 0.
- **Both lockfiles regenerated** — `package-lock.json` *and* `bun.lock`, the one
  Cloudflare actually installs from. §5's whole lesson.

**The trap this migration walked into, and why the harness earned its keep.**
v9 renamed *every* `classNames` key and moved the DOM the classes land on.
`classNames` is a partial record, so a key that is not renamed does not throw
and does not fail typecheck — it is silently ignored and that part of the
calendar renders as unstyled browser default. Typecheck passed on the first
attempt. **The screenshot did not:** month/year dropdowns gone, both nav arrows
stacked in the top-left corner, the selected day unhighlighted. Two harness
scenes (`calendar-plain`, `calendar-dob`) were added *before* the upgrade so
the before and after could be compared as pixels.

The one structural change worth knowing: in v8 the state class (`day_selected`,
`day_today`) landed on the **button**; in v10 it lands on the **cell**, and the
button is a separate child. `[&>button]:…` is how the cell reaches its button.

Two lockfile lessons banked on the way:
- Regenerating `package-lock.json` from scratch **dropped 103 entries** — every
  one a per-platform optional binary (`@esbuild/*`, `@img/sharp-*`, rollup) —
  making the lockfile machine-specific. Reverted; a targeted
  `npm install react-day-picker@10.0.1` changed **2 entries and removed none**.
- `svgo` is absent from both lockfiles (an *optional* peer of
  `vite-plugin-image-optimizer`), so SVGs ship unoptimised. **Pre-existing, not
  caused by this change** — the build warns and exits 0. Left alone deliberately:
  adding a dependency days before an Android build is the kind of quiet change
  that causes the next outage. Logged here so it is not lost.

## 5. One upgrade, two lockfiles, neither updated. FIXED, but no process exists.

The React 18 → 19 upgrade changed `package.json` and updated **neither**
`package-lock.json`'s resolvability **nor** `bun.lock`, which still pinned
React 18. npm's failure broke CI and the Android build; bun's broke the WEBSITE,
which stopped deploying for nine hours without anyone noticing.

**CLOSED 2026-08-16 as a process too.** `cleanInstallResolves.test.ts` now
covers **both** lockfiles: it parses `bun.lock` (stripping its trailing commas)
and fails if any manifest range disagrees, in either direction. A third
lockfile appearing in the repo also fails the test, because an unchecked
lockfile is exactly how the website went dark. Proved by the v10 upgrade above:
the test caught `bun.lock` still pinning v8 before it could reach Cloudflare.

## 6. The comment stripper — fixed in 3 files, left in ~30. CLOSED 2026-08-16.

> Called **"item 5"** in conversation with the owner. See the numbering note in §4.

`src/test-utils/sourceText.ts` exists because a naive regex treated
`accept="image/*"` as the start of a block comment and deleted ~400 lines of the
file two tests then asserted against. I migrated the two that were failing and
one of mine. **About thirty other test files still carried their own copy of the
broken regex.** They were green for the same reason those two were green for
weeks: luck about which `*/` came next.

**Done: 41 chain sites across 33 files** now call `stripComments()`. Landed in
nine commits (`test: use the safe comment stripper (1/9)` … `(9/9)`) and every
file verified with `git hash-object` against `git rev-parse origin/main:<path>`.

Two things worth recording, because both were mistakes:
- **Automating this failed twice.** A first pass deleted the chain outright; a
  second wrapped it with a regex and broke four files. The third used a
  backward bracket-balancing parser and four files still needed hand-fixing —
  two imports landed *inside* a multi-line import block, one `return` was
  swallowed, one file had a local `stripComments` the insert shadowed.
- **Green is not proof.** Two migrated tests were mutated destructively
  (`WallPosts` `space-y-0`→`space-y-4`; `Navbar` `bg-background/80`→`/10`) to
  confirm the alarms still fire. Both caught. A migration that silences a test
  looks identical to one that works.

## 7. Surfaces that draw engagement outside `PostCard`. CLOSED — ruled 2026-08-15.

**Owner's ruling, 2026-08-15: "keep separate".** None of these is a post, and
forcing them through `PostCard` would be dogma rather than design — a story has
no caption to render, an advertisement has no author to name.

The ruling is recorded IN THE GATE (`src/__tests__/onePostFunnel.test.ts`), not
only here, so the next person to ask the question finds the answer in the same
place the rule is enforced. **The list is now closed:** a new surface that draws
engagement fails the test until someone rules on it in writing.

Three of these — `EntryDetail.tsx`, `Journal.tsx`, `MyPhotos.tsx` — were found
BY that census on the day it was written. Nobody had ever named them. That is
the whole failure of §1 repeating in miniature, caught this time by a machine
instead of by the owner on his phone.

| file | what it draws | ruling |
|---|---|---|
| `src/components/ImageEngagement.tsx` | likes/comments on a single photo | SEPARATE |
| `src/components/EngagementFooter.tsx` | a generic footer | SEPARATE |
| `src/components/EntryCard.tsx` | a competition entry | SEPARATE |
| `src/components/CompetitionLightbox.tsx`, `Lightbox.tsx` | fullscreen viewers | SEPARATE |
| `src/components/profile/ProfileStories.tsx` | stories | SEPARATE |
| `src/components/ads/AdEngagementBar.tsx` | an advertisement | SEPARATE |
| `src/pages/Journal.tsx`, `EntryDetail.tsx`, `MyPhotos.tsx` | consume the above | SEPARATE |

## 8. The gate that would have prevented all of §1. OPEN — not built.

A lint rule, in the same style as the repo's existing `audit-v6` rules:

> **no file outside `src/components/post/` may import `ReactionPicker` or
> `displayEngagement`** unless it is on a named allowlist with a written reason.

That turns "one funnel" from something I have to remember into something the
build refuses to let through. Until it exists, §1 can happen again on the next
change, and the only thing standing between the project and a third copy of the
post card is my attention — which is precisely what failed.

## 9. Findings from the screenshot sweep. CLOSED 2026-08-16.

Controls under the 44px tap minimum on feed, wall, post and settings, plus one
avatar that does not decode.

**Done 2026-08-15:** the header **Search** button was a bare 16×16 glyph with no
padding at all — on EVERY signed-in screen, because it is in the shared header.
Now `min-h-11 min-w-11`. One control, four screens.

**Done 2026-08-15, after the owner's instruction:** the header **notification
bell** was 34×34 and could not be enlarged — at 44px, and even at 40px, its ring
COLLIDED with the centred wordmark; "50mm Retina World" ran into the circle at
360px, photographed twice. The invisible-hit-area alternative is the one he
called "fraud, button same size as before" (2026-08-03).

He resolved it in five words: *"from the notification remove round circle"*. With
the ring gone the button reaches 44×44 without touching anything, and it now
matches the Search control beside it. **Both shared-header controls are fixed on
all four screens.** Feed findings: 29 → 27.

### CLOSED 2026-08-16 — **63 screenshots, 0 problems** across the whole harness.

Every remaining finding was measured before it was touched. Nothing was
silenced to get a green light.

**Controls that genuinely grew** (the box a thumb lands on is bigger, and the
sweep can see that it is — no invisible hit areas, per the owner's 2026-08-03
ruling on the bell):

| control | was | now | how the picture stayed the same |
|---|---|---|---|
| Settings switches (**24 findings**) | 44×24 | whole ROW ~300×64 | a `<label>` wraps the row, so the icon, title and description all toggle it — the iOS/Android Settings pattern. The switch is untouched. |
| Avatar link, feed + post detail | 32×37 | 44×44 | `p-1.5 -m-1.5` on the anchor. The photo is still 32px; the padding is pulled back out of the flow. |
| Carousel dots | 8×8, 6×6 | 44×32 | the dot moved inside a transparent button. Measured after: the dot's centre still sits **exactly 16px** above the image edge, as before. |
| Profile action row (all four) | 35 tall, two at 38/40 wide | 44×44 | raised all four, not only the two reported — three different sizes side by side is what made the small ones easy to miss. |
| Back to top (feed) | 32×32 | 44×44 | a floating button has nothing beside it to catch a near miss. |
| "Cookies" (shared footer) | 59×17 | 44 tall | `py-0 leading-none`, so the footer row does not grow. It was reported on **every screen**. |
| "See more", "Back", "View", login's back link | 16–17 tall | 44 tall | negative margins take the height back out of the flow. |

**Three checker CORRECTNESS fixes** — the checker was measuring the wrong
thing. Each is narrow, and each was proved by mutation:

1. **A control inside a ≥44px `<label>`.** Only for switches/checkboxes/radios
   and `<input>`, only for a real `<label>`, only when the label itself clears
   44px. Reverting the settings row to a `<div>` brings all 24 findings
   straight back, which is how we know it is the fix doing the work and not
   the exception.
2. **`display: inline` anchors.** The author's name inside a caption measured
   70×15 with a 21.1px line-height, so the existing shape test (|h − line| ≤ 4)
   missed it by 2px. Not a bad threshold: for an inline box, `getBoundingClientRect`
   returns the font's em box, which is a different quantity from the line box by
   definition. An inline anchor cannot take a height at all.
3. **Images that are not laid out.** The profile QR code reported
   `naturalWidth: 0` at 700ms, 2s and 5s — because it is in the desktop-only
   sidebar and a browser never decodes an image inside `display:none`. It was
   reported on both phone widths and neither desktop width, the exact inverse
   of a real broken photograph. A genuinely broken `<img>` IS laid out and is
   still reported.

**Score:** feed 29 → 0, profile 17 → 0, post detail 14 → 0, login 2 → 0,
notification settings 24 → 0.

---

## The pattern, stated plainly

In every item above I fixed **the instance in front of me** and did not ask
**what else shares this job**. That question costs one grep and one file open.
Not asking it cost, today: a website that stopped deploying for nine hours, a
build that would have failed the moment it was asked for, a post screen that
contradicted the feed on a live app, and an audit that was wrong in the same
message where I was apologising for being wrong.
