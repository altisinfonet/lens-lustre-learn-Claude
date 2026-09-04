# P31 · D2 fail-first evidence — verification fail-open

**Unit:** P31 precondition (client half). **Branch:** `d2/P31-verification-failopen-20260904`,
cut from `staging` at `e74d977`. **Date:** 2026-09-04. **Author:** D2.

Every run below was taken on this branch, in this container, by D2. None of it is inherited.

---

## 0 · What was measured before anything was written

`docs/gates/P1-revocation-list.md` at commit `e74d977`, blob `88c08093` — both hashes confirmed
against the working tree before reading. §2.2 was then checked against the code rather than taken
as given, which is what produced the finding in §4.

**Baseline suite, before any edit of mine:**

```
Test Files  5 failed | 174 passed | 1 skipped (180)
     Tests  2 failed | 2456 passed | 1 skipped (2459)
```

The suite was **already not green on `staging`**. See §5 — none of it is in D2's lane and none of
it was introduced here.

---

## 1 · BLOCKER A — search_certificates

**The one call site**, confirmed by grep across `src/`:
`src/pages/VerifyCertificate.tsx:101`, inside `handleSearchByDetails`. It is the only call of
`search_certificates` in the application.

The defect, verbatim from `staging`:

```ts
if (error || !data || data.length === 0) {
  setNotFound(true);
}
```

A refusal and an absence rendered the same panel: **"No Certificates Found"**.

### FAIL-FIRST — classifier present, component unpatched

```
✓ classifier > treats 42501 as a withdrawn grant
✓ classifier > treats PGRST202 as a withdrawn grant — the schema cache has reloaded
✓ classifier > falls back to the message when a proxy stripped the code
✓ classifier > is false for absent, primitive and unrelated-shape errors
✓ classifier > is false for PGRST116 — zero rows is an absence, not a refusal
✓ classifier > is false for a transport failure — that is not a withdrawn grant
× VerifyCertificate > shows the unavailable panel, and NOT 'No Certificates Found', on 42501
× VerifyCertificate > shows the unavailable panel, and NOT 'No Certificates Found', on PGRST202
× VerifyCertificate > never shows a raw error message to a member
✓ VerifyCertificate > GUARD still says 'No Certificates Found' for a genuine empty result
✓ VerifyCertificate > GUARD does not claim 'Search Unavailable' for an unrelated error

Test Files  1 failed (1)
     Tests  3 failed | 8 passed (11)
```

The failure dump rendered the defect literally — with the RPC returning
`{ code: "42501", message: "permission denied for function search_certificates" }`, the DOM
contained:

```html
<p class="text-sm text-foreground mb-1">No Certificates Found</p>
<p class="text-xs text-muted-foreground">No certificates match your search criteria. …</p>
```

That is the sentence a member holding a real certificate would have been shown on revoke day.

### AFTER FIX

```
Test Files  1 passed (1)
     Tests  11 passed (11)
```

**The two GUARD tests pass in both states on purpose.** A fix that classified every failure as
"unavailable" would satisfy the headline assertion and be a worse bug than the one it replaced.
They are the only thing standing in the way of that, and they are not padding.

---

## 2 · BLOCKER B — increment_managed_page_view

`src/pages/ManagedPageView.tsx:34`, verbatim from `staging`:

```ts
supabase.rpc("increment_managed_page_view", { _page_id: pageId }).then(() => {});
```

### The stated mechanism was checked and is not what happens

Read from the installed `@supabase/postgrest-js`
(`node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts`, lines 227–293):

```ts
if (!this.shouldThrowOnError) {
  res = res.catch((fetchError) => {
    …
    return { error: {…}, data: null, count: null, status: 0, statusText: '' }
  })
}
return res.then(onfulfilled, onrejected)
```

`throwOnError()` is **not** called at this site, so the builder attaches its own `.catch()` and
that catch **returns a resolved response**. A withdrawn grant therefore does **not** produce an
unhandled promise rejection — it produces a **resolved** `{ data: null, error: { code: "42501" } }`
which `.then(() => {})` discarded in silence.

**Corrected characterisation:** the defect is a permanently and invisibly failing view counter,
not a crash. That is the "undetectable outage" half of the requirement, and it is the half that
actually bites. Both paths are handled anyway; only one of them is reachable today.

Independently corroborated by `tsc`: `PostgrestBuilder.then()` is typed `PromiseLike<T>`, so an
appended `.catch()` does not compile (`TS2339`). The rejection handler is passed as the second
argument to `.then()` instead.

### FAIL-FIRST — component unpatched

```
× logs exactly once when the RPC resolves with a refusal (42501)
    AssertionError: expected [] to have a length of 1 but got +0
× logs once and does not break the page when the RPC promise rejects
    AssertionError: expected [] to have a length of 1 but got +0
✓ GUARD stays silent when the increment succeeds
✓ GUARD the member never sees the counter failure — page renders regardless

Test Files  1 failed (1)
     Tests  2 failed | 2 passed (4)
```

`expected [] to have a length of 1` — **zero** log lines today. The silent swallow, measured.

Assertions are filtered to the component's own `[managed-page-view]` prefix. A bare
`console.warn` call count was tried first and was **wrong**: React Router emits two unrelated
future-flag warnings during this render, so a raw count measures those instead of the control.

### AFTER FIX

```
Test Files  1 passed (1)
     Tests  4 passed (4)
```

---

## 3 · Typecheck and lint

`npx tsc -b tsconfig.json` — both projects, app and strict.

The first version of the Blocker B fix **failed** typecheck:

```
src/pages/ManagedPageView.tsx(71,6): error TS2339: Property 'catch' does not exist on type 'PromiseLike<void>'.
```

Fixed, then re-run. The remaining `tsc` errors are byte-identical on clean `staging` (verified by
stashing this branch's changes and re-running): this branch adds **zero** typecheck errors.

`eslint` on the five touched files: **0 errors.** The two remaining warnings in
`VerifyCertificate.tsx` are pre-existing and were confirmed present on clean `staging` at the same
code, shifted only in line number. One warning **was** introduced by D2 — an
`// eslint-disable-next-line no-console` for a rule this repo does not enable, i.e. a comment
asserting a control that does not exist — and it was removed rather than left standing.

---

## 3b · The by-ID collapse site (`:81`, `verify_certificate`) — added on the Auditor's ruling

Raised as a finding, then ruled in scope: the *Search Unavailable* panel tells members to verify by
certificate ID, so leaving the same defect on the by-ID path would move the bug rather than remove
it. `verify_certificate` is **not** on §2.1 — nothing is blocked by this today.

### FAIL-FIRST — by-ID path unpatched

```
× by-ID path > shows the unavailable panel, and NOT 'No Certificates Found', on 42501
× by-ID path > uses by-ID wording, not the by-name wording, on the ID path
× by-ID path > never shows a raw error message to a member on the ID path
✓ by-ID path > GUARD still says 'No Certificates Found' for a genuine unknown ID
Test Files  1 failed (1)
     Tests  3 failed | 12 passed (15)
```

### AFTER

```
Test Files  1 passed (1)
     Tests  15 passed (15)
```

The panel heading and body branch on `mode`: telling someone already on the by-ID path to "use the
certificate ID" is circular, so the ID path reads *"Verification Unavailable — we could not
complete this check just now. This does not mean the certificate is invalid."* A test asserts the
by-name wording does **not** appear on the ID path, so the two cannot silently converge.

Per the Auditor's ruling the mode toggle is **NOT** hidden: the tab vanishing underneath someone
mid-mode is worse than the tab being there, and knowing the grant state before the call is a design
decision rather than a one-liner. Closed, not deferred.

---

## 4 · Findings raised against the frozen list

See the PR body. In summary: §2.2's "all four verification pages" describes four *collapse sites*
across three files calling **four different functions**; only one of them is `search_certificates`.

---

## 5 · Suite state, stated plainly

```
BEFORE (staging, untouched)   Test Files  5 failed | 174 passed | 1 skipped (180)
                                   Tests  2 failed | 2456 passed | 1 skipped (2459)

AFTER  (this branch)          Test Files  5 failed | 176 passed | 1 skipped (182)
                                   Tests  2 failed | 2475 passed | 1 skipped (2478)
```

+2 files, +19 tests, all passing. **The same 5 files and the same 2 tests fail before and after.**
Nothing was broken and no existing test was loosened, skipped or disabled.

`bunx vitest run` is **not green**, and was not green before this branch. Causes, all outside
D2's lane:

| failure | cause |
|---|---|
| `ComposerEnterKey.test.tsx`, `StoryCardReactions.test.tsx` | `Failed to resolve import "react-mentions"` |
| `gpsGuard.test.ts` | `Failed to resolve import "exifr"` |
| `securityDefinerGrants.test.ts` · `get_top_contributors_v3` | SQL/D1 lane — pre-existing |
| `scheduledPostDuplicate.test.ts` · RED-2 | pre-existing; spawns its own `tsc` on a probe file |

The three import failures are an **environment** limitation of this container, not a code defect:
`react-mentions`, `exifr` and `@lovable.dev/cloud-auth-js` are served from
`europe-west1/4-npm.pkg.dev`, which this session's network policy answers with `403 CONNECT`.
`bun install --frozen-lockfile` reported them and exited without writing a lockfile; `git status`
confirmed `package.json`, `package-lock.json`, `bun.lock` and `bun.lockb` all clean. **No
dependency window was opened and no dependency file was touched.**

D2 cannot state that these four would pass on a runner with full registry access — only that they
fail identically with and without this branch's changes.
