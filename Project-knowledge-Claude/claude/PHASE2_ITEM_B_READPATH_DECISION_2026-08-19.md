# Phase 2 — Item B: read-path access decision (analysis only)

**Date:** 2026-08-19 · **STATUS: DONE. Nothing implemented.**
No production grant, no RLS change, no client change, no deployment. Every test below ran inside a transaction that was **rolled back**, and the rollback was verified afterwards.

## RECOMMENDATION: **Option 1 — SECURITY DEFINER RPC**, with mandatory conditions.

Both options enforce visibility correctly when written correctly. The decision is made by **cost that grows** and **failure mode that is detectable**, not by convenience.

## How this was tested without a branch

`execute_sql` supports `begin; set local role …; set local request.jwt.claims …; … ; rollback;`. That gives a real client-role sandbox against real data with no persistence. Proven:

```
inside the transaction : current_user = authenticated, auth.uid() = <the jwt sub>
after every rollback   : column grants 0 · media_objects ACL = postgres, service_role only
                         test functions 0 · non-public posts 0 · reconcile 228/228 green
```

A paid Supabase branch was therefore not required.

## Baseline: the shipped predicate is correct

`can_view_post` (SECURITY DEFINER, STABLE, `search_path=public`, EXECUTE to anon+authenticated) delegates friends to `are_friends` (requires `status='accepted'`). Tested against real users — owner **B**, accepted friend **A**, unrelated **C**, and anon:

| viewer | public | friends | private |
|---|---|---|---|
| owner B | true | true | true |
| friend A | true | **true** | false |
| stranger C | true | false | false |
| anon | true | false | false |
| bogus uuid | — | false | — |

Friendship is symmetric (A↔B both true). **15/15 correct.**

⚠ Note: **all 254 posts in production are currently `public`.** Friends/private posts do not exist yet — the chooser only shipped today. The privacy tests above used synthetic privacy states applied and rolled back.

## Option 2 — column-scoped GRANT: measured behaviour

Grants tested (rolled back):
```sql
GRANT SELECT (id, owner_id, width, height, bytes, mime, visibility, derivatives, state, created_at)
  ON media_objects TO anon, authenticated;
GRANT SELECT (post_id, ord, media_id) ON post_media TO anon, authenticated;
```

| test | result |
|---|---|
| `sha256` readable | **false** ✓ |
| `verified_at` readable | **false** ✓ |
| `quarantine_reason` readable | **false** ✓ |
| `width` readable | true ✓ |
| `select *` | **ERROR 42501 permission denied** ✓ — loud, not silent |
| owner B sees own public / friends / private | 3 / 1 / 1 ✓ |
| friend A | 3 / 1 / **0** — totals 227 of 228 ✓ |
| stranger C | 3 / **0** / **0** — totals 226 ✓ |
| anon | 3 / 0 / 0 — totals 226 ✓ |
| cross-owner | C sees B's media only via B's **public** posts ✓ |
| nested policy evaluation | **works** — `media_objects_select` sub-selects `post_media`+`posts`; both must be granted, and with both granted it evaluates without error |

**Option 2 is correct.** Column grants really do seal `sha256`.

## Option 1 — SECURITY DEFINER RPC: measured behaviour

Correctly written (`… and can_view_post(auth.uid(), p.user_id, p.privacy)`), friend A through the RPC returned **public 3 / friends 1 / private 0** — identical to Option 2.

**And the failure mode, proven:** the same function with that one predicate omitted, granted to `anon`:

```
RPC WITHOUT the predicate / ANON  →  private_rows_leaked: 1
```

SECURITY DEFINER **bypasses RLS entirely**. One missing WHERE clause exposes a private member's photograph to the anonymous internet. There is no second line of defence.

## Performance — the decisive evidence

| shape | execution | buffers | `can_view_post` calls | scaling |
|---|---|---|---|---|
| plain join, no RLS (baseline) | 0.757 ms | 89 | 0 | O(page) |
| **Option 2** — the `media_objects_select` policy expression | **6.211 ms** | 115 | **254** | **O(all posts)** |
| **Option 1** — the RPC body | **0.858 ms** | 167 | **21** | **O(page)** |

The policy plan is the problem:

```
Seq Scan on posts p  (rows=254)  Filter: can_view_post(...)
  → hashed into a SubPlan, evaluated for the whole table
```

Postgres cannot index an opaque `STABLE SECURITY DEFINER` function, so the policy scans **every post on the platform** on every media read. Today that is 254 rows and 8× the baseline. At 25,000 posts it is a 25,000-row scan with 25,000 function calls **per feed page**. The RPC filters to the 20-post page first and calls the predicate 21 times.

## The remaining axes

| axis | Option 1 — RPC | Option 2 — grant |
|---|---|---|
| RLS enforcement | bypassed; the WHERE clause **is** the control | enforced by the engine, defence in depth |
| `sha256` exposure | impossible — not in the return type | blocked by column grant |
| `select(*)` | not applicable | fails loudly, 42501 |
| realtime | **not subscribable** — RPCs cannot be subscribed | subscribable, but neither table is in `supabase_realtime` today (only `posts` is) |
| complexity | one function, one call site | two grants, one nested policy chain |
| failure mode | **silent total exposure** from one missing clause | permission error — noisy, fails closed |
| maintainability | the security rule is visible in one readable function | the rule is split across two policies and a grant list; adding a column silently widens or narrows access |

## Why the RPC wins despite the worse failure mode

The grant option's failure mode is better, but its **cost is unbounded and invisible** — nothing fails, the feed just gets slower for every member as the platform grows, and the cause is buried in a policy expression. The RPC's failure mode is worse but **testable**: it is one function, and a test that calls it as anon against a private post either returns rows or it does not.

That test is the condition of the recommendation.

## Mandatory conditions on Option 1

1. **Return no forbidden column, ever.** The signature returns `(post_id, ord, object_path, width, height, mime, bytes)`. `sha256`, `verified_at` and `quarantine_reason` are not in the return type, so they cannot leak — this is stronger than a grant, because it is structural.
2. **`REVOKE ALL … FROM public`, then `GRANT EXECUTE` to `anon, authenticated` only.**
3. **`SET search_path TO 'public'`** — mandatory on any SECURITY DEFINER function.
4. **A mutation-proven test** that removes the `can_view_post` predicate and requires the suite to go red. The leak above is the exact mutation; it must be pinned the way the migration engine's controls are.
5. **Negative tests as first-class**: anon vs private, stranger vs friends-only, cross-owner — each asserting **zero rows**, not "an error".
6. **No table grants.** `anon`/`authenticated` keep zero privilege on both tables, so a mistake in the RPC cannot be compounded by a second path.
7. **Bound the input.** `_post_ids` must be length-capped (the feed page is 20) so the function cannot be turned into a bulk exporter.

## What did not change

No grant issued. No policy altered. No function created in production (the two test functions were rolled back; verified 0 remaining). No client code touched. No deployment. Production reconcile still **228 / 228, `ref_set_md5 73d4dea4…`**, all counters zero. The 1-photo live delta is untouched and outside the 228.

## Next action

**Item C** — build the RPC and its test suite on a branch or in rolled-back transactions, with the positive and negative cases above, and prove the mutation turns the suite red. No production change until that passes.
