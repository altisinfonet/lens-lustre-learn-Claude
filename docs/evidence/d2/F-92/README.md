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
