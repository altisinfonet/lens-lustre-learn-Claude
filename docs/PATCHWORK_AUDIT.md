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

## 4. `.npmrc legacy-peer-deps=true` — a hold, not a cure. OPEN.

`react-day-picker@8` peers on React ≤18, so every clean install failed after the
React 19 upgrade. The flag makes the resolver permit it. The cure is
**react-day-picker v9**, which supports React 19 — a small migration on the
Calendar component, with visible UI that should go through the screenshot
harness. The `.npmrc` says so in its own comment and a test asserts the package
is still v8, so the day someone upgrades it, the question gets asked.

## 5. One upgrade, two lockfiles, neither updated. FIXED, but no process exists.

The React 18 → 19 upgrade changed `package.json` and updated **neither**
`package-lock.json`'s resolvability **nor** `bun.lock`, which still pinned
React 18. npm's failure broke CI and the Android build; bun's broke the WEBSITE,
which stopped deploying for nine hours without anyone noticing.

Fixed, but **OPEN as a process**: nothing checks that every lockfile in the repo
agrees with the manifest. `src/__tests__/cleanInstallResolves.test.ts` covers
npm only. It should cover `bun.lock` too.

## 6. The comment stripper — fixed in 3 files, left in ~30. OPEN.

`src/test-utils/sourceText.ts` exists because a naive regex treated
`accept="image/*"` as the start of a block comment and deleted ~400 lines of the
file two tests then asserted against. I migrated the two that were failing and
one of mine. **About thirty other test files still carry their own copy of the
broken regex.** They are green today for the same reason those two were green
for weeks: luck about which `*/` comes next.

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

## 9. Twelve findings from the screenshot sweep. OPEN.

Controls under the 44px tap minimum on feed, wall, post and settings, and one
avatar that does not decode. Reported by `npm run ui:shot`, never triaged. They
are in Android build #90.

---

## The pattern, stated plainly

In every item above I fixed **the instance in front of me** and did not ask
**what else shares this job**. That question costs one grep and one file open.
Not asking it cost, today: a website that stopped deploying for nine hours, a
build that would have failed the moment it was asked for, a post screen that
contradicted the feed on a live app, and an audit that was wrong in the same
message where I was apologising for being wrong.
