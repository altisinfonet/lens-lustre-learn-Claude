# F-85 + F-86 · one root cause: `CustomUrlProfile` navigated where it should have rendered

**C-34 fail-first record.** Instrument: `npx vitest run src/pages/__tests__/vanityUrlAndNotFound.test.tsx`
— node v22.22.2, jsdom — on `d2/F-85-F-86-vanity-url-and-notfound-20260905`, based on `staging` `fee41a9`.

Both runs below use the **same test file**. The only things that differ are
`src/pages/CustomUrlProfile.tsx` and `src/pages/PublicProfile.tsx`, each reverted to its
`origin/staging` blob for the BEFORE run and restored for the AFTER run.

## BEFORE — both sources byte-identical to `origin/staging`

```
   × F-86 a current vanity url renders the profile AND keeps /membername in the address bar   1031ms
   × F-86 the profiles_public_data FALLBACK path keeps /membername too                        1007ms
   × F-86 a RENAMED vanity url settles on the new VANITY path, never on /profile/<uuid>         12ms
   × F-85 an unresolvable single-segment url renders the 404 instead of a blank page          1004ms
   × F-85 the 404 keeps the typed path, so it echoes the real dead address                    1005ms
   × F-85 /not-found itself reaches the 404 rather than looping                               1004ms
   ✓ GUARD a member with NO custom_url still falls back to /profile/<id>                         7ms
   ✓ GUARD a dead MULTI-SEGMENT path still reaches the 404                                      17ms
   × GUARD a renamed url in flight never flashes the 404 over the new address                 1005ms

      Tests  7 failed | 2 passed (9)
```

### F-86 does not fail against wrong content. It fails against the UUID in the address bar.

The location probe at the moment of the assertion — this is the finding, rendered:

```
<body>
  <div>
    <div data-testid="path">
      /profile/4c200b33-ae64-46f0-ba5d-1a97152e6a6c
    </div>
```

and on the renamed-URL case:

```
AssertionError: expected '/profile/4c200b33-ae64-46f0-ba5d-1a97…' not to contain
                '4c200b33-ae64-46f0-ba5d-1a97152e6a6c'
Received: "/profile/4c200b33-ae64-46f0-ba5d-1a97152e6a6c"
```

The renamed case passes *through* `/newname` correctly and is then taken to the UUID by the second
leg — so the existing old-URL redirect was never the bug; answering the resolved URL with a
navigate was.

### F-85 fails against an empty document — the blank page itself

```
Unable to find an element with the text: 404
<body>
  <div />
</body>
```

## AFTER — the fix applied

```
 ✓ src/pages/__tests__/vanityUrlAndNotFound.test.tsx (9 tests) 157ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

## The two guards that pass in BOTH runs are deliberate

`/profile/:userId` must keep working — existing links depend on it and it is the fallback for a
member with no `custom_url` — and a fix that rendered `NotFound` unconditionally would satisfy
every headline assertion above while breaking all 96 live vanity URLs. Those two guards are the
only thing standing in the way of that.

## A third defect, found by these tests and fixed here

`GUARD a renamed url in flight never flashes the 404` fails on the unfixed code too, for its own
reason. React Router does not remount this component when only the route param changes — the same
instance re-runs the effect — and neither `checking` nor the resolved id was ever reset. On staging
today that renders `null`, which is invisible. Once the terminal render becomes meaningful it would
have become a **404 shown over an address still being resolved**: measured, with the reset omitted,
as the literal 404 element in the DOM and `UI-8006` firing for `detail.path: "/new-url"`.
`setChecking(true)` / `setResolvedUserId(null)` remove the stale state rather than hiding it.

## Scope checked, so it is not assumed away

### The seven `navigate()` calls, line by line

`origin/staging:src/pages/CustomUrlProfile.tsx` holds **seven** `navigate()` calls, not six
(**C-78** — the Auditor's list omits `:36`, which the same brief elsewhere correctly describes as a
redirect to keep). Full disposition:

| line | call | branch | disposition |
|---|---|---|---|
| `:26` | `navigate('/profile/'+historyRow.user_id)` | history row, `is_current` — **success** | **RENDERS IN PLACE.** `setResolvedUserId` → `<PublicProfileInner />`. Address stays `/membername`. |
| `:36` | `navigate('/'+currentProfile.custom_url)` | renamed URL, member HAS a current vanity URL | **KEPT.** One canonical address per member. |
| `:38` | `navigate('/profile/'+currentProfile.id)` | renamed URL, member has NO custom_url | **KEPT.** `/profile/<id>` is genuinely the only address that exists. |
| `:40` | `navigate('/not-found')` | renamed URL, member row gone | **REMOVED** → `<NotFound />` in place. |
| `:52` | `navigate('/profile/'+fallback.id)` | `profiles_public_data` ilike fallback — **success** | **RENDERS IN PLACE.** The second success path; fixing only `:26` would leave every pre-history-table member on a UUID. |
| `:54` | `navigate('/not-found')` | fallback found nothing | **REMOVED** → `<NotFound />` in place. |
| `:58` | `navigate('/not-found')` | `catch` | **REMOVED** → `<NotFound />` in place. |

Two navigates remain, both redirects that should remain. `return null` at `:78` is gone.
`navigate("/not-found")` no longer appears anywhere in the repository.
- **`IDVerification` does NOT have this shape.** It already uses the pattern adopted here —
  `notFound` state at `:50`, set at `:63`, rendered at `:118` — and never redirects or returns
  `null`. It is the in-repo precedent for the fix, not a second instance of the bug.
- **`/profile/:userId` is untouched**, still declared at `App.tsx:395` outside `RequireAuth`.
  Nothing about authentication changes.
- **No route table change at all.** `App.tsx` is not modified by this PR.
