# F-89 · the 404 was frozen mid-reveal at 57% opacity

## The defect

Measured by the Auditor on the **deployed** page: an ancestor of the heading carried inline
`opacity: 0` with `transform: translateY(2.22352px)`, and its computed opacity sat at
**0.567406** — sampled six times over four seconds, identical every time. Not slow. **Stopped.**

The colours were never wrong: `rgb(248,250,252)` on `rgb(15,23,41)` is **17.08:1**. They were being
multiplied by 0.567, so the heading rendered as washed-out grey, "Back to Home" looked *disabled*
and "Discover" was nearly invisible. The Owner said the page looked nothing like Instagram. He was
right, and the cause was a bug, not a palette.

Source: `PageTransition`, which wraps **every** page — `initial={{opacity: 0, y: 6}}` animating to
`{opacity: 1, y: 0}`. `0.567` opacity with `translateY(2.22px)` is that animation stopping partway.

## Why every existing check passed

Sidebars, links, overflow, mount counts — all green while the page rendered at 57%. **A check that
cannot fail for the reason the Owner complained about is not a check.** The structural probes
measured everything except whether the page could be read.

## The assertion, RED on live staging code

`firstframe.prepared.mjs` installs a sampler *before navigation* and records the **lowest**
effective opacity the heading ever has — the product of every ancestor's opacity — from the frame
it first exists. It does not measure the settled state, which was already 1 locally and would have
told us nothing.

```
path                       : /no/such/page/at/all
opacity in the FIRST frame : 0
LOWEST opacity ever seen   : 0

FIRST-FRAME CHECK: FAIL — the page is revealed rather than rendered.
```

## Two fixes that look simpler and are not — both measured, not argued

**1. Exempting only the 404 CANNOT WORK.** The obvious fix is to pass `instant` when the bare-shell
flag is set. It stayed **red**: first frame 0, minimum 0. The flag is raised by `NotFound` in a
`useLayoutEffect`, which runs *after* the first render — so by definition it cannot be known during
the frame the rule is about. This is a real limitation of the F-89 mechanism, found by the
assertion rather than by reasoning.

**2. Moving the animation out of the tree for the 404** would reintroduce the unbounded remount
loop this page was reverted for: a conditional wrapper changes the tree *shape* and destroys the
subtree below it.

## The fix: animate FROM visible

`initial={{ opacity: 1, y: 6 }}`. The 6px rise is kept; the invisible parked state is gone. Nothing
can strand the text at a fraction of its opacity because it is never below full opacity to begin
with. `exit` still fades — a page on its way out may safely become invisible, because it is leaving.

An unconditional `instant` was tried and rejected: it also passes, but it destroys the site-wide
page transition to fix one page.

```
opacity in the FIRST frame : 1
LOWEST opacity ever seen   : 1
FIRST-FRAME CHECK: PASS
```

All four 404 scenes: **minimum opacity 1**.

## Nothing else moved

```
remount loop      screen-not-found-in-place 2 mounts, screen-not-found 2 mounts — still fixed
full suite        2523 passed | 1 skipped, 0 failures
ui:gate           baseline diff CLEAN against all 148 recorded keys
                  12 ✗ rows — IDENTICAL to the F-90 baseline set
                  baseline.json UNTOUCHED
eslint            PageTransition.tsx 0 problems; Layout.tsx 2 errors, both pre-existing
                  no-explicit-any, same count as the staging baseline
```

## The lesson worth keeping

This is a **whole-app** change made to fix one page, and it is the right shape: the rule "content is
never parked invisible waiting for something to turn it on" removes a class of defect rather than
an instance. Any page whose reveal stalled would have shown the same symptom; only the 404 happened
to be looked at.
