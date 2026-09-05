# F-85 · The branded 404 was unreachable for every single-segment dead URL

**C-34 fail-first record.** Instrument: `npx vitest run src/pages/__tests__/notFoundReachability.test.tsx`
— node v22.22.2, jsdom — on branch `d2/F-85-notfound-unreachable-20260905` off `staging` `fee41a9`.

Both runs below use the **same test file**. The only thing that differs between them is
`src/pages/CustomUrlProfile.tsx`.

## The defect

`App.tsx:438` declares `<Route path="/:customUrl" element={<CustomUrlOrIdVerification />} />`, which
matches **every** single-segment path, so the catch-all `<Route path="*" element={<NotFound />} />`
at `:440` only ever fires for multi-segment ones. A dead single-segment URL therefore mounted
`CustomUrlProfile`, which resolved nothing and called `navigate("/not-found", { replace: true })`.
`/not-found` is itself a single segment and is **not a declared route anywhere in the tree**
(`grep -rn '/not-found' src/` returns only the three redirects that produced it), so it matched
`/:customUrl` again, the component remounted with `customUrl="not-found"`, failed again, navigated
to where it already was, `checking` flipped false, and it reached `return null`.

Header, footer, and nothing in between.

## BEFORE — `CustomUrlProfile.tsx` byte-identical to `origin/staging` (sha256 `5c04a05b1d1c0cb6…`)

```
   × a dead SINGLE-SEGMENT url reaches the 404 instead of a blank page          1030ms
   × the 404 echoes the url the member actually asked for, not /not-found       1005ms
   × /not-found itself reaches the 404 rather than looping                      1006ms
   ✓ GUARD a resolvable vanity url still reaches the profile, with no 404 shown   12ms
   × GUARD an old vanity url redirecting to a live one never flashes the 404    1007ms
   ✓ GUARD a dead MULTI-SEGMENT path still reaches the 404                        22ms

 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
```

The three headline failures do not fail against wrong content. They fail against **nothing** —
this is the rendered document at the moment of the assertion, and it is exactly what the member
sees:

```
Ignored nodes: comments, script, style
<body>
  <div />
</body>
```

The two GUARD tests that pass here pass **before and after**, deliberately. A "fix" that rendered
`NotFound` unconditionally would satisfy the three headline assertions and break every vanity URL
on the site; these two are the only thing standing in the way of that.

### The fourth failure is a second, pre-existing defect — recorded, not smuggled in

`GUARD an old vanity url redirecting to a live one never flashes the 404` also fails on the
**unfixed** code, and for its own reason. React Router does not remount this component when only
the route param changes — the same instance re-runs the effect — and `checking` was never reset.
So the second leg of an old-URL redirect rendered with a stale `checking === false`. On staging
today that renders `null`, which is invisible:

```
Unable to find an element with the text: Loading…
<body>
  <div />
</body>
```

Invisible, but not harmless: making the terminal return meaningful would have turned that stale
state into a **404 shown over a URL that was still resolving**. Measured, not argued — with the
redirect fix applied and the `setChecking(true)` reset omitted, this same test fails with the
literal 404 element in the DOM and the `UI-8006` log line firing for `detail.path: "/new-url"`.
The reset removes the stale state rather than hiding it.

## AFTER — the fix applied (sha256 `dbf5189856c8701d…`)

```
 ✓ src/pages/__tests__/notFoundReachability.test.tsx (6 tests) 118ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

## Scope checked, so it is not assumed away

- **`IDVerification` does NOT have this shape.** It already uses the pattern this fix adopts —
  `const [notFound, setNotFound] = useState(false)` (`:50`), `if (error || !row) { setNotFound(true); return; }`
  (`:63`), and a rendered not-found block (`:118`). It never redirects and never returns `null`.
  It is the in-repo precedent for the fix, not a second instance of the bug.
- **`navigate("/not-found")` appears three times in the whole repository**, all three in
  `CustomUrlProfile.tsx` (`:40`, `:54`, `:58`). All three are removed here.
