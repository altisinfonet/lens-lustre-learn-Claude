# S10 · X1 mixed-role tables — merge design (PROPOSED, rev 2)

Status: **PROPOSED**. Doc only, no SQL. This is the design that the next X1
files (0615+) will implement. It is written down first so it can be reviewed
on its own.

Rev 1 proposed a single guarded policy per action, merging across role
groups with `(SELECT pg_has_role(...))` guards. Its review **BLOCKED** it (B1).
The reason: a merged policy puts every group's expression into every admitted
role's plan. Table and function privileges, and policy-recursion checks, are
applied when a statement is planned or initialised, whatever the guard later
evaluates to. A visitor (anon) could start getting "permission denied", or
"infinite recursion detected in policy", where today they get rows. Rev 2
drops the cross-group merge entirely (§3, §6).

## 1. What is left

The policy-shape PROBE 0607 (#702; staging 41083370690, production
41085650031) found 56 "uniform" tables and 26 "mixed" ones. On a uniform
table, every permissive policy has the same role set; on a mixed table they
use more than one.

| Uniform tables | Status |
|---|---|
| 53 | Live on both lanes (0608, 0609, 0611, 0612) |
| user_roles | 0613, staging-applied, carry #716 |
| activity_logs, feed_events | 0614, #717 |

The schema dump (`UNAPPLIED_20260911101721_…bootstrap.sql`, permissive
policies only) gives three shapes for the mixed tables:

| Shape | Role groups on the table | Tables (dump) |
|---|---|---|
| M1 | `{public}` and `{authenticated}` | 22 |
| M2 | `{anon, authenticated}` and `{authenticated}` | 5 |
| M3 | `{anon}` and `{authenticated}` | 2 |

The dump lists 29 such tables; the live PROBE counted 26. The live lanes are
the truth. Each batch file re-reads the live shape and refuses if it differs
from what it expects.

## 2. The rule Postgres applies

For a query by user `u` and an action:
- RLS takes that action's permissive policies whose role list contains
  `PUBLIC`, or a role `u` has the privileges of (`check_role_for_policy` →
  `has_privs_of_role`).
- It adds only those policies' expressions to the query, and ORs them.
- Policies that don't apply to `u` are never planned for `u`.

## 3. The merged form (rev 2): merge within a role group only

For one table and one action, take the permissive policies with **exactly
the same role list** (one group). Replace them with one policy, `TO` that same
role list:
- USING is the OR of their USINGs;
- for INSERT/UPDATE, WITH CHECK is the OR of each one's `coalesce(check,
  using)`.

This is the uniform method (0608–0614) applied per (action, role list)
instead of per table. Groups with a single policy are left untouched. No
guards, and no `pg_has_role`.

**Why it is exact, including which errors can happen.** For any user `u` and
action, the set of applicable policies is a union of whole groups. The role
list is unchanged, and every member of a group shares it. After the merge,
`u` gets one policy per applicable group, whose expression is the OR of that
group's original expressions. So:
- the expressions planned for `u` are exactly the same expressions as before,
  only regrouped under fewer policy names;
- the same tables and functions are referenced, so the same privilege checks
  run;
- the same cross-table policy references exist, so the same recursion checks
  apply;
- the OR over applicable expressions is unchanged, so the same rows pass
  USING and WITH CHECK, including UPDATE's need for SELECT visibility,
  RETURNING and ON CONFLICT.

**Limit: evaluation order.** Postgres ORs a user's permissive policies in
**descending** policy-name order. `RelationBuildRowSecurity` scans the
`(polrelid, polname)` index and builds the list with `lcons` ("built in
reverse order"); only restrictive policies are re-sorted. The planner does
not reorder OR arguments by cost. Inside a merged group, the merged text
keeps the original order: parts are joined `ORDER BY polname DESC` (`name`
compares in the "C" collation, like the index). This is now verified with
EXPLAIN: the uniform merges 0608–0613 joined ascending and reversed the
order; #719 (SQL 0615) restores it. Across groups, the merged policies get
new names (`x1_merged_*`), so for a role with two applicable groups the order
of the groups can change. If a branch that used to be
skipped can raise at run time (a cast, `current_setting` without
`missing_ok`, a function that raises), it could now run first. Cost per row
can also shift. Neither SQL nor Postgres guarantees OR evaluation order, and
E3 (plan-time) cannot see it. So the exactness claim above covers rows and
plan-time or rewrite-time errors, not run-time errors from evaluation order.
On uniform tables there is one group, so with descending joins (0614,
and 0608–0613 after #719) the order is unchanged there.

**Grouping keys.**
- The action key is the policy's command, with `ALL` as its own key. Two
  `ALL` policies merge as OR(USING) and OR(coalesce(check, using)). A part
  whose expression is NULL is dropped, as Postgres drops it: a NULL USING
  adds no arm, it is not `true`. PRE-006 refuses the cases where that would
  leave a clause empty. An `ALL`
  policy and a single-command policy with the same role list are not merged
  and stay in the G7 residual.
- Role lists are compared as sorted sets of role names, so
  `{anon,authenticated}` = `{authenticated,anon}`.

**What it does NOT do.** On M1/M2/M3 tables, an action that has one policy in
each group keeps two policies for a signed-in user. Rev 2 does not merge
them, because that is exactly what rev 1 did and B1 blocked. They are
recorded as the **X1 residual**, per table and action, by the PROBE (§5). They
stay as they are unless the Auditor asks for a guarded design with the extra
proof that B1 requires (a privilege-closure check for every admitted role
and a recursion check; see the rev 1 review).

## 4. What it costs, and what it gains

- **Gain, honestly stated:** Postgres already ORs a role's applicable
  permissive policies into one expression. Merging does not reduce the
  expressions evaluated per row. Its effects are:
  - fewer policy objects;
  - the Supabase linter's "multiple permissive policies" findings drop for
    the merged (action, role) pairs;
  - X1's duplicate count (H-2) falls.

  **No query-time gain is claimed or measured.** The same applies to the
  uniform batches 0608–0614; their headers' "Postgres then evaluates one
  policy per action instead of several" means policy objects, not per-row work.
- **Cost:** none expected. Each role plans the same expressions as before.

## 5. How it is proven (same harness as 0613/0614, adapted per group)

- **PRE:**
  - The table's live role lists are exactly the shape the batch expects.
  - At least one (action, role list) group has more than one policy.
  - PRE-006: the USING clause is present, or the WITH CHECK clause for INSERT.
  - The early ACCESS SHARE lock is taken before the snapshot.
- **E1 (before the lock, as postgres):** for each identity × action ×
  merged group × clause, the union of the rows each original group member
  accepts must equal the rows the merged text accepts. This is the same check
  as 0612–0614, keyed by group.
- **BIND, E2-after, WIN and the lock as in 0613/0614.** E2 runs through real
  RLS as `anon` and `authenticated`.
- **E3 (new):** for each role, run `EXPLAIN` of a representative statement
  in a sub-block, under that role. Planning and executor start with
  EXPLAIN-only apply the table and function privilege checks and the
  recursion check, without executing. E3 is the check that B1 showed rev 1
  lacked.
  - **When:** E3 runs **before the DDL and again after it**, in the same
    transaction.
  - **Pass rule:** for every (role, statement), the outcome must be
    identical: OK, or the same error code and message. Any difference
    refuses the file.
  - **Statements:** `SELECT`; `INSERT … RETURNING *`;
    `UPDATE … SET <col> = <col> RETURNING *`; `DELETE … RETURNING *`; and
    `INSERT … ON CONFLICT … DO UPDATE … RETURNING *` where a unique key
    exists.
  - **Roles:** every role that has any privilege on the table, from
    `aclexplode(coalesce(relacl, acldefault('r', relowner)))` and
    `aclexplode(pg_attribute.attacl)` for column grants, expanded through
    role inheritance. Each is then confirmed with `has_table_privilege` or
    `has_any_column_privilege`. Not `information_schema`, which hides grants made by other
    grantors. A PUBLIC grant makes every role a candidate; E3 then covers
    anon, authenticated and every role named in the policies.
  - **Exclusions:** roles that bypass RLS, measured per lane: superusers,
    `rolbypassrls`, and every role with the table owner's privileges unless
    FORCE RLS is on (`check_enable_rls` uses the owner check).
  - **If a role cannot be tested:** if the applying role cannot `SET ROLE`
    to a discovered role, E3 refuses the file rather than skipping it.
  - **Masking:** a role without privilege can hit a rewrite-time or
    plan-time error before the table privilege check. The first error may
    differ before and after (for example if the order across groups changed
    which error fires first). If it does, E3 refuses the file: a false
    refusal, never a miss.
  - **Statements** run with and without `RETURNING`. `UPDATE` uses a column
    the role may update; without RETURNING it sets that column to a
    constant, so it reads no column and the UPDATE-only policy path is
    tested on its own. Column-level grants then do not hide the INSERT and
    UPDATE policy paths.
  - **Scope:** E3 does not see run-time errors (§3 limit).
- **POST:**
  - Per (action, role list): exactly one policy where there was more than one.
  - Groups with one policy are byte-identical.
  - Restrictive policies are byte-identical.
  - Role lists are unchanged (POST-006 per group).
  - The backup is owner-only.
- **PROBE:**
  - G2: no two permissive policies with the same (action, role list).
  - G5/G6 per group.
  - **G7 lists the residual:** for each table and action (counting `ALL`
    as every action), the pairs of remaining permissive policies that both
    apply to some role. "Apply" uses privilege inheritance
    (`has_privs_of_role` semantics, which respect NOINHERIT), not bare
    membership, over every role with a privilege on the table, PUBLIC
    included, and with E3's exclusions for roles that bypass RLS. Whether M3
    (`{anon}` and `{authenticated}`) is residual is measured per lane, not
    asserted. On Supabase, `authenticator` is a NOINHERIT member of both and
    inherits neither, and `postgres` bypasses RLS, so it is excluded. G7 prints names only and does not
    fail.

## 6. Rejected: the rev 1 guarded merge

A single policy `TO` the union, with `(SELECT pg_has_role(...))` guards per
group, gives the same rows *if it plans without error for every admitted
role*. It was rejected for this programme for four reasons:
- **B1:** it puts other groups' expressions into every role's plan, so it
  can create privilege and recursion errors that do not exist today. This
  repo revokes anon access to several tables and functions that such
  expressions may reference.
- It adds plan-time work for visitors with no measured gain (§4).
- It needs an extra edge check: views not using `security_invoker`, and
  non-view rewrite rules, run under the owner's id, where `pg_has_role` and
  RLS can disagree.
- Its BIND must compare against the server's rewritten guard text,
  `( SELECT pg_has_role('authenticated'::name, 'USAGE'::text) AS pg_has_role)`.

**Measured (local Postgres 16, 2026-10-30).** Setup: a table readable by anon,
with one policy `TO anon`, `USING ((SELECT pg_has_role('authenticated','USAGE'))
AND <branch>)`. The guard is false for anon. Results:

| Branch | Anon runs | Result |
|---|---|---|
| reads a table anon may not SELECT | bare `EXPLAIN SELECT` | ERROR `permission denied for table …` |
| calls a function anon may not EXECUTE | bare `EXPLAIN SELECT` | ERROR `permission denied for function …` |
| calls a function anon may not EXECUTE | real `SELECT` | the same error |

So B1 is real, and E3's mechanism (EXPLAIN-only raises the privilege errors)
works. A branch hidden behind a literal `false` is folded away at plan time
and raises nothing, so the test needs a run-time guard, as above.

## 7. Batches and limits

- Batches follow the measured proof cost and traffic, as before:
  - low-traffic config tables first;
  - then content tables;
  - hot tables (profiles, follows, comments and reactions,
    competition_entries) alone or in pairs, with the lean lock.
- Tables whose every multi-policy action is cross-group (nothing to merge
  within a group) are skipped and appear only in the G7 residual.
- Roles outside {PUBLIC, anon, authenticated} in a policy list are handled the
  same way (grouping is by exact list). E3 covers them if they have a grant.
- Not measured: query-time effect (§4). The only possible per-row effect,
  in either direction, is the cross-group order change (§3 limit). A load
  test is out of scope.
- **Policy names change.** Merging removes the original policy names. Any
  later or replayed migration that runs `DROP POLICY IF EXISTS "<old>"` then
  `CREATE POLICY` would silently bring back a duplicate, and `ALTER POLICY
  "<old>"` would fail. That includes the `UNAPPLIED_…bootstrap.sql` dump.
  The backup table keeps the old names for reference, and the PROBE's G2/G7
  would show a reintroduced duplicate.
- **Lock upgrade and deadlocks.** The file holds weaker locks first: ACCESS
  SHARE taken early, plus the locks E3-before takes (ROW EXCLUSIVE from
  EXPLAIN of INSERT/UPDATE/DELETE). It then upgrades to ACCESS EXCLUSIVE.
  Any transaction that touches these tables in a conflicting order can
  deadlock with it: for example, one holding a lock on table B and waiting
  on table A, queued behind this file. Postgres aborts one side, or
  `lock_timeout` (2 s) fires. If the file is the side aborted, it rolls back
  with nothing changed and is re-run at a quieter time. If the other side is
  aborted, that transaction is aborted with a deadlock error.
