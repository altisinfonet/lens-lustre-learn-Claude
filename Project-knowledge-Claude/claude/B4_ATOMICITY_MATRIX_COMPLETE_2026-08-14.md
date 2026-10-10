# B4 Multi-media Post Atomicity Matrix — COMPLETE (2026-08-14)

Reconciler: READY. Suite 1534 passed. Matrix doc: `docs/multi-media-post-atomicity-matrix.md`. Harness + transcripts: `harness/b4/`. Regression lock: `src/__tests__/postAtomicity.test.ts` (9 assertions, all mutation-verified).

## What this was
The FINAL PLAN puts a gate in front of B4: *no half-publish, no duplicate post, no duplicate reference, no duplicate object, no orphans*. I built a faithful local replica of the database and **ran** 20 scenarios against it — including four with two real sessions racing each other — instead of reasoning about them on paper.

## Two real failures found, both fixed

**Duplicate posts (live, member-visible).** Two identical submits at the same instant — a double-tap on a slow connection, or the same post from two devices — **both went through**. The duplicate guard asked "does one already exist?" and neither submission could see the other yet. Measured: 2 identical posts. Fixed with a lock scoped to that member and that exact content; re-ran the same race and got 1 post with the second correctly refused. Confirmed a different member posting at the same moment is not slowed down at all (1.1s vs a 3s lock).

**Takedowns (latent, matters at B5).** A photo taken down while a post was being published stayed on that post. Fixed: the publish now holds the photo while it checks, and a takedown removes the photo from every post showing it in the same breath. Also closed: the same photo could appear twice in one carousel.

Both shipped as production migrations with rollbacks (`20260814234152`, `20260814234206`). Pre-flight and post-verify recorded; 210 posts untouched.

## Client-side improvement (rides the next build)
A post that failed on photo 3 of 5 used to throw away the photos that *had* uploaded — the retry sent them again under new names, wasting the member's data and leaving the first copies as junk. Now the retry reuses them.

## Three mistakes of mine, caught and recorded
1. My own test suite blocked my migration for not *stating* its permission posture (verified first: no actual hole was opened).
2. I found an error-code collision I introduced in the image-ladder cycle — two codes each meaning two different things, which would make a support report ambiguous. Renumbered and registered.
3. I wrote the rollback files into a directory I invented, and my own test asserted my invention rather than the project's convention — so it passed while the reconciler correctly reported the rollbacks missing. Moved, and added a test that the invented directory cannot come back.

## Deliberately left open
**R15 — partial reference set.** The design's final publish check ("every photo present before the post goes live") needs a `status` column on posts that does not exist yet. Nothing writes those tables until B5, so there is nothing to break today. Recorded as a B5 requirement rather than quietly passed.

## Owner queue (unchanged, all still blocked on Neil)
App build trigger · repo attach for push (56 commits local) · bugs list → Phase F · Razorpay sandbox creds → W1 · admin clicks (orphan scan, purge dry-run, thumbnail backfill, dims dry-run).

B5 itself needs design decisions from the owner before it can start (client switch behind a flag, backfill of 210 posts, authorized media delivery, CDN cache invalidation) — that is the next engineering phase, not a coding task I can begin unilaterally.
