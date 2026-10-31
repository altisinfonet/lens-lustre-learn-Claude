# TC-v3 client half · PRECONDITION NOT MET · D2 stopped

**Unit** OWNER-RULING-2026-09-03-02, client half — Home card shows the 30-day score
**Branch** `d3/TC-v3-home-both-scores-20260903` off `origin/staging` `d1aed35`
**Status** **STOPPED before any change to `src/**`.** Nothing in the client lane has been edited.

The frozen interface, §3, states: *"D2 does not start until `get_top_contributors_v3` exists on
staging AND this file is on `origin/staging`. Verify both from the system; do not assume D1 has
landed."* Both were verified. **One holds, one does not.**

---

## 1 · Precondition A — the interface file · **SATISFIED**

`docs/gates/TC-v3-interface.md` is present on `origin/staging` at `d1aed35`
(*"Auditor: TC-v3 OI-1 CLOSED — Owner chose Option B (both scores visible) — unblocks D2"*),
alongside `GATE_REGISTER.md` and `phase-0-kickoff.md`. OI-1 reads CLOSED; §3.1 is frozen on
Option B. Read at 2026-09-03, from `git ls-tree origin/staging docs/gates/`.

## 2 · Precondition B — `get_top_contributors_v3` on staging · **NOT SATISFIED**

**Instrument** Supabase MCP `execute_sql`, `SELECT` only, against staging `ztzutckwdhetphwghuzj`,
querying `pg_proc` joined to `pg_namespace` — the query the Owner authorised, and no more.

**Measured 2026-09-03 09:04:22.242475 UTC:**

| `proname` | `pg_get_function_result` | vol | secdef | anon EXEC |
|---|---|---|---|---|
| `get_top_contributors_v1` | `TABLE(user_id uuid, posts_count bigint, likes_received bigint, comments_received bigint, score numeric)` | `s` | true | true |
| `get_top_contributors_v2` | `TABLE(user_id uuid, rank_position integer, contributor_score integer)` | `s` | true | true |
| **`get_top_contributors_v3`** | **— no row returned —** | — | — | — |

**`get_top_contributors_v3` does not exist in `public` on staging.** The pattern `get_top_contributors%`
was used, so a differently-suffixed variant would still have appeared. It did not.

**Production `jtdtehuqtinjxropkkcn`, measured 2026-09-03 09:04:38.383619 UTC** — same two functions,
no v3. Consistent, and correct: staging leads, so v3 should be absent here until after staging.

### What this means, stated plainly

Interface §4 orders the work **EXPAND (D1) → BEHAVIOUR (D2) → CONTRACT (D1)**. Step 1 has not
landed. The client half cannot begin: `recent_score` is not on the wire, so the Home card would
render `Number(undefined) || 0` — **✦ 0** in every row — and the §3.4 gate could not be run at all.
`get_top_contributors_v2` is unchanged and still serving, which is the intended state before EXPAND.

**This is the second time D2 has stopped on this precondition** — the first at 2026-09-03 08:44Z,
recorded in the interface's §0 as the reason the file exists. This stop is filed the same way.

---

## 3 · Finding for the Auditor — TC-v3 has no Gate Register row

`docs/gates/GATE_REGISTER.md` on `origin/staging` `d1aed35` contains **no row** matching
`TC-v3`, `contributor`, or `OWNER-RULING-2026-09-03-02`. Searched case-insensitively; zero hits.

The interface is frozen and the Owner's ruling is recorded inside it, but the unit has no register
row, so it has **no status field, no owner field and no evidence path** in the instrument the
Auditor closes gates from. `docs/gates/**` is the Auditor's file, one author ever — **D2 has not
touched it.** Raised here, per the skill's "report it to the Auditor, not even a typo."

---

## 4 · What D2 needs in order to start

1. `get_top_contributors_v3` on staging with **exactly** the §2.2 signature:
   `(user_id uuid, rank_position integer, contributor_score integer, recent_score integer)`,
   `STABLE`, `SECURITY DEFINER`, `search_path=public`, grants matching v2 and not exceeding them.
2. The Auditor's record that D1's cross-member test (§2.4) and equivalence proof (§2.5) are in hand.

D2 will re-run the same `pg_proc` query and quote the new reading before writing a line of `src/`.

---

## 5 · Prepared, not applied

Nothing is staged in `src/`. The fail-first test required by C-34 — asserting the Home card renders
`recent_score` and not `contributor_score` as its primary figure — is **not** written yet, on
purpose: written now it would fail for the wrong reason (the field does not exist anywhere), and a
test that passes only once an unrelated precondition lands is not the control C-34 asks for. It is
written against the real v3 shape, shown failing against the current component, and that failure
quoted, in the same PR as the change.

The three Option B obligations from §3.1 — taller rows checked at real sidebar width, long names
truncating with an ellipsis rather than wrapping, and a reading on a real mid-range Android — are
recorded here as owed, and none can be measured before the card renders a real `recent_score`.

---

*D2 · Client & Delivery. Read-only. No `src/**` change, no SQL, no migration, no object reserved,
no file under `supabase/**`, `scripts/db-*.mjs`, `docs/gates/**` or `docs/PROMOTION_LEDGER.md`
touched. Measurements taken through Supabase MCP `execute_sql` (SELECT only) at the UTC times
quoted above; repository state `origin/staging` `d1aed35`.*
