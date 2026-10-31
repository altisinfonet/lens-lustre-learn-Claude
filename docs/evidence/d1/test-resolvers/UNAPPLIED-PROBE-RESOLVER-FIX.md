# Migration resolvers read files that never ran

**Unit:** teach every "latest definition wins" test to skip `UNAPPLIED_*` and
`PROBE_*`, from one shared helper instead of fifteen hand-written filters.
**Branch:** `d1/P02-migration-resolver-skips-unapplied` → `main`.
**Touches no SQL, no grants, no migration, no production.** Test-side only.

## The defect

Gate tests answer "what does the database actually do today?" by reading
`supabase/migrations/` and taking the **last** file that defines a thing —
correct, because `CREATE OR REPLACE` means an earlier file's text proves nothing.
The candidate set was `.endsWith(".sql")`, which is not the set of files that ran.

Two prefixes mark files deliberately outside the sequence: `PROBE_*` (read-only
gate probes) and `UNAPPLIED_*` (withdrawn, superseded, or never dispatched).

**ASCII sorts digits before uppercase letters.** Every real migration starts with
a digit; these start with `P` and `U`. So an excluded file does not merely join
the candidate set — it sorts last and wins *every* such resolver at once.

Measured, not inferred:

```
last .sql file by sort order  →  UNAPPLIED_20260911101721_new_project_full_schema_bootstrap.sql
```

That file was renamed on 2026-09-12 (PR #243) to take it out of reach of the
`apply-migration.yml` dispatch box. It stayed in the directory, so it kept
matching `.endsWith(".sql")` and silently became "the newest word" on every
function it contains — all 21,442 lines of schema snapshot.

## What it actually hit

Each row measured by resolving the test's own predicate over the real directory,
with and without the exclusion:

| test | resolved to | should resolve to |
|---|---|---|
| `handleTravelsWithNameOnServer` (get_todays_birthdays) | bootstrap | `20260910_0020_f98c_birthdays_carry_handle_and_close.sql` |
| `securityDefinerGrants` (email queue) | bootstrap | `20260814042609_email_queue_authority.sql` |
| `pushCatalogParity` (notif_action_phrase) | bootstrap | `20260811120000_ad_creative_engagement.sql` |
| `feedFreshness` (get_broadcast_feed) | bootstrap | `20260814074922_feed_rpc_candidate_pool.sql` |
| `taggedPostNotifications` (pj_handle_reaction_notification) | bootstrap | `20260811090000_tagged_members_get_post_notifications.sql` |
| `edit-window-invariant` (owner-update policy) | bootstrap | `20260619120842_659abf02-….sql` |
| `notifications-stage-key-payload` (notify_round_published) | bootstrap | `20260502090928_ee476462-….sql` |
| `candidatePatternWidening` (media_migration_fence_digest) | counted the bootstrap as a second definition | one definition |
| `mediaWritePath` (**six** functions) | bootstrap | six real migrations |

The first eight were **red on main** — 12 of the 13 failing tests in the
`origin/main` baseline. The ninth, `mediaWritePath`, was **green**: all six of
its functions resolved from a file that never ran, and the assertions happened to
hold against the snapshot too. That is the worse half of the defect — a gate
passing for a reason unrelated to what it claims to check. It stays green after
the fix, now against the six real migrations.

`realtimeSubscriptions` and `notificationPreferenceWiring` were measured as
no-ops today (identical result either way) and routed through the helper anyway,
so they cannot drift into it later.

## The fix

`src/test-utils/migrations.ts` — one place that answers "which files are real?":

* `isInSequence(filename)` — prefix-anchored (`startsWith`, never `includes`, so
  a real migration whose subject contains the word survives).
* `migrationsInSequence(dir)` — sorted `.sql` files in the sequence.
* `selectInSequence(names)` — the same rule over a list, no filesystem.

19 call sites now go through it. The mandate-window gates (`^(\d{14})`) already
excluded these prefixes *by accident* of the digit anchor; they were routed
through the helper too, so the exclusion is stated rather than inherited.

## Verification

Baseline re-measured on `origin/main` @ `616e365` (main moved four times on
2026-09-12, so the earlier number was stale):

| | files | tests |
|---|---|---|
| `origin/main` baseline | 9 failed | 13 failed / 2807 |
| this branch | **1 failed** | **1 failed / 2823** |

The single survivor is `PreviewA11yFourItems` — a product/design call on
`PostCommentsSection`, unrelated to migration resolution, held for Neil.
**Nothing green on main went red.**

### Mutation testing

Green proves nothing on its own; each mutation was run and had to go red.

| mutation | result |
|---|---|
| `isInSequence` always true (the naive behaviour) | red — 16 failures / 10 files: the original 13 plus the helper's own |
| `startsWith` → `includes` | red |
| `PROBE_` dropped from the prefix list | red |
| `.sort()` removed | red |
| `.endsWith(".sql")` removed | red |
| exclusion removed from `migrationsInSequence` only | red |
| an allowlist entry deleted while the file still reads the dir | red |
| a helper-using test reverted to naive `readdirSync` | red |
| a stale allowlist entry naming a file that does not read the dir | red |

**Two mutations survived the first draft of the tests and are recorded because
they were the useful part:**

1. `startsWith` → `includes` survived. The anchoring test used
   `..._add_probe_results_...` in **lowercase**, which `includes("PROBE_")` never
   matches — so the test could not tell the two apart. Fixed by spelling the
   fixture in the same case as the prefix.
2. Deleting `.sort()` survived, twice. `readdirSync` returns sorted entries on
   this filesystem (verified directly, at 5 and 60 entries), so **no fixture
   built from real files can observe the sort** — the temp-directory version
   passed just as happily. Mocking `node:fs` did not work either (hoisted
   factory, then `vi.doMock`, then `vi.spyOn` — ESM namespaces are not
   configurable). Resolved by splitting the pure rule out as `selectInSequence`
   and testing that directly, which is the better shape anyway.

### The regression guard

`src/test-utils/__tests__/migrations.test.ts` fails if a test reads the
migrations directory with its own `readdirSync` without the helper. Seven files
are allowlisted with a reason — each deliberately reads out-of-sequence files
(`adminUserListPagination` and `certificateTiers` resolve `UNAPPLIED_*` files as
their subject; `referralOverloadUnambiguous` and `referralReward0023Withdrawn`
assert such files are *absent* from the runnable set). The allowlist is checked
for staleness in both directions, and the guard asserts it can actually see the
files it polices — without that, a broken walk reports zero offenders and looks
exactly like success.

The guard matches **both** spellings of the path. `edit-window-invariant.spec.ts`
builds it as `join(__dirname, "..", "..", "supabase", "migrations")`, and the
first draft of the guard walked straight past it.

## Not done here, and why

* **The 639 assertions dropped when the bootstrap left the sequence** — out of
  scope by instruction, still open for the Auditor.
* **`20260910_*` files are outside every mandate-window gate.** The `^(\d{14})`
  anchor needs 14 consecutive digits; `20260910_0019_…` has 8 then an underscore,
  so it scores `"0"` and falls below `MANDATE_FROM`. Pre-existing, unrelated to
  the prefixes, and widening the window would pull in new failures — its own unit.
* **`personNameCasing` and `pushPreferences` use `.find()`** — first match, not
  last, so they read a superseded migration
  (`20260815075526_person_name_casing.sql` over the later comment correction).
  Routed through the helper here; the first-vs-last bug is left as its own unit.
* **`no-irregular-whitespace` in `mediaIdentityContainment.test.ts`** is
  pre-existing on `origin/main` (confirmed by stashing) and untouched. Repo-wide
  lint is 2239 errors on main; scoped to the files this branch changes, that one
  is the only error and it is not new.
