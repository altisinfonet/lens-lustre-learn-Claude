# PHASE 1 · CONTROL CYCLE 4 — read-only

No production change. No repair. No baseline. No `db push`. No rename executed.

---

# PART 2 — DEPENDENCY / ORDER ANALYSIS

## Pair `20260801160000`

| | A — `notifications_history_and_grouping` | B — `require_own_profile_photo` |
|---|---|---|
| CREATES | `get_my_notifications_grouped()`, `idx_user_notif_user_created` | `has_profile_photo()` + **3 RLS policies** |
| policies | none | `posts`, `post_comments`, `comments` |
| triggers / types | none | none |
| ALTER TABLE / ADD COLUMN | none | none |
| GRANT / REVOKE | 1 (`GRANT EXECUTE … TO authenticated`) | none |
| DML (data transformation) | none | none |
| tables read | `user_notifications`, `posts`, `profiles` | `profiles` |
| calls | `get_my_notifications_grouped` (itself) | `has_profile_photo` (itself), `has_role` (pre-existing) |

**Dependency: NONE, in either direction.** B references nothing A creates; A
references nothing B creates. The only shared name is `profiles`, and **neither
file alters it** — both only read it. A creates no policy; B touches no
notification object.

## Pair `20260810120000`

| | A — `bell_actor_known` | B — `tag_anyone_not_only_friends` |
|---|---|---|
| CREATES | `get_my_unread_notifications_grouped()` | `validate_post_tag_insert()` + **1 RLS policy** on `post_tags` |
| DROPs | its own prior function signature | its own prior policies on `post_tags` |
| GRANT / REVOKE | 1 | none |
| DML | none | none |
| tables read | `user_notifications`, `posts`, `profiles` | `post_tags` |
| calls | `notif_group_key` (pre-existing) | itself |

**Dependency: NONE, in either direction.** Disjoint objects, disjoint tables,
disjoint policies. Each drops only what it itself replaces.

## THE ORDERING RULE — and why it is not "second alphabetically"

Because no dependency exists in either pair, **any order is correct**. That
makes the choice a question of which rename changes the least. The rule adopted:

> **PRESERVE THE CURRENT DIRECTORY-SORT ORDER.** The file that sorts FIRST today
> keeps `…0000`; the file that sorts SECOND takes `…0001`.

Justification: a directory-ordered apply today would run them in sort order.
Renumbering the second preserves that exact sequence, so the post-rename apply
order is provably identical to the pre-rename one. No other choice can claim
that. Alphabetical position is the *mechanism*; order-preservation is the
*reason*, and it is only valid because the dependency analysis above found none.

## PROPOSED EXACT FOUR FILENAMES

```
KEEP     supabase/migrations/20260801160000_notifications_history_and_grouping.sql
RENAME   supabase/migrations/20260801160000_require_own_profile_photo.sql
      →  supabase/migrations/20260801160001_require_own_profile_photo.sql

KEEP     supabase/migrations/20260810120000_bell_actor_known.sql
RENAME   supabase/migrations/20260810120000_tag_anyone_not_only_friends.sql
      →  supabase/migrations/20260810120001_tag_anyone_not_only_friends.sql
```

## PRE-RENAME PROOF (all required checks, passed)

```
exists  hash                                      bytes  file
YES     1667738717bfd730f7b8503591ef9307129bb6af   7625  20260801160000_notifications_history_and_grouping.sql
YES     b1f43e253b91c734bd47bbb9c9900e560f1671f6   4961  20260801160000_require_own_profile_photo.sql
YES     003542a4cd04240ac6bbfb97ff7c0b40998b6ff4   7967  20260810120000_bell_actor_known.sql
YES     699e17ec14d1675fae548709f73f3a5679606f6e   4467  20260810120000_tag_anyone_not_only_friends.sql

target 20260801160001 -> 0 existing files       target 20260810120001 -> 0 existing files
no migration text anywhere references either target version
simulated post-rename duplicate scan -> ZERO duplicates remain
```

Contents are unchanged by definition: the operation is `git mv` only, which must
report `R100` and `0 insertions(+), 0 deletions(-)`. Post-rename hashes must
equal `b1f43e25…` and `699e17ec…` exactly.

## ➜ STOPPING FOR APPROVAL OF THE EXACT RENAME.

---

# PART 3 — FINAL READ-ONLY LEDGER RECONCILIATION

| # | Item | Result |
|---|---|---|
| 1 | Complete Git migration version set | **616** unique 14-digit versions across **618** `.sql` files |
| 2 | Complete production ledger version set | **19** |
| 3 | Intersection | **19** — every ledger version exists in Git |
| 4 | Git-only historical versions | **597** |
| 5 | Production-only versions | **0 — none** ✅ (was 1 before Cycle 2's rename; now resolved) |
| 6 | Remaining duplicate versions | **2** — `20260801160000`, `20260810120000` (Part 2) |
| 7 | Potentially unapplied versions | **0** — no Git version in the ledger era lacks a ledger row |
| 8 | Files objectively verifiable in production | **387** declare a named table / function / index |
| 9 | Files needing special verification | **499** contain DML, GRANT/REVOKE, POLICY, TRIGGER, TYPE or ALTER TABLE (318 are in both classes; 50 files are in neither) |

Item 9 is the honest limit of this exercise: a policy, a grant or a data
transformation cannot be verified by asking "does this object exist". 499 files
carry at least one such effect. Baselining records them as applied without
proving their *effect* is what Git intends. That is a residual risk of any
baseline and must be stated, not designed away.

## 10 — EXACT PROPOSED REPAIR — NOT EXECUTED

**Use the direct SQL form, not the CLI**, for the reason in item 12.

```sql
-- Records 597 historical migrations as already applied.
-- Executes none of their SQL. Metadata only. Run AFTER the Part 2 renames.
insert into supabase_migrations.schema_migrations (version, name)
values
  ('20260213084106', '<name from filename>'),
  …                                    -- 597 rows, generated from the filenames
on conflict (version) do nothing;
```

The 597-version list is generated mechanically:

```
ls supabase/migrations/*.sql | sed 's|.*/||' | grep -oE '^[0-9]{14}' \
  | sort -u | awk '$1 < "20260813171159"'
```

## 11 — EXACT EXPECTED LEDGER STATE AFTER REPAIR

```
ledger_rows          19  ->  616
ledger_min_version   20260813171159  ->  <the earliest Git version, Feb 2026>
ledger_max_version   20260817051750  ->  20260817051750   (UNCHANGED)
Git-only versions    597 -> 0
production-only      0   -> 0
duplicates           0 (after Part 2)
```

**Every other value in the item-13 snapshot must be byte-for-byte identical.**
Any change to tables, views, functions, indexes, policies, triggers,
constraints or row counts means the operation did something it must not have,
and is grounds for immediate rollback (`delete from
supabase_migrations.schema_migrations where version in (…)`).

## 12 — PROOF THAT REPAIR IS METADATA-ONLY

The proof is the form of the statement, not a claim about a tool's internals:

- The proposed statement is a single `INSERT` into
  `supabase_migrations.schema_migrations`. It names no other relation. It
  contains no `EXECUTE`, no `DO`, no function call. **It is metadata-only by
  inspection** — anyone can read it and confirm that in seconds.
- It is idempotent (`on conflict do nothing`) and reversible by an exact
  `DELETE` of the same version list.
- **This is why I recommend the SQL form over `supabase migration repair`.**
  The CLI's documented contract is the same, but its behaviour is a claim about
  code I have not read. The SQL form is verifiable by inspection.
  Per rule 29, a documented contract is not evidence.
- Item 13's snapshot, taken immediately before and immediately after, is the
  empirical confirmation that nothing else moved.

## 13 — PRODUCTION SNAPSHOT (taken 2026-08-17, re-run immediately before repair)

```
ledger_rows           19
ledger_min_version    20260813171159
ledger_max_version    20260817051750
tables                145
views                  10
functions             374
indexes               436
policies              686
triggers              148
constraints          1318
posts                 231        ← live, members are posting; expect drift
profiles               95
competition_entries     0
wallet_transactions   154
user_notifications   2624
```

Row counts drift because the platform is live. **The schema counts must not.**
Tables, views, functions, indexes, policies, triggers and constraints are the
values that prove a metadata-only operation stayed metadata-only.
