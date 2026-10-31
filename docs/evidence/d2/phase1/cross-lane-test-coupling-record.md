# RECORD, NOT A FIX — `src/**` tests that read `supabase/**` by path

**D2 · 2026-09-22 · measured against `origin/staging` `247a47b`.**
**Nothing was changed.** The command's instruction is to record this; a red
assertion here would be a stop-and-report, not a fix.

---

## 1 · The file the command named — confirmed, line for line

`src/lib/__tests__/referralOverloadUnambiguous.test.ts` reads
`supabase/migrations/UNAPPLIED_20260911101721_new_project_full_schema_bootstrap.sql`
by literal path and asserts on its contents, in two places:

* **`:212-213`** — `const read(...)` of the bootstrap, then `expect(bootstrap).toMatch(…)`.
  A comment at `:206-211` records that the path was updated on 2026-09-12 when
  the file gained its `UNAPPLIED_` prefix, *"This assertion reads the file for
  its content, not its position in the sequence, so the rename is the only
  thing that changed here."*
* **`:254-257`** — a second `readFileSync` of the same path, split on
  `"-- Original header follows, unchanged."`, asserting on the header text.

`§3.1` puts `src/**` and `supabase/**` in different hands, so D1 cannot move
its own withdrawn file without D2. R-26 already refused the cleanest withdrawal
mechanism for this reason.

---

## 2 · It is not one file. Measured census of the whole class.

`src/**`, `.ts`/`.tsx`, references to `supabase/migrations/**` or
`supabase/rollback/**`:

| | count |
|---|---|
| files referencing D1-owned SQL paths | **52** |
| of those, test files | 44 |
| of those, non-test source (comments/pointers) | 8 |
| **name a SPECIFIC `.sql` file** — a D1 rename or withdrawal breaks these | **30** |
| read the directory only — a withdrawal changes what they see, a rename does not | 22 |

### Files pinned by an `UNAPPLIED_` name — the withdrawal mechanism's blast radius

Three names across **two** test files, not one:

* `src/lib/__tests__/referralOverloadUnambiguous.test.ts`
  * `supabase/migrations/UNAPPLIED_20260911101721_new_project_full_schema_bootstrap.sql`
* `src/lib/__tests__/rule20ProductionClosureF105de.test.ts` — `:41`, `:43`
  * `supabase/migrations/UNAPPLIED_20260910_0023_f105de_referral_reward_production_close.sql`
  * `supabase/rollback/UNAPPLIED_20260910_0023_f105de_referral_reward_production_close_ROLLBACK.sql`

**`rule20ProductionClosureF105de.test.ts:43` reads `supabase/rollback/**`** — a
directory this lane is told never to touch — and that file's own header states
it holds the D-007 eight-path list *"so the register, the addendum, and this
test cannot silently drift apart"*. It is a D2-owned file deliberately pinned
to D1-owned paths. That is the coupling in its purest form, and it is there on
purpose.

### The shared helper is coupled too

`src/test-utils/migrations.ts:53` — `export const MIGRATIONS_DIR =
join(process.cwd(), "supabase/migrations")` — is the read path for a large part
of category B, `src/__tests__/securityDefinerGrants.test.ts` among them.
`src/test-utils/__tests__/migrations.test.ts:166` records that *"these tests
read supabase/migrations with their own readdirSync filter"*, i.e. the coupling
is known and documented, not accidental.

---

## 3 · What this means for D1's Unit A, stated without proposing a remedy

* A D1 **rename** of any of the 30 specifically-named files turns a D2 test
  red. Whether the assertion is still true is irrelevant — it cannot find the
  file.
* A D1 **withdrawal** (adding the `UNAPPLIED_` prefix) is a rename, so it is in
  the same class. That is what happened on 2026-09-12 and why the comment at
  `referralOverloadUnambiguous.test.ts:206` exists.
* Category B's 22 directory-readers do not break on a rename, but a
  **withdrawal changes the set they scan**, which can change a verdict silently
  rather than loudly — the worse of the two failure modes.

**D1's Unit A is written to keep both of the named assertions passing.** If
either goes red, that is a stop-and-report by both lanes, not something either
side fixes alone. The remedy — if the Auditor wants one — is a lane decision
about whether `src/**` may name `supabase/**` files at all, and it is not
proposed here.

---

## 4 · Checked and clean, so it is not re-raised

`/profile/:userId` → `PublicProfile` at `src/App.tsx:395` sits outside the
`<Route element={<RequireAuth />}>` block, which opens at `:384` and closes at
`:394`. It is a public profile page and the placement is correct. Confirmed,
matching the command.

**Not clean, and raised under Unit 4 rather than here:** `/feed` at `:397` is
also outside that block, three lines below its close, and is *not* a public
page — it is the members-only route whose only control is the redirect in
`Feed.tsx:89`. The comment at `:380-383` immediately above the block says
"Add new members-only routes HERE, not as bare siblings."
