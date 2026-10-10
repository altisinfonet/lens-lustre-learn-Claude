# My Wall layout — FINAL — and the scope of the next build (2026-08-15)

`origin/main` = **`5d53483`**. All 9 files verified byte-identical. Suite **1,672 passing**, 1 skipped.

---

## The layout, after three rounds

The owner rejected two builds. The rejections ARE the design, so they are quoted in the source:

| Round | What was built | Verdict |
|---|---|---|
| 1 | Plain Instagram grid — identical squares forever | *"that will be copy of instagram"* |
| 2 | 3 squares + 1 full-width photo **at its own real shape** | *"not approved as long vertical block found. only horizontal block after three samll block is approved"* — a portrait photo at its own shape is a tall block |
| 3 | 3 squares + a band that is **always 3:2** | *"1-2-3 then 3:2 style is final"* ✅ |

`SHOWCASE_ASPECT = 3 / 2`, fixed. A photo that is not 3:2 is **never cropped** to fill it — shown whole and centred, with a blurred copy of its own thumbnail filling the rest.

**Why the fixed band is also the better engineering answer, not just the instruction:** measured on production the same day, **129 of 210 posts carry no dimensions in their filename**, and **0** are rescued by their thumbnail. A self-sizing band would have had to guess or reflow for 61% of the wall. A fixed band has nothing to look up and cannot jump while loading.

**Wall only, never the feed** (owner: *"please notte this style only for my wall section like instagram not for feed"*). Already true via `composerOnly`; now held by three tests, one of which was proved by rendering the grid outside the guard and watching the suite fail.

---

## Three real defects the screenshot sweep caught

1. The showcase's blurred backdrop had no `onError` — a 404 thumbnail left a permanently broken `<img>`. Invisible in a screenshot because it is blurred and `aria-hidden`, which is exactly why it had to go.
2. `fetchPriority` is a **React 19** prop. On React 18 it warns on every render and the attribute never reaches the DOM. Removed here. **The same call is in `src/components/post/PostMedia.tsx` and is warning in the feed today — reported, not quietly changed.**
3. A 36px button, on an earlier run.

## Two faults in the CHECKER itself — both fixed, both positive-controlled

- **Clipped-content used the wrong ruler.** `scrollWidth` includes a transformed descendant's box, so a deliberate `scale-125` blurred backdrop reported "clipped content +45px" with no text cut at all. Now measured with a `Range` over the element's own text nodes.
- **Lazy images were judged before they could load.** `fullPage` screenshots do not trigger `loading="lazy"` below the fold; 15 good photographs were reported "not rendered". The sweep now scrolls, returns to the top, and waits for images to settle (bounded 8s).
- **Positive control for both**, because a checker that stops complaining looks exactly like a checker that has gone blind: a 47-character unbroken word in a 120px box, and a missing image 4,000px below the fold. Both reported at all three widths. Scene removed.

## A mistake that nearly published a false claim

The first mutation harness for the grid was a shell function that **never passed its arguments to python**. Every mutation applied nothing, and all seven runs reported 17/17 passing. That would have been reported as "all mutations caught". It was noticed only because python printed an `IndexError` next to a green result. The harness now prints `mutated ok` per mutation and asserts the target string exists.

---

## Agreed scope for the next build

Owner, asked whether to build now or wait: **"whole shopwroom with signout recorder"**.

So the build waits for all of:

| # | Item | Owner input needed |
|---|---|---|
| 1 | **Session-loss recorder** — the cause of every sign-out | none |
| 2 | **`activity_logs` flood** — one row per real sign-in, not ~60 | none |
| 3 | **Token refresh exempt from the 25s abort** | none |
| 4 | **Instagram-style upload composer** — preview, crop overlay, reorder, Next | none |
| 5 | **Trigger the build** — bump `ANDROID_BUILD_TRIGGER`; the workflow fires on any push touching it | owner uploads the AAB to Play |

**The recorder is why this ordering matters.** Nothing in the app records *why* a session ended, so bugs 2 and 3 cannot be diagnosed from any build that lacks it. Shipping it is the precondition for ever closing them.

Out of scope for this build, and it must not be claimed otherwise: the 11-row Android lifecycle matrix, the binding performance budgets and the memory soak all need runs on a real device.
