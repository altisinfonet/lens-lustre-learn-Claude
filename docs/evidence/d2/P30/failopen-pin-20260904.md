# P30 · D2 evidence — pinning the fail-open behaviour the revoke was cleared ON

**Branch:** `d2/P30-forgot-password-failopen-pin-20260904`, cut from `staging` at `580dede`.
**Date:** 2026-09-04. **Author:** D2. **Self-initiated** — not from a routed task list.

## 0 · Why

`docs/gates/P1-revocation-list.md` §2.1 cleared `email_exists(text)` for revocation on exactly one
ground:

> "D2 measured the only call site as fail-open: `ForgotPassword.tsx:39` is wrapped in try/catch,
> any error sets `exists = null`, and the page falls back to the generic reset flow."

**That revoke is now live** — merged as `supabase/migrations/20260910_0001_p30_email_exists_revoke.sql`,
on `staging` at `12090ab` (PR #147). So the fallback is no longer a rarely-taken branch: for `anon`
it is now the **only** branch, on every password reset the product performs.

**And nothing was pinning it.** `grep` across `src/**` for a test touching `email_exists` or
`ForgotPassword` returned nothing. The measurement that justified the revoke lived in a document,
and the code was free to drift out from under it.

## 1 · The claim re-measured from the code, not from the list

`src/pages/ForgotPassword.tsx:36-50`, read on `staging` at `580dede`:

```ts
let exists: boolean | null = null;
try {
  const { data, error: checkError } = await (supabase as any).rpc("email_exists", { _email: result.data });
  if (!checkError && typeof data === "boolean") exists = data;
} catch {
  exists = null; // check unavailable — behave like before
}

if (exists === false) { setNotFound(true); setLoading(false); return; }
```

After the revoke `checkError` is set, so `exists` stays `null`; `null === false` is false; control
falls through to `resetPasswordForEmail`. **§2.1's claim is correct.** The comment above it
(*"Fail-open: if the check itself errors, fall back to the old behavior"*) agrees with its code —
no Standing Rule 21 finding here.

There is exactly **one** call site. `grep -rn "email_exists" src/` returns `ForgotPassword.tsx:39`
and one comment reference in a P31 file.

## 2 · C-34 — these are regression pins, so sensitivity had to be shown, not assumed

A test that passes against today's correct code proves nothing on its own. Each of the three
realistic ways this behaviour drifts was applied to `ForgotPassword.tsx` and the suite re-run:

```
######## MUTATION: truthy  —  `exists === false`  ->  `!exists`  (the classic "tidy") ########
   × still sends the reset when the RPC is refused (42501)
   × still sends the reset when the RPC promise rejects
   × never shows the member a raw error from the refused check
      Tests  3 failed | 2 passed (5)

######## MUTATION: swallow —  drop the `!checkError` check, take null as an answer ########
   × still sends the reset when the RPC is refused (42501)
   × never shows the member a raw error from the refused check
      Tests  2 failed | 3 passed (5)

######## MUTATION: nocatch —  remove the try/catch entirely ########
   × still sends the reset when the RPC promise rejects
      Tests  1 failed | 4 passed (5)

######## RESTORED ########
      Tests  5 passed (5)
```

Each mutation is caught by **exactly** the tests that should catch it, and by no others. The
`truthy` mutation is the dangerous one: it turns every password reset into "No Account Found" for
every user, and all three fail-open tests refuse it.

**The two GUARD tests exist so this file cannot be satisfied by deleting the feature.** When the RPC
actually answers `false` the page must still say "No Account Found", and when it answers `true` the
reset must still send. Both pass in every state above.

## 3 · One assertion was fixed before it could mislead

The first draft asserted `queryByText(/no account/i)`. That matched **two** elements — the `h1` and
the body paragraph — and the guard failed with *"Found multiple elements"*. The failure was useful:
an ambiguous query is one that can pass or fail for a reason other than the one it names. Replaced
with `queryByRole("heading", { name: /no account\s+found/i })`, which addresses exactly one node.

Worth stating plainly: the ambiguity did **not** make the negative assertions vacuous — the screen
did render and the query did match it. The fix was to make the assertion name one element, not to
rescue a passing test.

## 4 · Suite

```
BEFORE (staging 580dede)   Test Files  5 failed | 174 passed | 1 skipped (180)
                                Tests  2 failed | 2456 passed | 1 skipped (2459)

AFTER                      Test Files  5 failed | 175 passed | 1 skipped (181)
                                Tests  2 failed | 2461 passed | 1 skipped (2464)
```

+5 tests. **Zero source files modified** — this branch adds one test file and this evidence file and
changes nothing else. `tsc -b` clean, `eslint` clean.

Note the baseline is unchanged from `e74d977`: the five commits `staging` gained (F-72, P30, F-73,
F-73b, F-73 evidence) moved neither the pass count nor the failure set, so the figures quoted in
PR #148 and PR #149 remain accurate against the newer base.
