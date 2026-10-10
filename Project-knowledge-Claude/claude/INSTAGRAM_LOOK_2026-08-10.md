# The Instagram pass — what changed, and the two rules that now hold it. 2026-08-10, night.

`main` = **`79860a0`** · Android Build **#64 ✅** = **versionCode 1064** ·
**1063 is superseded — do not upload it.** Web live and measured.

The owner listed six bugs off his phone, then twice more that "Entire App and
website both fonts are extremely big. Match with Instagram exactly." Everything
below was measured on the live site before and after.

---

## What he asked, and what it turned out to be

| His words | The actual cause | Where it was |
|---|---|---|
| "I told No border anything to anywhere... didnt do it it" | PostCard had been made full-bleed. **Four other things in the feed had not** | the composer, the sponsored ad, People-you-may-know, and PostCard's own `md:border` |
| "Add Friend will smaller font" | It was `text-[9px]` — but the 12px floor raised it, **and it was UPPERCASE with 0.1em tracking** | `PostCard.tsx` |
| "Sponsored Ads are coming lower size" | The ad sat inside `.container`'s 90% with its own border while the posts ran edge to edge | `AdZone.tsx` `ZONE_FRAME["story-card"]` |
| "Dont Wrote News feed, your feed etc on the Top, refresh icon" | A "NEWS FEED" eyebrow + `Your Feed` h1 + a RefreshCw button | `Feed.tsx:254-273` |
| "icons are big unparral" | 24px icons in **48×48** boxes (Instagram uses ~44 wide), and the chosen-reaction emoji sized by `text-2xl` painted ~30px — taller than the icons beside it | `PostCard.tsx`, `ReactionPicker.tsx` |
| "Entire App and website both fonts are extremely big" | **Not the sizes.** See below |

## The font finding — the important one

Measured on the live feed, 186 visible text elements:

```
16px  21   ← all of them the reaction emoji at text-base
14px  30
13px  24
12px 110   ← 59%, written at 9/10/11px and raised by the readability floor
24px   1   ← the "Your Feed" heading
uppercase with >0.5px tracking: 25
```

Instagram's body text is **14px** and its small text is **12px** — the same
numbers this site already used. **The pixel sizes were never the problem.** A
capital is as tall as the font's cap height rather than its x-height, so 12px of
capitals carries the visual weight of about 16px of normal text, and 0.3em of
tracking stretches it roughly a third wider again. That is why two earlier
rounds of shrinking individual components had not fixed it.

Offered three options, the owner chose **remove the capitals and the wide
letter-spacing site-wide, and leave every font size alone**. That is the only
answer that satisfies both of his instructions from the same day: text reads
smaller without any of it becoming harder to see, and the 12px readability
floor from this morning is untouched.

After deploy, same page, same measurement: **uppercase 0 · wide-tracked 0**, and
the 21 oversized emoji became 15px.

### The block that does it
End of `src/index.css`, after the readability floor:

```css
[class*="uppercase"] { text-transform: none; }
[class*="tracking-["], .tracking-wide, .tracking-wider, .tracking-widest {
  letter-spacing: normal;
}
```

`uppercase` appears **1,637 times** in `src/` and the wide-tracking utilities
about 1,700 more. Rewriting them is the bulk modification this project forbids.
This is one block; **undoing it is deleting the block.** `tracking-tight` and
`tracking-tighter` are negative and belong to the display headings — deliberately
untouched. Text only ever gets NARROWER, so nothing that fitted can overflow.

## The post is now Instagram's shape

Shown both orders and asked to choose, he took Instagram's exactly:

**photo → one icon row with each count beside its icon → "\<name\> caption" → comments**

That collapsed **two rows into one** — there used to be a counts row, then a
horizontal rule, then a row of bare icons. The rule is gone with the other
borders. Every tooltip moved with its number; none was dropped. Counts still
disappear at zero.

Measured live: three buttons **44 × 48**, icons **24 × 24**, all at the same y —
which is what "unparral" meant. **The 48px height is the fix for "too small /
hard to tap" and must not shrink.** The chosen-reaction emoji now sits in a
fixed `h-6 w-6` box at 20px so it occupies the identical square as the outline
icons.

He was offered the removal of the Suggested pill, the reach/viewed line and the
privacy globe, and answered **"Nothing — keep all three."** He also chose to
**keep the emoji reactions** rather than replace them with a single heart.

## Feed ad — and the admin text that was wrong

`ZONE_FRAME["story-card"]` is now `bleed-phone … border-b border-border`: full
device width, no box, hairline underneath, 4:5 media as before.

The admin guidance said *"1080 × 1350, tall (like a phone photo). Make it tall,
not wide."* — which invites 1080 × 1920 into a box that crops to 4:5 and loses a
third of the picture. It now says 4:5, states that it runs edge to edge with no
border, and names what happens to a picture of the wrong shape.
**`AdminAdsV2.tsx` ZONE_GUIDE and `AdZone.tsx`'s `aspect` must stay in step.**

## Guarded by

* `src/components/post/__tests__/PostFullBleedAndTapTargets.test.ts` — rewritten.
  18 tests: no box anywhere, Instagram order (asserted by comparing the SOURCE
  POSITIONS of the media / actions / caption / comments sections), counts beside
  icons, tooltips kept, 48px height kept, emoji in the same box as the icons.
* `src/__tests__/instagramChrome.test.ts` — new. 21 tests: no feed title, no
  refresh button (and PullToRefresh still present, because deleting the button is
  only safe while it is), nothing inset, composer shaped like a post, icons-only
  bottom bar, the admin ad text, and the no-capitals rule.
* Four mutations were run against each set and every one turned red.

## Traps hit again tonight, both already in the master list

1. **A JSX comment as the first child of `{cond && ( … )}`** broke `vite build`
   in `WallPosts.tsx`. vitest passed. **Run `npx vite build`, not just the tests.**
2. **A source-scanning test read its own documentation** — the new block's prose
   names `tracking-tight` and quotes font sizes, so the assertions failed until
   comments were stripped AND `lastIndexOf` was used, because the phrase
   "INSTAGRAM TYPE" also appears in the comment that points at the block.

Third, new, worth recording: **committing through GitHub's web UI and navigating
away in the same batch silently loses the commit.** Eight uploads reported a
successful click and none of them landed. Wait after the click, then verify with
`git show origin/main:<path> | cmp -s -` before moving on.

## Still open

* Whether the type now matches Instagram on his phone — he has not seen 1064 yet.
* N3 duplicate skeleton (not reproduced), P4 vulnerabilities (needs his answer),
  P12, P10, P9, home TTFB ~1.6s, gallery tiles oversized, hosting 404.
* `Index.tsx:931` still renders a "Your Feed" card title on the HOME page. That is
  a different surface from the feed screen and was left alone deliberately.
