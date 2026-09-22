# G11 SPEC — Top Contributors: show the 30-day score that decides the rank

**Owner decision, 2026-08-27. Specification only — no code in this document has been applied.
The frozen candidate `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` is untouched.**

---

## 1 · THE DEFECT — three symptoms, one cause

`get_top_contributors_v2` **ranks by the rolling 30-day score** and **displays the lifetime score**. The
30-day number is never returned, so the card shows a rank derived from a number nobody can see.

**Verified against production, 2026-08-27:**

| Rank | Name | Displayed (lifetime) | **Actual ranking number (30-day)** | Bar width computed |
|---|---|---|---|---|
| 🥇 1 | Mainak Mridha | 9,551 | **7,055** | 100% |
| 🥈 2 | Amit Baran Sen | 8,888 | **6,978** | 93% |
| 🥉 3 | Dipannita Sen | **11,546** | **6,823** | **121% → clipped to 100%** |

**The ranking is correct** — 7,055 > 6,978 > 6,823, in order. Three things go wrong in the UI:

1. **The number contradicts the rank.** Third place shows the highest number on the card.
2. **The progress bar inverts the ranking.** `Index.tsx:1056` computes
   `c.contributor_score / topContributors[0].contributor_score`. For rank 3 that is `11546 / 9551` =
   **121%**. The row has `overflow-hidden`, so it clips to a **completely full bar** — **the last-place
   row renders the fullest bar on the card.** This is the strongest visual signal and it points the wrong way.
3. **No label distinguishes the two numbers**, so a reader has no way to know they are different measures.

---

## 2 · THE DECISION BEING REVERSED — record it, do not bury it

The 2026-08-11 migration hard-codes the opposite intent, in three places:

> *"The 30-day number is NEVER returned, so it cannot reach the UI by accident."*
> *"Top Contributor ranking = recent 30-day activity, while Contributor Score displayed under name =
> current lifetime contribution."*
> *"The ranking should feel like recognition, not a 'time spent on app' competition."*

**Owner, 2026-08-27: reversed for the Top Contributors card only.** The lifetime Contributor Score
**remains unchanged** everywhere else — see §3.

**This reversal must be stated in the new migration's header**, or the next reader sees the old comment
and concludes something regressed.

---

## 3 · BLAST RADIUS — what is and is not touched

| Surface | Function | Changed? |
|---|---|---|
| **Home page Top Contributors card** (`pages/Index.tsx:1054`) | `get_top_contributors_v2` | ✅ **YES** |
| **Logged-out feed sidebar card** (`FeedRightSidebar.tsx:294`, `{!user && …}`) | same hook | ✅ **YES** — owner chose "change both"; `SidebarTopContributors.tsx:67` requires it must not drift from `Index.tsx` |
| **Contributor Score under usernames in the feed** | `get_contributor_scores` → `contributorScore.ts` → `ContributorScore.tsx` | ❌ **NO — different function, different component. Not touched.** |
| `get_top_contributors_v1` | — | ❌ **NO** — kept for rollback; a test asserts it is never dropped |
| `contributor_points_since` | — | ❌ **NO** — the maths does not change |

**No score changes value. No member's ranking changes. Only which number is displayed.**

---

## 4 · MIGRATION

> ### ⚠ TWO THINGS THAT WILL BREAK THIS IF MISSED
> **(a) `CREATE OR REPLACE` will fail.** Adding a column to `RETURNS TABLE` changes the function's return
> type; PostgreSQL rejects it with *"cannot change return type of existing function"*. **`DROP` first.**
> **(b) `DROP` destroys the grants.** The 2026-08-11 migration ends with
> `GRANT EXECUTE … TO anon, authenticated`. **Omit the re-grant and the card silently breaks for every
> logged-out and logged-in visitor while still working for you as admin.** This is the most likely way
> this change ships broken.
> Migrations run in a transaction, so `DROP` + `CREATE` is atomic — there is no window where the function
> is missing.

```sql
-- Top Contributors: display the 30-day score that decides the rank.
--
-- Owner, 2026-08-27. This REVERSES the 2026-08-11 decision that the 30-day score
-- must never reach the UI. That decision produced a card where third place showed
-- the highest number (lifetime 11,546 vs 9,551) and where the progress bar, scaled
-- by lifetime score, computed 121% for the last-ranked member and clipped to a full
-- bar — the lowest rank rendering the fullest bar.
--
-- The lifetime Contributor Score is UNCHANGED and still shown under member names in
-- the feed by get_contributor_scores. Only this card changes.
--
-- contributor_score is retained in the return so nothing that reads it breaks and so
-- the card can show both later without another signature change.
--
-- DROP is required: adding a column changes the return type, which CREATE OR REPLACE
-- cannot do. The GRANT below is re-issued because DROP removes it.

DROP FUNCTION IF EXISTS public.get_top_contributors_v2();

CREATE FUNCTION public.get_top_contributors_v2()
RETURNS TABLE (
  user_id           uuid,
  rank_position     integer,
  contributor_score integer,   -- lifetime, retained
  recent_score      integer    -- NEW: the 30-day score the ranking uses
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH recent AS (
    SELECT r.uid, r.score
    FROM public.contributor_points_since(
      ((now() AT TIME ZONE 'UTC')::date - 29)
    ) r
    WHERE r.score > 0
  ),
  lifetime AS (
    SELECT l.uid, l.score FROM public.contributor_points_since(NULL::date) l
  ),
  ranked AS (
    -- rc.score is now carried through so it can be returned. The ORDER BY and the
    -- uid tie-break are unchanged, so no member's position moves.
    SELECT rc.uid,
           rc.score,
           ROW_NUMBER() OVER (ORDER BY rc.score DESC, rc.uid) AS pos
    FROM recent rc
  )
  SELECT rk.uid,
         rk.pos::integer,
         ROUND(COALESCE(lf.score, 0))::integer,
         ROUND(rk.score)::integer
  FROM ranked rk
  LEFT JOIN lifetime lf ON lf.uid = rk.uid
  WHERE rk.pos <= 3
  ORDER BY rk.pos;
$fn$;

COMMENT ON FUNCTION public.get_top_contributors_v2() IS
  'Home page Top Contributors. Ranked by rolling last 30 UTC days and now RETURNS that 30-day score as recent_score, which the card displays. Lifetime contributor_score is retained in the return but no longer shown on this card; it is unchanged under member names via get_contributor_scores. Reverses the 2026-08-11 no-expose decision for this card only, owner 2026-08-27.';

-- REQUIRED. DROP removed the previous grant.
GRANT EXECUTE ON FUNCTION public.get_top_contributors_v2() TO anon, authenticated;
```

---

## 5 · FRONTEND

**`src/hooks/useTopContributors.ts`** — add to the interface and to the mapped object:

```ts
  /** The rolling 30-day score the ranking is computed from. Displayed on the card. */
  recent_score: number;
```
```ts
          contributor_score: Number(d.contributor_score) || 0,
          recent_score: Number(d.recent_score) || 0,      // ← add
```
Also update the file header, which currently states the 30-day score is deliberately not returned.

**`src/pages/Index.tsx`** — two changes, both required:

```ts
// line ~1056 — the bar must scale by the SAME number it displays, or it re-creates
// the inversion this change exists to remove.
const barWidth = topContributors[0]?.recent_score
  ? Math.round((c.recent_score / topContributors[0].recent_score) * 100)
  : 0;
```
```tsx
// line ~1091
✦ {c.recent_score.toLocaleString()}
```

**`src/components/sidebar/SidebarTopContributors.tsx`** — line ~69:
```tsx
✦ {c.recent_score.toLocaleString()}
```

---

## 6 · TESTS — four will fail; here is each and its fix

`src/__tests__/topContributorsV2.test.ts`

| Test | Why it breaks | Change to |
|---|---|---|
| *"hands the UI exactly seven fields and nothing else"* | the mapped object becomes **eight** fields | add `"recent_score"` to the expected array |
| *"renders contributor_score"* — Home page card | the card now renders `recent_score` | assert `recent_score` |
| *"renders contributor_score"* — signed-out sidebar | same | assert `recent_score` |
| *"scales the progress bar by the contributor score"* — asserts `topContributors[0]?.contributor_score` | the bar now scales by `recent_score` | assert `topContributors[0]?.recent_score`, and rename the test |

**Do not delete these tests to make them pass.** They exist because a component reading a field the RPC
no longer returns type-checks fine when someone reaches for `any` — which this codebase does on this exact
call (`supabase.rpc('get_top_contributors_v2' as any)`). **They are the only thing standing between this
change and a blank card.**

**Unchanged and must stay green:** *"v1 is still available for rollback"* · *"labels the window Last 30
Days, not This Month"* · the i18n locale-count test.

---

## 7 · VERIFICATION AFTER DEPLOY

1. Card shows **7,055 / 6,978 / 6,823** descending, matching the medals.
2. Bars descend **100% / 99% / 97%** — no row fuller than the one above it.
3. **Sign out** and confirm the feed right-sidebar card matches the Home card exactly.
4. Confirm the score under usernames in the feed is **still the lifetime number and unchanged**.
5. Re-run the SQL cross-check:

```sql
select t.rank_position, p.full_name, t.contributor_score as lifetime, t.recent_score as thirty_day
from public.get_top_contributors_v2() t
left join public.profiles p on p.id = t.user_id
order by t.rank_position;
```
`recent_score` must be strictly descending. `contributor_score` need not be — that is the whole point.

---

## 8 · CONSTRAINT

This changes **SQL and `src/`**, so it produces a **new tree**. That voids candidate
`e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` and every piece of evidence bound to it — 21/21 mutants,
CI `32976271438`, the schema guard, the tree-equality proof, and the entire §15 matrix.

**This is G11. It must not enter the current release candidate.**
