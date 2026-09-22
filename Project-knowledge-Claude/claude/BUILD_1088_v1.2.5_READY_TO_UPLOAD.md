# Build 1088 / v1.2.5 — green, replaces the halted 1086

**Run:** Android Build **#88** · commit `c7c591b` · **Success**, every step
https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31772341968

**versionCode 1088** · **versionName 1.2.5**

⚠ **Do not ship 1086.** It was halted in Play. #87 was cancelled (a duplicate
my version-bump commit fired). **#88 is the only one to use**, and it has the
highest versionCode so Play will accept it.

## Artifacts

| Artifact | Size | Use |
|---|---|---|
| `app-debug-apk-SIDELOAD-THIS` | 13.85 MB | Install on the phone first |
| `app-release-aab` | 8.42 MB | Upload to Play after the phone check |

---

## The two defects reported on 1086 — both fixed

### 1. `+ Create` is in the LEFT corner, icon only, no caption

The cause was **layout, not a coordinate**. The bar is `justify-between`, and
in the app the logo `<Link>` collapses to **zero width** — its image and its
wordmark are both `hidden lg:*`. Three flex children with a zero-width first
one spread as `[nothing] … [+ Create] … [actions]`, which parks the button in
the centre, on top of the wordmark.

Logo and button now share **one wrapper** = one flex item, pinned left.

Measured in a headless render *before* shipping:

| | button starts | button ends | wordmark starts | overlap |
|---|---|---|---|---|
| Build 1086 | 125px | 162px | 69px | **yes** |
| Build 1088 | **24px** | 61px | 69px | **no** — 8px clear |

The "Create" caption is gone. The name is on `aria-label`, so screen readers
still announce it, and the box is 36px so the tap target stays finger-sized.

### 2. The blue tick now shows for verified members — tagged **and** author

Checked against production **before** writing any code:

- `user_badges` holds `verified` for the account in the screenshot
- RLS is `"Anyone can view badges" USING (true)`
- a real anonymous REST call returns it: `200 [{"badge_type":"verified"}]`
- the tag row points at the right user id

So the data was always reachable and the component was always correct. What
failed was the **lookup between them**: the tick came from a *second*,
per-name request fired at render time, while the query that built that very
line had already fetched those profiles **with their badges** and thrown the
badges away.

Author and tagged name go through the **identical** path, so this was never
tagged-only — `author_badges` has been computed by every feed, wall and
hashtag query for months and **no caller ever read it**.

Badges now travel **with the post**, the same correction as the author-name
fix. "Name visible, badge missing" is no longer a state this app can be in.
The old lookup stays as a fallback so an unmigrated caller cannot silently
lose a tick.

> ⚠ **Why this was reported as done when it was not.** The tagged-people test
> asserted the names and the count, and said in its own comment that the
> assertions "do not depend on the badge resolving at all". A verified member
> and a broken tick produced the same DOM, and the suite was green either way.
> That is **trap #8**. There are now 5 tests that assert the tick in the DOM,
> one of them with the lookup **forced to return nothing**.

---

## Also in this build — everything 1086 carried

- Feed no longer runs out of memory on a long scroll (cards unmount ~2 screens away)
- 14.7 MB blurred backdrop removed; LQIP no longer falls through to the original
- `maxPages: 5` — React Query stops retaining every page ever fetched
- Author names and avatars arrive with the post (RPC returns 15 columns, not 11)
- Realtime 9 bindings → 5; one writer per counter, so counts cannot drift
- A weak signal no longer shows "No posts yet" or "no drafts"
- Comment typing no longer reverses the text
- Capacitor pinned, Node 22

## Gates

Security gate 0 critical / 0 high → typecheck → **1,345 tests** → web build →
Capacitor pin verification → APK content proof → AAB. No failed or skipped steps.

---

## Check these on the phone before promoting

1. `+ Create` is in the **left corner** and does not touch the wordmark
2. A verified member shows the tick — **as author AND as a tagged name** in "with X"
3. Scroll the feed hard and back: no blank cards, no scroll jump
4. Type and edit a comment; categories and contributor score render
5. Like a post — the count moves by exactly one

## Still NOT in this build

- The Instagram-style in-app photo picker — picker screens unchanged
- The image derivative pipeline — phones still download originals
- Resumable / chunked uploads
