# S10 · X1 mixed-role tables — merge design (PROPOSED)

Status: **PROPOSED**. No SQL in this unit. It is the design that the next
X1 files (0615+) will implement, written down first so it can be reviewed on
its own.

## 1. What is left

The policy-shape PROBE 0607 (#702; staging 41083370690, production
41085650031) found 56 "uniform" tables and 26 "mixed" ones. On a uniform table,
every permissive policy has the same role set. On a mixed table, the
permissive policies are granted to more than one role set.

| Uniform tables | Status |
|---|---|
| 53 | Live on both lanes (0608, 0609, 0611, 0612) |
| user_roles | 0613, staging-applied, carry #716 |
| activity_logs, feed_events | 0614, #717 |

The schema dump (`UNAPPLIED_20260911101721_…bootstrap.sql`, permissive
policies only) gives three shapes for the mixed tables:

| Shape | Role sets on the table | Tables (dump) |
|---|---|---|
| M1 | `{public}` + `{authenticated}` | 22 |
| M2 | `{anon, authenticated}` + `{authenticated}` | 5 |
| M3 | `{anon}` + `{authenticated}` | 2 |

The dump lists 29 such tables; the live PROBE counted 26. The live lanes are
the truth. The first file of each batch re-reads the shape and refuses if it
differs from what it expects (§5, PRE).

On 4 of them (newsletter_subscribers, test_agent_config, test_agent_runs,
user_notifications), no single action has policies from more than one role
set. Every action there has one role set, so the uniform method applies **per
action**: group by (action, role set) instead of by table. Shape K0 below
covers this case.

## 2. The rule Postgres applies

For a query by user `u`, RLS takes the permissive policies of the action
whose role list contains `PUBLIC`, or a role that `u` has the privileges of.
It ORs their expressions; a row passes if any one is true. In
`rowsecurity.c`, `check_role_for_policy` tests `has_privs_of_role(u, role)`,
which counts inherited membership only.

`pg_has_role(role, 'USAGE')` is the SQL form of that same test for the current
user, `has_privs_of_role(GetUserId(), role)`.

## 3. The merged form

For one table and one action, split the original permissive policies into
role groups G₁…Gₖ, one per distinct role list. Each group gets one
expression: the OR of its members' USING clauses, or for INSERT/UPDATE checks
the OR of each member's `coalesce(check, using)`.

- **K0 (k = 1 for this action):** exactly the uniform merge. One policy, `TO`
  the group's roles. No guard.
- **K≥2:** one policy, `TO` the union of the groups' roles (`PUBLIC` if any
  group is `PUBLIC`):

      USING ( (g₁ guard AND (e₁)) OR (g₂ guard AND (e₂)) OR … )

  The guard of a group is:
  - nothing (true) when the group's roles include `PUBLIC` or equal the
    policy's `TO` list;
  - otherwise `(SELECT pg_has_role('<role>', 'USAGE'))`, ORed over the
    group's roles. The sub-SELECT makes it an InitPlan, evaluated once per
    query, the same trick as X2.

Per shape:

| Shape | Merged policy | Visitors (anon) | Signed-in (authenticated) |
|---|---|---|---|
| M1 | `TO PUBLIC USING (e_pub OR ((SELECT pg_has_role('authenticated','USAGE')) AND e_auth))` | `e_pub` only | both |
| M2 | `TO anon, authenticated USING (e_both OR ((SELECT pg_has_role('authenticated','USAGE')) AND e_auth))` | `e_both` only | both |
| M3 | `TO anon, authenticated USING (((SELECT pg_has_role('anon','USAGE')) AND e_anon) OR ((SELECT pg_has_role('authenticated','USAGE')) AND e_auth))` | `e_anon` only | `e_auth` only |

In M1, any other role (for example `authenticator`, which is NOINHERIT) gets
`e_pub` only, exactly as today.

**Why it is exact.** For any user `u`, the guard of group Gᵢ is true exactly
when Postgres would have applied Gᵢ's policies to `u`. `pg_has_role(...,
'USAGE')` and `check_role_for_policy` use the same test. The union `TO` list
admits `u` exactly when at least one group applied. So the merged expression
is true for a row exactly when the OR of the applicable originals was true.

**Known edge:** a view owned by a role other than the caller, without
`security_invoker`. RLS then applies as the view owner (`checkAsUser`), while
`pg_has_role` inside the expression tests the current user. Before any
batch, PRE lists every view and every SECURITY DEFINER function that reads
the batch's tables, then:
- **refuses** if any such view is owned by a role other than `postgres`
  (`postgres` bypasses RLS, so no policy applies);
- **refuses** if any such function is owned by a role other than `postgres`
  (`postgres` again bypasses RLS).

## 4. What it costs

- **Before:** an M1 SELECT for a signed-in user evaluated 2+ policies.
- **After:** it evaluates one policy with one InitPlan guard (one catalog
  lookup per query). For visitors the guard is false, so the `AND` stops
  there and e_auth is not evaluated for each row. This is not a plan-time
  removal.

This is the same per-query/per-row trade X2 made.

## 5. How it is proven (same harness as 0613/0614, with these changes)

- **PRE:**
  - The table's role sets are exactly the shape the batch expects.
  - PRE-006 still applies (USING, or WITH CHECK for INSERT).
  - The view/function ownership check from §3.
  - The role lists contain only `PUBLIC`, `anon` and `authenticated`. Anything
    else refuses; a later design handles it.
- **E1 (before the lock, as postgres):** per identity × action × clause, the
  union of the rows each **applicable** original accepts (applicability
  decided by `pg_has_role(<identity role>, <policy role>, 'USAGE')`, the
  3-argument form) must equal the rows the merged text accepts. Each guard
  sub-SELECT is replaced by the literal value it would have for that identity,
  computed by the same 3-argument call. The substitution is textual on the
  exact guard string the plan generated, and BIND (below) ties the stored text
  back to it.
- **BIND (inside the lock):** the stored policy text equals the plan text
  byte-for-byte, guards included. This is stronger than the row-based BIND of
  0612–0614: the guarded text cannot be evaluated as postgres without the
  substitution, so the text itself is compared.
- **E2 (inside the lock, through real RLS as `anon` and `authenticated`):**
  same as today. This is the check that evaluates the real guards.
- **Identities:** today's set (anon; up to 3 per app role; up to 3 owners per
  owner column; 3 members). Plus one identity per extra role that has
  privileges on the table (from `information_schema.role_table_grants`), so
  that `PUBLIC` groups are proven for roles other than anon and authenticated.
- **POST:**
  - POST-005 per action.
  - POST-006 adapted: the merged `TO` list equals the union of the original
    groups' lists.
  - Restrictive policies byte-identical.
  - The WIN cap and early ACCESS SHARE as in 0613.
- **PROBE:**
  - G2/G3/G5 per action.
  - G6 adapted to the union `TO` list.
  - **G7:** every guard in a stored merged policy is one of the three exact
    InitPlan forms above.

## 6. Batches

By measured proof cost (PROBE 0610) and traffic, the same way as before:

- **Low-traffic config tables** (badge_definitions, faq_entries, site_settings,
  system_flags, role_display_config, judging_tags, test_agent_*, …).
- **Content tables** (albums, highlights, stories, featured_*, course_modules, …).
- **Hot:** profiles, follows, comments and reactions, competition_entries,
  alone or in pairs, with the lean lock.

## 7. Not decided here / limits

- §3's equivalence rests on `pg_has_role(...,'USAGE')` and
  `check_role_for_policy` using the same test (`has_privs_of_role`, read from
  the Postgres source). SQL cannot call `check_role_for_policy` directly. The
  direct comparison is therefore E2: for each identity role (anon,
  authenticated and every extra role with a grant), the rows real RLS shows
  before (originals) and after (guarded merge) must be identical.
- If a lane has a role list outside {PUBLIC, anon, authenticated}, that table
  is skipped and listed. This design does not cover it.
- Query-time gain is not measured (no load test). The claim is one policy per
  action instead of several.
