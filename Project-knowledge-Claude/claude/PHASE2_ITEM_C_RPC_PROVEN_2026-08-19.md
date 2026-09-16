# Phase 2 — Item C: the media read RPC, built and proven

**Date:** 2026-08-19 · **ITEM C: PASS.**
Nothing was deployed. No grant issued, no RLS altered, no client code touched, no production data modified. Every suite ran inside a transaction that was **rolled back**, and the rollback was verified afterwards.

## The artifact

`post_media_for.sql` — 89 lines, sha256 `65064da003304bab80c4016defefedb3eb610ca5794a2e3e1635090facc86bea`

```sql
create or replace function public.post_media_for(_post_ids uuid[])
returns table (post_id uuid, ord int, object_path text,
               width int, height int, mime text, bytes bigint)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if _post_ids is null or array_length(_post_ids,1) is null then return; end if;
  if array_length(_post_ids,1) > 50 then
    raise exception 'MEDIA-1001 at most 50 post ids per call, got %',
      array_length(_post_ids,1) using errcode = '22023';
  end if;
  return query
    select pm.post_id, pm.ord, mo.derivatives->>'original',
           mo.width, mo.height, mo.mime, mo.bytes
    from public.post_media pm
    join public.media_objects mo on mo.id = pm.media_id
    join public.posts p          on p.id  = pm.post_id
    where pm.post_id = any(_post_ids)
      and public.can_view_post(auth.uid(), p.user_id, p.privacy)  -- ⚠ the whole control
    order by pm.post_id, pm.ord;
end; $$;
revoke all on function public.post_media_for(uuid[]) from public;
grant execute on function public.post_media_for(uuid[]) to anon, authenticated;
```

No grant on either table is included, deliberately.

## Suite 1 — visibility matrix · 4/4 PASS

Test posts (owner **B**): public `21a5cd27` (3 slides), friends `825368a1` (1), private `85daaa86` (1). Privacy states synthetic, rolled back.

| viewer | public | friends | private | total | pass |
|---|---|---|---|---|---|
| OWNER B | 3 | 1 | 1 | 5 | ✅ |
| FRIEND A (accepted) | 3 | **1** | **0** | 4 | ✅ |
| STRANGER C (authenticated) | 3 | **0** | **0** | 3 | ✅ |
| ANON | 3 | **0** | **0** | 3 | ✅ |

Cross-owner: stranger C asking directly for B's private post → **0 rows**.

## Suite 2 — input validation and the cap · 7/7 PASS

| # | test | got | want |
|---|---|---|---|
| 2.1 | null input | 0 | 0 ✅ |
| 2.2 | empty array | 0 | 0 ✅ |
| 2.3 | nonexistent post id | 0 | 0 ✅ |
| 2.4 | mixed real + nonexistent | 3 | 3 ✅ |
| 2.5 | duplicate ids do not duplicate rows | 3 | 3 ✅ |
| 2.6 | exactly 50 ids (at the cap) | **50** | 50 ✅ |
| 2.7 | 51 ids (over the cap) | **22023 MEDIA-1001** | raise ✅ |

**Note on 2.6:** my first run asserted 61 and reported a fail. That was a wrong expectation in the test, not a defect. Independently derived from the database — `select count(*) from post_media where post_id in (select id from posts order by id limit 50)` → **50**. The RPC returned exactly that. Re-scored PASS against the derived value.

## Suite 3 — privilege surface and forbidden columns · 17/17 PASS

| # | check | result |
|---|---|---|
| 3.01 | SECURITY DEFINER | true ✅ |
| 3.02 | STABLE | s ✅ |
| 3.03 | search_path pinned | `search_path=public` ✅ |
| 3.04 | EXECUTE **not** granted to PUBLIC | true ✅ |
| 3.05–3.06 | EXECUTE granted to anon, authenticated | true, true ✅ |
| 3.07 | return column count | 7 ✅ |
| 3.08 | `sha256` absent from return type | true ✅ |
| 3.09 | `verified_at` absent | true ✅ |
| 3.10 | `quarantine_reason` absent | true ✅ |
| 3.11 | `owner_id` absent (client does not need it) | true ✅ |
| 3.12–3.15 | anon/authenticated table privilege on both tables | **false ×4** ✅ |
| 3.16 | authenticated column privilege on `sha256` | false ✅ |
| 3.17 | full signature | `TABLE(post_id uuid, ord integer, object_path text, width integer, height integer, mime text, bytes bigint)` ✅ |

Forbidden columns are excluded **structurally**. There is no `select *` against a function's return type, so this is stronger than a column grant.

## Suite 4 — the three-state mutation test · PASS

| state | anon sees private | stranger sees friends-only | friend sees private | suite | expected |
|---|---|---|---|---|---|
| 1 CORRECT | 0 | 0 | 0 | **GREEN** | GREEN ✅ |
| 2 **MUTATED** — `can_view_post` deleted | **1** | **1** | **1** | **RED** | RED ✅ |
| 3 RESTORED | 0 | 0 | 0 | **GREEN** | GREEN ✅ |

The mutation is a single deleted line. With it gone, an **anonymous** caller reads a private member's photograph. The suite detects it on all three axes at once. This is the evidence that the test is real and not decorative.

## Suite 5 — performance and scaling · PASS

Query plan, feed page of 20:

```
Nested Loop … rows=21   Execution Time: 0.858 ms
  Index Scan using posts_pkey on posts p  (loops=21)
    Filter: can_view_post(...)         ← 21 evaluations, one per page row
```

Page of 50:

```
rows=57   Execution Time: 2.118 ms
  Index Scan using posts_pkey on posts p  (loops=57)
```

Against the rejected alternative, measured the same day:

| shape | execution | `can_view_post` calls | scaling |
|---|---|---|---|
| plain join, no access control | 0.757 ms | 0 | O(page) |
| **column-grant policy expression** | **6.211 ms** | **254** — `Seq Scan on posts` | **O(all posts)** |
| **this RPC** | **0.858 ms** | **21** — `Index Scan`, loops = page | **O(page)** |

Wall-clock through the function itself (5 iterations each, `set_config` JWT, rolled back):

| page size | rows | ms/call | ms per post |
|---|---|---|---|
| 1 | 0 | 1.595 | 1.5950 |
| 5 | 3 | 0.783 | 0.1566 |
| 20 | 21 | 2.294 | 0.1147 |
| 50 | 57 | 1.846 | 0.0369 |

Timings are dominated by fixed per-call overhead and are **flat across a 50× range of page size** — the population size does not enter. The plan is the proof, not the clock.

**Conclusion:** the predicate is evaluated once per row of the requested page, via an index scan on `posts_pkey`. It never scans the posts table.

## Rollback and production state — verified 16:55:03 UTC

```
test functions left in production        0
column grants to anon/authenticated      0
media_objects ACL   postgres=arwdDxtm/postgres ; service_role=arwdDxtm/postgres
post_media ACL      postgres=arwdDxtm/postgres ; service_role=arwdDxtm/postgres
non-public posts left                    0     (all synthetic privacy rolled back)
posts total                            254
post_media 228 · media_objects 228 · ref_set_md5 73d4dea406d3c37b67a23f583820b837
all six anomaly counters                 0
references on the live 1-photo delta     0     (still outside, untouched)
```

## Exact production changes still pending

1. Commit `supabase/functions/…` — no. **Commit a migration** containing `post_media_for.sql` to the repo (new timestamped file under `supabase/migrations/`).
2. Apply that migration to production (creates the function, revokes PUBLIC, grants EXECUTE to `anon`, `authenticated`).
3. Add `src/__tests__/postMediaForSecurity.test.ts` pinning the return signature, the absence of the three forbidden columns, the cap, and the presence of the `can_view_post` predicate — plus a mutation entry in `tools/` so removing the predicate turns the suite red in CI, the way the migration engine's controls are pinned.
4. **No table grants. Ever.** Any future commit that adds `GRANT … ON media_objects` should be treated as a regression.

## ITEM C: PASS

Recommendation stands: **deploy the RPC, not the grants.** GO for production deployment of `post_media_for`, subject to your approval, with the mutation test committed in the same change.

Item D (extending `detect-orphan-files`) and the client switch remain **not started**.
