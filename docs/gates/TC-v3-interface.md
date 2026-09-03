# TC-v3 — FROZEN INTERFACE · Top Contributors, 30-day score on the Home page

**Frozen by the Auditor · 2026-09-03 · binding on D1 and D2**
**Ruling: OWNER-RULING-2026-09-03-02.** Nothing here is approved for production; this file
freezes the contract so two sessions that cannot see each other build the same thing.

---

## 0 · Why this file exists

D1 and D2 are separate sessions (ruling D-15). **An interface agreed in conversation does not
exist.** This project has two recorded corrections — C-46 and C-51, both against the Auditor —
whose single cause was a session instructed to work against a ruling that was on no ref. D2
stopped on 2026-09-03 at 08:44Z for exactly this reason, correctly, and filed its verification
rather than guessing. This file is the fix.

---

## 1 · The ruling, and what it supersedes

**OWNER-RULING-2026-09-03-02 (2026-09-03).** The Home page Top Contributors card **must display
the rolling 30-day score**, labelled, under its "Last 30 Days" heading. Every other surface that
shows a contributor score keeps the **lifetime** score, unchanged in value and position.

This **supersedes** the Owner's instruction of 2026-08-11, recorded in
`supabase/migrations/20260811160000_top_contributors_v2.sql`:

> Owner, 2026-08-11: *"Top Contributor ranking = recent 30-day activity, while Contributor Score
> displayed under name = current lifetime contribution."* … *"The 30-day number is NEVER returned,
> so it cannot reach the UI by accident."*

**That comment is NOT deleted.** It is marked superseded, naming this ruling, and the original
stands beside the correction — the same rule the ledger applies to the Auditor's own errors.

### Why the ruling was made

The card ranks by a number nobody can see and displays a different one. Measured on production
2026-09-03: ranks 1/2/3 showed **9,551 / 8,888 / 11,546** — the bronze medal holding the largest
figure. Nothing was computed wrongly; the card was ranking on 30-day and displaying lifetime,
exactly as specified in August. **The defect was in what the card told the member, not in what it
calculated.** D2 measured staging the same day and found 764 / 509 / 509 — non-increasing there,
but coincidentally, which is why the descending check below can only be run against v3.

---

## 2 · The database contract — D1 owns this

### 2.1 The constraint, measured — do not attempt to edit v2

Verified on production `jtdtehuqtinjxropkkcn`, 2026-09-03:

```
get_top_contributors_v2 -> TABLE(user_id uuid, rank_position integer, contributor_score integer)
```

PostgreSQL refuses to change a function's return type through `CREATE OR REPLACE`. A fourth
column therefore requires a **new function**, not an edit. This is the EXPAND step:
**`get_top_contributors_v3` is created alongside v2. v2 is not dropped in the same PR — v2 is the
rollback.**

### 2.2 Frozen signature — neither session may vary it

```sql
get_top_contributors_v3()
RETURNS TABLE (
  user_id           uuid,
  rank_position     integer,
  contributor_score integer,  -- LIFETIME. Same meaning and value as v2's column of this name.
  recent_score      integer   -- rolling last 30 UTC days. The number the Home card displays.
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
```

### 2.3 Behaviour that must NOT change from v2

- **Ranking rule identical:** `ORDER BY recent.score DESC, uid`. `uid` is the tie-break so the
  order is stable between calls rather than shuffling equal scores on every refresh.
- **Top 3 only.**
- **`WHERE r.score > 0`** on the recent set — a member with no 30-day activity does not appear.
- **Admin exclusion stays inside `contributor_points_since`**, so both functions enforce it
  identically. Do not re-implement it in v3.
- **Nothing else is returned.** No counts, no minutes, no engagement figures, no formula
  internals. The Owner's 2026-08-11 reason for that constraint is **not** superseded: *"The
  ranking should feel like recognition, not a 'time spent on app' competition."* Only the
  visibility of `recent_score` changes.

### 2.4 Security — v3 is anon-executable and SECURITY DEFINER

`SECURITY DEFINER` bypasses RLS entirely; **the WHERE clause is the only control and there is no
second line of defence.**

- Grants **match v2 exactly and do not exceed them**. v2 today: `anon` EXECUTE = true, `STABLE`.
- **`STABLE`, never `VOLATILE`** — an anon-executable VOLATILE function is the amplification class
  that P32 exists to close.
- **A cross-member test ships with the function, as the condition of accepting it**, not as a
  follow-up: as member A and as member B, prove neither obtains anything about the other beyond
  the three public rows the card shows; test anon separately. **The test is shown FAILING against
  a deliberately loosened copy before it is accepted as a control** (C-34).

### 2.5 Equivalence proof required

Run v2 and v3 side by side, read-only, on production. **The same three `user_id`s in the same
order.** Quote both readings with a UTC timestamp. If the order differs, that is a finding to
report — not something to tune until it matches.

---

## 3 · The client contract — D2 owns this

**D2 does not start until `get_top_contributors_v3` exists on staging AND this file is on
`origin/staging`.** Verify both from the system; do not assume D1 has landed.

### 3.1 Home page card — the only surface that changes

- Reads **`recent_score`** and displays it where `contributor_score` is displayed today.
- Heading stays **"Last 30 Days"** — it is now true of the number beneath it.
- **The number carries a label.** Final wording is §5, open item OI-1.
- Lifetime remains reachable on the card. **Placement is §5, open item OI-1.**

### 3.2 Every other surface — value and position unchanged

`ContributorScore.tsx` and its callers keep the **lifetime** score from
`get_contributor_scores`, unchanged in value and position. **The only addition is a hover:
"Lifetime Contributor Score".** No other change anywhere a score is shown.

### 3.3 Not in scope

Medals, the Rising Star / Most Popular badges, ordering, card layout, entry count. **Do not
redesign the card.**

### 3.4 The check that decides whether this worked

With real staging data, **the three displayed numbers must descend down the card.** If they do
not, STOP and report: the ranking field and the displayed field still disagree and the change has
not fixed the thing it was written for. This check, not the build passing, is the unit's point.

### 3.5 Known coupling, recorded by D2 on 2026-09-03

`src/hooks/useTopContributors.ts:61` calls v2 with `as any`, and `src/integrations/supabase/
types.ts` knows only `get_top_contributors_v1`. A v3 landing that regenerates `types.ts` surfaces
as a change in D2's lane — say so when it happens rather than letting it ride silently.

---

## 4 · Order, and the contract step

1. **EXPAND** — D1 creates v3 beside v2. v2 untouched and still serving.
2. **BEHAVIOUR** — D2 points the Home card at v3. Every other surface unchanged.
3. **CONTRACT** — `get_top_contributors_v2` is dropped **only** on the Auditor's dated
   authorisation, after the promotion that depends on v3 has been live and stable. Never the same
   day. v2 is the rollback until then.

Runs in parallel with Phase 0. **File-collision check, 2026-09-03: the ten Top-Contributor files
intersect none of the twenty files in the six open Phase 0 PRs.** The Auditor re-runs that check
before Promotion P-0, because "no collision" is only true at the moment it was measured.

---

## 5 · Open item — blocks D2 only, not D1

| # | Open | Status |
|---|---|---|
| **OI-1** | Where lifetime appears on the Home card, and the exact label on the 30-day number. Auditor's recommendation: the visible number is the 30-day score; **lifetime on hover — "Lifetime Contributor Score: N"**. The alternative, if the Owner prefers it always visible, is a muted secondary line under the name — a layout change. | **AWAITING THE OWNER.** v3 returns both numbers either way, so **D1 is not blocked by this.** |

---

*Frozen by the Auditor. This file constrains; it approves nothing and closes no gate.*
