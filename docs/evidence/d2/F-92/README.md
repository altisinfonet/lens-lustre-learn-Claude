# F-92 · landing on `/profile/<uuid>` must end up showing `/<custom_url>`

Owner's rule: *"any link always show profilename link"*. F-86 made `/membername` **stay**
`/membername`. This is the other half.

The ID link is not a secret and may be shared — *"profile link can be disclosed to anyone"* — but
it must never be what the visitor is **left looking at**: the recipient of a shared link sees a
UUID instead of a name, and search engines index the UUID rather than the handle.

## Where it lives, and why it is its own module

`useVanityUrlAddress`, called from `PublicProfileInner`. The alternative was a `useEffect` buried
in an 1,800-line page component, testable only by mounting that whole page with its auth, query and
router stack mocked — and **a control that can only be exercised through a full page render is a
control that stops being run**. Same reasoning as `verifyCertificateErrors.ts` in F-85.

## `history.replaceState`, not `navigate()` — and this is now PROVEN, not argued

I flagged before starting that the brief offered both mechanisms and that only one can satisfy
"do not remount or refetch". That is no longer a reading of the router; **Plant D measures it.**

`/profile/:userId` and `/:customUrl` are two different routes on a `BrowserRouter`, so
`navigate("/membername")` makes the router **re-match**: this component unmounts, the vanity
resolver mounts, `resolve_custom_url` runs again, and a profile already on screen is refetched and
redrawn. `replaceState` updates the address bar **without** notifying the router, so the match is
untouched and nothing below re-renders.

It is also the house pattern rather than a new mechanism: `cacheBuster.ts:37`, `Wallet.tsx:119`.

## C-34 — four defects planted, each shown red

```
PLANT A  the rewrite removed                    Tests  4 failed | 4 passed
PLANT B  the null guard removed                 Tests  2 failed | 6 passed
PLANT C  pushState instead of replaceState      Tests  2 failed | 6 passed
PLANT D  navigate() instead of replaceState     Tests  9 failed | 2 passed
RESTORED                                        Tests 11 passed
```

Plant D is the one worth reading twice: it fails **nine** tests, including *"the address becomes
/membername and the PAGE IS NOT SWAPPED for the resolver"*. The mechanism argument is measured.

## The guard that protects live members

**"Changes NOTHING when `custom_url` is null" is not a tidy edge case — it is 15 live production
members' profile pages.** They have no handle, D1's backfill has not run, and `/profile/<id>` has
to keep working for them: it must never 404 and never redirect into a dead end. The guard is an
early return with no else branch, deliberately, and Plant B exists to keep it honest.

Also guarded: an address that is **already** the vanity URL is left alone (F-86's in-place render
needs no correction, and rewriting it would be a pointless history operation), and a non-profile
address is never touched.

## What a member SEES, which a URL assertion misses

Every structural test here checks the address bar — and **all of them would pass while the member
watched the profile blank out and redraw**, because the URL is correct either way. That is the same
blindness that let a 404 ship at 57% opacity with every structural check green.

So three assertions were added for the *visible* symptom, and they had to be written **with a real
router** or they would be vacuous — in isolation nothing can remount and they would pass whatever
the hook did:

1. the page is **not swapped** for the vanity resolver — the router did not re-match;
2. the profile **mounts exactly once** — no flash, no refetch;
3. the reader is **not moved** — scroll position untouched.

**Stated limit:** these prove the route does not change, the page is not remounted, and the scroll
does not jump. They do **not** photograph pixels and are not a substitute for looking at the
deployed page.

## On the back button, stated rather than dressed up

jsdom implements `replaceState` and `pushState` but does not give a test a real back button, so
**this suite does not claim to prove back-button behaviour.** It asserts what the instrument can
actually see: `replaceState` was called, `pushState` was **not**, and `history.length` did not
grow. The genuine article — press back, land somewhere sane — belongs in a browser-level check and
is not claimed here.

## Not touched

`CustomUrlProfile` and the `/:customUrl` route are unchanged. F-85 and F-86 are proven and merged
and this change stays out of their code path.

## Gates

```
eslint    PublicProfile.tsx 75 problems — IDENTICAL to the staging baseline (no delta)
          useVanityUrlAddress.ts clean
typecheck clean apart from the pre-existing @lovable.dev/cloud-auth-js TS2307
tests     11 passed in this file
```

---

# Two findings from trying to photograph this in the harness

The plan was a fixture member with a handle plus a new scene, so the rewrite would be photographed
like everything else. **Neither half survived contact with a measurement, and both failures are
worth more than the scene would have been.**

## C-84 — the fixture defect is real, but it is NOT "no member has a handle"

I reported earlier that the harness fixture had no `custom_url`. That was wrong in an important way
and I am correcting it: `fixtures.ts` gives **every** member one — `avijit`, `ranjana`, `liwei`.
What drops it is the **derived projection** at `fixtures.ts:262`, `profilesPublicData = profiles.map(...)`,
which simply never copied the column.

So every screen reading `profiles_public_data` — which is nearly all of them — saw `custom_url:
undefined`, and the harness could only ever exercise the no-handle fallback. The file's own comment
two paragraphs above that map warns about precisely this: *"two lists of the same members that
could drift apart is a bug waiting to be photographed as a feature."* It had drifted.

## C-85 — NO HARNESS SCENE CAN EVER TEST THIS REWRITE, and the scene I added was fiction

`AppShell.tsx:124` mounts scenes in a **`MemoryRouter`**. It never touches `window.location`. The
hook reads `window.location.pathname` and writes `window.history` — both bypassed entirely. Driven
in the harness, the address bar reads `/uiharness.html`, the guard returns early, and the scene
photographs a page on which the rewrite provably did not run.

Measured, rather than reasoned about after the fact:

```
FAIL screen-wall-visitor-vanity  address=/uiharness.html  expected=/liwei
FAIL screen-wall-visitor         address=/uiharness.html  expected=/ranjana
```

**The scene has been removed.** A scene that cannot exercise the thing it is named after is worse
than no scene: it is a green check that reads as coverage. That is the same failure as the 404
probes that measured everything except whether the page could be read.

Coverage for F-92 is therefore: the **jsdom router tests** above — which CAN see it, because they
mount a real `BrowserRouter` against jsdom's real `window.location` — and the deployed reading,
which is the Auditor's.

## F-93 — a real UI defect the lossy fixture was hiding

Carrying `custom_url` through the projection makes the harness render the `@handle` as the live app
does. The gate immediately reported, on the very first run:

```
BASELINE REGRESSIONS (1) — a control got worse since the last approved run:
    ✗ screen-profile--desktop-1280: "a.inline-flex.items-center" shrank to 117x17
      (was 96x35, a tappable size)
```

A link on the account screen drops from 35px to **17px tall** — below a tappable size — once a
handle is present. **This is not caused by the fixture change; it is revealed by it.** Every member
on production with a `custom_url` (96 of 111) has been getting this, and the harness could not see
it because the projection hid the column.

**Not fixed here, and not re-baselined.** The fixture correction has been taken back OUT of this
branch so F-92 ships clean and this gets its own unit: it is a different defect, in a different
file, and re-baselining it away is exactly what Standing Rule 19 forbids. The fixture fix is a
one-line change (`custom_url: p.custom_url ?? null`) and should land WITH whatever fixes the 17px
link, not before it.
