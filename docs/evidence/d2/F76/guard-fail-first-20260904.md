# F-76 · D2 evidence — the SECURITY DEFINER guard gets a third category

**Branch:** `d2/F76-public-by-design-guard-20260904`, cut from `staging` at `e74d977`.
**Date:** 2026-09-04. **Author:** D2.

## 0 · What was failing, and what it costs

```
FAIL src/__tests__/securityDefinerGrants.test.ts
  20260903090000_top_contributors_v3.sql: get_top_contributors_v3() …
Tests  1 failed | 53 passed (54)
```

`.github/workflows/android-build.yml:561` runs `npm test`, so this failure gates the AAB.

**The guard is not wrong.** `get_top_contributors_v3` *is* SECURITY DEFINER and *is* granted to
anon by name, which is the shape the guard exists to catch, and on almost every function that is
exactly right. The guard had only two categories — revoked, or internally gated — and this
function is a third thing: **deliberately public**. It is the Home page Top Contributors card and
it must work for a logged-out visitor.

A guard with no way to express a legitimate case gets disabled or ignored. Both end with it not
guarding.

## 1 · The third category, and why it is expensive to claim

The claim lives in the **migration**, never in an allow-list in the test file — an allow-list is
invisible from the file it excuses and it rots. All three conditions are required:

1. `-- PUBLIC-BY-DESIGN: <function> — <reason>` with at least 20 characters of real prose.
2. The F-62-safe shape: `REVOKE ALL … FROM public` **before** `GRANT EXECUTE … TO anon`.
3. Not `VOLATILE` — and PostgreSQL's default *is* VOLATILE, so a function that states no
   volatility fails too. Silence is not a claim.

**Conditions 2 and 3 are not waivable by the marker.** No reason justifies a PUBLIC-granted or a
VOLATILE anon-callable SECURITY DEFINER function, so the marker cannot excuse either.

## 2 · C-34 ON THE ESCAPE HATCH ITSELF

A new way to pass is a hole unless it is shown refusing what it must refuse. Six refusal fixtures,
each failing on exactly one named condition — and then each condition **mutated off** to prove the
fixture guarding it is load-bearing rather than decorative:

```
######## MUTATION: condition 'marker' (1) DISABLED ########
   × (a) FAILS a bare anon grant with no marker — on condition 1 only
   × (d) FAILS a bare marker tag with no reason prose
   × refuses ALL THREE at once, naming each, when nothing is in place
      Tests  3 failed | 7 passed (10)

######## MUTATION: condition 'shape' (2) DISABLED ########
   × (b) FAILS a marker with no REVOKE FROM public — the marker cannot waive F-62
   × (e) FAILS when the REVOKE follows the GRANT instead of preceding it
   × refuses ALL THREE at once, naming each, when nothing is in place
      Tests  3 failed | 7 passed (10)

######## MUTATION: condition 'vol' (3) DISABLED ########
   × (c) FAILS a VOLATILE function even with marker and REVOKE — on condition 3 only
   × (f) FAILS a function that states no volatility — the default is VOLATILE
   × refuses ALL THREE at once, naming each, when nothing is in place
      Tests  3 failed | 7 passed (10)

######## RESTORED ########
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

Each condition removed turns **exactly its own fixtures** red and nothing else. No condition is
decorative, and no fixture passes for a reason other than the one it names.

## 3 · The real migration — measured, not assumed

`20260903090000_top_contributors_v3.sql` **already satisfies conditions 2 and 3.** D1 wrote

```sql
REVOKE ALL ON FUNCTION public.get_top_contributors_v3() FROM public;
GRANT EXECUTE ON FUNCTION public.get_top_contributors_v3() TO anon, authenticated;
```

in that order, deliberately, with the F-62 trap documented above it — and the function is `STABLE`.
Two of the three conditions were met before this guard existed to ask for them.

**Only the marker is missing.** The guard now says so, and says only that:

```
get_top_contributors_v3() is SECURITY DEFINER and is neither REVOKEd from anon by name
nor gated on auth.uid()/has_role. … If it is deliberately public, say so IN THE MIGRATION
and meet all three conditions:
  - (1) no `-- PUBLIC-BY-DESIGN: get_top_contributors_v3 — <reason>` marker in the migration
```

## 4 · THE GUARD IS STILL RED, AND D2 CANNOT CLOSE IT

`supabase/**` is D1's lane. This branch does **not** edit the migration.

```
src/__tests__/securityDefinerGrants.test.ts   Tests  1 failed | 53 passed (54)
```

The three lines D1 must add, immediately above the existing `REVOKE ALL` at the end of
`supabase/migrations/20260903090000_top_contributors_v3.sql`:

```sql
-- PUBLIC-BY-DESIGN: get_top_contributors_v3 — the Home page Top Contributors card
-- is public and must render for a logged-out visitor. No arguments, no
-- caller-dependent value, and the same three already-public rows for every caller.
```

**Verified, not proposed on faith:** that exact text, inserted at that exact anchor in the real
file on disk, yields `{ claimed: true, ok: true, failures: [] }`. The anchor was asserted unique
in the same run. A committed test in this branch — *"passes in full once the one-line marker is
added"* — pins the same fact against the real file, so it cannot drift.

**Until D1 lands those lines, `npm test` stays red and the Android build stays blocked.** That is
stated rather than worked around: closing it from here would mean either editing D1's migration or
weakening the guard, and both are worse than a red build.

## 5 · Suite

```
BEFORE  Tests  2 failed | 2456 passed | 1 skipped (2459)
AFTER   Tests  2 failed | 2466 passed | 1 skipped (2469)
```

+10 tests. The same 2 tests fail before and after. Nothing loosened, skipped or disabled — the
guard got **stricter** for every function that does not meet all three conditions, and gained one
provable way to pass for functions that do.
