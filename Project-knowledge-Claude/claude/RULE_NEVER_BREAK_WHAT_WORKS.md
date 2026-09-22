# THE RULE: build slowly, build permanently, break nothing

**Owner instruction, 2026-08-05, verbatim:**

> *"I tolerate and dont silently you are breaking by develping one pointint
> example like Search. Very minor points iin bug proudct i cant check but What I
> underdatnd many slient unhappy situation is there as out 83 persons 70% users
> are silent - not posting happily as same experince like instagram.*
>
> *So you are the cuase of builing - you are the cause of damaging*
>
> *Asked you to set skill to develop slowly but permalemtly - dont what rule you
> must have to obey"*

This document is the answer. It sits alongside `WORKING_RULES.md` and does not
replace it. Where the two ever disagree, the stricter one wins.

---

## The admission this is built on

On 2026-08-05 I fixed images not loading on `/login` and `/signup`. The fix was
a global retry installed at app boot. I verified it on the two pages that were
reported and shipped it.

It broke **search** — a feature that had been working. The retry stored its
bookkeeping in `data-*` attributes on the `<img>` element. React reuses those
elements: a search box re-renders its result list on every keystroke and hands
the same element a different person's photo. The old occupant's state carried
over, healthy photos went grey, pending timers wrote the previous person's URL
onto the new person's avatar, and every keystroke fired uncacheable requests —
the hang.

**I never opened search.** The bug was not subtle; it was unlooked-for. That is
the whole failure, and every rule below exists to make it impossible to repeat.

---

## RULE A — A change to shared code is a change to EVERY surface that uses it

Anything installed at boot (`main.tsx`), anything in `src/lib/`, `src/hooks/`,
or a shared component, is not a change to the page you are looking at. It is a
change to the whole product.

**Before writing the fix:** list every surface that will execute the new code.
`grep` for the import; for a global listener, the answer is *"all of them"*, and
that must be stated out loud in the report.

**Before calling it done:** open, on production, in the owner's browser —

1. the feed,
2. **search** (type a name fast, then backspace it, then open a result),
3. a member profile,
4. the post composer,
5. a post's comments,
6. the notification bell.

Six surfaces, about two minutes. This is not optional and it is not "if time
allows". A change that has not walked this list has not shipped; it has escaped.

## RULE B — Never keep state on anything that can be reused

DOM nodes, refs, module-level maps keyed by index, anything React can hand to a
different item on the next render. React does not clear `data-*` it did not set.

If state must exist, **key it by the identity of the thing it describes** (the
URL, the row id), and **every pending timer or promise re-reads that key before
it writes**. If the key changed while it waited, drop the work silently.

## RULE C — One change. Ship it. Walk Rule A. Report with proof. Then the next.

This is what *"develop slowly but permanently"* means in practice.

- Never two unrelated changes in one push.
- Never start the next change while the last one is unverified.
- "Slow" is the point. A change that ships in ten minutes and breaks search has
  cost days, not saved minutes.

## RULE D — A fix is not proven until it is proven on the surface the MEMBER uses

The Android app runs **bundled** assets — `capacitor.config.ts` has no
`server.url`. So a web merge reaches the website in ~90 seconds and reaches the
**installed app not at all** until a build is cut and uploaded.

Therefore: never report a change as fixed for members without saying which of
the two it is live on. Measured 2026-08-05 — the composer now accepts text-only
posts on web, and **0 text-only posts exist in the whole 10-day window**, because
every member on the app is still on build 1050, which refuses them. The fix is
real and no member has been able to use it. Saying "fixed" there would be false.

## RULE E — Silence is the failure mode, so go looking for it

The owner cannot report what he cannot see, and a member who hits a broken
screen leaves rather than complains. So the absence of a complaint is not
evidence of anything.

Measured on production, 2026-08-05:

| | |
|---|---|
| Members | 84 |
| **Never posted once** | **43 (51%)** |
| **Never posted, commented OR reacted — silent in every way** | **36 (43%)** |
| Distinct posters per day, Jul 29 → Aug 4 | 18, 11, 10, **5, 7, 10, 6** |

The drop lands exactly on 2026-08-01, the day the profile-photo gate went up.
That gate is now removed and every member has a picture — but **removing a cause
is not the same as proving the effect returned.** The daily poster count is the
measurement that decides it, and it must be re-read before anyone claims the
silence is solved.

Standing practice: read `client_errors` (see `CLIENT_ERROR_TRACKING.md`) at the
start of every session. It is the only channel through which a member's broken
screen reaches us without them speaking.

## RULE F — Every regression gets a test that fails on the code that caused it

Not a test that passes now. A test run against the **previous commit**, watched
going red, before it is allowed to count. The search regression is pinned by
`src/lib/__tests__/imageFallbackRecycle.test.ts`, verified 4/4 red against the
commit that shipped the bug and 4/4 green after.

If a test is green on the broken version, it is not a regression test — delete it
and write the real one.

## RULE G — Report damage in the same message it is found, before anything else

Not after the good news. Not softened. What broke, whose change caused it (mine,
if mine), the evidence, and what shipped to fix it.

---

## The one-line version

**Nothing that already works may stop working. If I cannot name every surface my
change touches and show that each one still works on production, the change is
not finished — no matter how correct it is.**
