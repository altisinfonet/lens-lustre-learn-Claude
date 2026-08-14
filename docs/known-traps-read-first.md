# Known traps — read before writing code

Every item here has already cost this project real time or a real outage. None
of them are theoretical.

---

## 1. `/cdn-cgi/image/` broke every photo for four days

**2026-08-01.** Post images were rerouted through
`https://50mmretina.com/cdn-cgi/image/...` — the **apex** host. Bandwidth fell
89%. It also broke every image for every `www` visitor and every Android user,
for four days, across builds 1035–1051.

Why it survived: **every test made from the apex passed.** The site runs on
`www`, and the Android WebView is a third origin entirely.

➡ **Read `src/components/post/PostMedia.tsx:89-130` before touching any image
URL.** A corrected transform layer already exists at `src/lib/cdnImage.ts`,
fully written and tested, with **zero importers** — read it before writing a new
one. It fixes both root causes (address the image's own host, never the apex;
per-image `onerror` fallback).

## 2. A component declared inside render eats keystrokes

Typing "Thanks" produced "sknaht". A component declared in a render body is a
new element *type* every render, so React unmounts and remounts its subtree, the
`<input>` is destroyed, and the caret returns to 0.

➡ Guarded by `src/__tests__/noComponentDefinedInRender.test.ts`. **The allowlist
is empty and must stay empty.** Do not add an entry to make a build green.

## 3. `CREATE OR REPLACE FUNCTION` cannot change returned columns

```
ERROR: cannot change return type of existing function
DETAIL: Row type defined by OUT parameters is different.
```

Adding a returned column needs `DROP FUNCTION` — inside `BEGIN … COMMIT`, so
there is no window where the function does not exist. **`GRANT EXECUTE` does not
survive a `DROP`**; re-grant explicitly or the feed goes blank for real users
while still working for the owner running the migration.

➡ The obvious rollback — re-running the previous migration — **fails the same
way**. Use the matching file in `supabase/rollback/`.

## 4. Returning `[]` on error is a lie that caches

`if (error) return []` reports failure to React Query as a **success** whose
value happens to be empty. With `staleTime: Infinity` that emptiness becomes
truth for the session. One dropped request removed all 46 categories; the same
shape made the feed announce "No posts yet" to a member on a weak signal.

➡ **Throw.** An error is retried; an empty success never is.

## 5. `has_table_privilege` lied about what `anon` can read

Three catalog checks disagreed about whether logged-out visitors could read
`profiles_public_data`. Two said no. A real request with the public anon key
said **yes, 200 OK, real names**.

➡ For "can this role read this", **test the request the client actually makes**,
not the catalog.

## 6. Adding one npm dependency mass-upgrades the tree

`npm install <anything>` regenerated the lockfile and pulled **414 new packages,
removed 122, changed 193** — a whole-tree upgrade of a live site riding along
with an unrelated change.

➡ Pin versions in the workflow instead, or budget the upgrade as its own
reviewed change with its own build.

## 7. Unpinned dependencies broke the Android build with no code change

`@capacitor/cli` raised its Node floor to 22. The workflow installed it unpinned
and ran Node 20, so the build died at `npx cap add android`. Nobody had changed
anything.

➡ Versions are now pinned in `.github/workflows/android-build.yml`, with a step
that fails the build if a pin did not take. **An upgrade should be a decision,
not a date.**

## 8. A test pinned to a superseded file passes forever

`feedFreshness.test.ts` asserted a SQL guard was present — against a **hardcoded
path to a migration that had been superseded twice**. The guard was absent from
production for 8 days with the test green.

➡ Tests that read migrations must **find the newest definition at run time**.

## 9. Mixing absolute and delta updates double-counts

One reaction fires **two** realtime events: a `post_reactions` delta (+1) and a
`posts` UPDATE carrying the absolute total. Apply both and every like counts up
by two whenever the absolute lands first.

➡ **One writer per field.** Counters come from `posts` (absolute); only the
per-type breakdown comes from `post_reactions`. Shared in
`src/lib/feed/realtimeCounts.ts`; both callers asserted in their own source.

## 10. A blurred decorative layer downloaded 14.7 MB

The feed backdrop fell back to the full 2560px original when a post had no
stored thumbnail — `loading="eager"`, viewport ignored — to blur it into mush.

➡ A backdrop is **never** worth the original. If there is no cheap source,
render no backdrop.

## 11. Two modules were dead for weeks with green tests

`CreatePostModal.tsx` and `gallery.ts` were written, tested, reviewed, merged —
and imported by **nothing**. Vite tree-shook them out of the bundle.

➡ A green suite proves a module works, not that anything renders it.
`nativeGalleryWired.test.ts` now asserts a non-test importer exists.

## 12. A zero-width flex child moves its neighbour to the middle of the bar

Build 1086 shipped the app's `+ Create` button sitting **in the centre of the
top bar, on top of the wordmark**. Nothing set its position.

The bar is `justify-between`. In the app the logo `<Link>` collapses to **zero
width** — its `<img>` and its wordmark are both `hidden lg:*`. Three flex
children with a zero-width first one spread as
`[nothing] … [+ Create] … [actions]`.

➡ Group things that belong together in **one wrapper** so they are one flex
item. Guarded by `NavbarCreateButtonPlacement.test.ts`.

➡ **A layout claim needs a measurement.** The fix was verified in a headless
render before shipping: button 24px→61px, wordmark starts at 69px. "It looks
right in the markup" is what shipped 1086.

## 13. A second lookup for data you already fetched

A verified member's blue tick was missing. The badge row existed, RLS was
`USING (true)`, and a real anonymous REST call returned it — the data was
never the problem.

The tick came from a **second, per-name request fired at render time**, while
the query that built that line had already fetched those profiles *with their
badges* and discarded them. `author_badges` had been computed by every feed,
wall and hashtag query for months and **no caller ever read it**.

➡ **If you already have it, carry it.** Badges now travel on the post, like
`author_name`. Two requests for one line of text means one of them can fail,
race, or return empty on its own.

➡ Same shape as the "names showing as ?" bug. When a value can be missing while
the thing next to it is present, ask what **second** request it came from.

## 14. A test that cannot fail is worse than no test

The tagged-name tick was reported as done. Its test asserted the names and the
count and said so in its own comment: the assertions *"do not depend on the
badge resolving at all"*. A verified member and a completely broken tick
produced the **same DOM**, and the suite was green either way.

➡ Assert **the claim**, not the neighbourhood of the claim. `TaggedPeopleVerifiedTick.test.tsx`
now checks the tick in the DOM, including one case with the lookup **forced to
return nothing**.

➡ Note this is trap #8 again in a new costume. It is the most expensive habit
in this repository.

## 15. Radix `Tooltip` throws without a `TooltipProvider`

It does not degrade to a plain glyph — it throws
``` `Tooltip` must be used within `TooltipProvider` ```
and takes the subtree with it. The app supplies one high in the tree, so this
only bites in tests and in any subtree rendered outside it.

➡ A render test touching a badge, tick or tooltip needs `<TooltipProvider>` or
it is testing its own harness.
