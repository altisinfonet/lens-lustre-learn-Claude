# PHASE 1 · ROW 12 — REALTIME / FEED CANDIDATE-POOL / PAGINATION: READ-ONLY AUDIT

**Scope discipline:** Phase 1 only. No Judging Panel object was audited, read beyond
classification, or touched. No production modification of any kind — the only state change
in any probe was a transaction-local GUC (`set_config(..., true)`), which writes nothing.
**Master Plan exit criterion (Part III row 12):** certification — implementations exist;
certification ≠ implementation. Gate class HARD. Dependency column: "instruments (Phase-4
overlap)". The circular-dependency question already before the owner (§4 of the Closure
Audit) is NOT re-decided here. This audit gathers the correctness evidence that every one
of the four scope options requires.

---

## 1. WHAT THE FEED ACTUALLY IS (from the live catalog, not from docs)

Two generations of feed RPC coexist in production:

| RPC | role | privacy model | ordering |
|---|---|---|---|
| `get_feed_candidates(_network_ids, …)` | older candidate pool: recent-48h / network / popular-7d, ≤370 rows | inline: `privacy='public' OR user_id = auth.uid()` — **friends-privacy posts never surface, even to accepted friends** | `DISTINCT ON (id)`, output ordered by id; client ranks |
| `get_broadcast_feed(_exclude_ids, _limit[, _newest_first[, _categories]])` (3 overloads) | the tiered engine: newest → unseen → recycled | delegated to `feed_candidates()` — full rule: public + own + accepted-friends' friends-posts | **seeded, deterministic within the hour**: seed = `YYYYMMDDHH ‖ viewer-uid`, ranked by `feed_rank_score` |

Support functions, all read this session:
- `can_view_post(viewer, owner, privacy)` — SECDEF, `search_path=public`, 244 chars: owner →
  true; public → true; friends → `are_friends()`; else false. **Byte-consistent with the
  documented contract** (2026-08-19 session doc).
- `are_friends(a, b)` — `status = 'accepted'`, either direction. Confirmed.
- `feed_rank_score(id, bucket, seed)` — IMMUTABLE seeded hash (`hashtextextended`), not
  client-callable; used only by `get_broadcast_feed`.
- `feed_candidates(seed, categories, …)` — SECDEF pool builder, four branches:
  recent-public / seeded-sample-public (`rand_key` threshold) / own (any privacy) /
  accepted-friends' `privacy='friends'` posts.
- RLS on `posts` (reads): `can_view_post(auth.uid(), user_id, privacy)` for PUBLIC — the
  client's direct reads and **realtime** go through the same single rule.

## 2. PRIVACY CORRECTNESS — proven live, read-only, against real production data

Production now holds 264 posts: 263 public, 1 private (`7eaf0ef8…`, the Android acceptance
post — the first non-public post that has ever existed to leak).

| # | Probe (executed this session) | Result | Verdict |
|---|---|---|---|---|
| P1 | `get_feed_candidates` as unauthenticated, **with the private post's owner passed in `_network_ids`** (the adversarial case) | 62 rows · 0 non-public · private post absent · 0 duplicate ids | **PASS** |
| P2 | `get_broadcast_feed(500)` as unauthenticated | 263 rows · 0 non-public · private post absent | **PASS** |
| P3 | `get_broadcast_feed(500)` as the **owner** (transaction-local JWT claim) | own private post **present** (count 1) — branch 3 works; **0 non-public posts of anyone else** | **PASS** |
| P4 | `is_public` vs `privacy` drift across all 264 posts | **0** — and drift is impossible by construction: `is_public` is a **STORED GENERATED column** `(privacy = 'public')` | **PASS** |
| P5 | `rand_key` / `viewer_bucket_stable` null check (sampling integrity) | 0 nulls / 0 nulls | PASS |

The friends-positive case (accepted friend sees a friends-post) is **vacuously untestable in
production today** — zero `privacy='friends'` posts exist. Recorded as vacuous, not as PASS;
the function's branch 4 is proven by inspection only. This is the same honesty rule the WS3
report applied to its own zeros.

## 3. DETERMINISM AND PAGINATION — the finding that changes a decision's frame

**F12-1 · Seeded deterministic ordering is ALREADY LIVE.** The Master Plan carries D-008
("deterministic ranking — seeded-hash ordering replacing `random()`") as an UNDECIDED
one-way door, and the Phase-3 audit's premise is a `random()`-ordered feed. Production says
otherwise: `get_broadcast_feed` ranks by `feed_rank_score(id, bucket, seed)` with a
per-viewer-per-hour seed, and its own comment block explains the design ("each member gets
their own shuffle, stable for an hour… keeps `_exclude_ids` paging coherent within the
hour"). The only `random()` on the read path is the **INSERT-time default** of
`posts.rand_key` — a stored value, stable per row, not a per-query re-deal.
**Consequences, stated without deciding anything:**
- D-008's cost model in Part VIII ("blocks keyset pagination, feed cacheability") should be
  re-derived against what is actually deployed — the door may be substantially already
  walked through, with an hour-bounded rather than unbounded coherence window.
- 3R-READ's "page coherence depends on D-008" premise inherits the same correction.
- Whether the **client** calls `get_broadcast_feed` or the older `get_feed_candidates` is
  repo evidence (Chrome) — `useFeedQuery.ts` decides which model members actually
  experience. UNKNOWN from here, and material to certification.

**F12-2 · Pagination is exclusion-list, not cursor.** `_exclude_ids` + tiering + the hour
seed. Within an hour: coherent, no duplicates across pages by construction (exclusion), no
gaps among candidates. Across the hour boundary: the shuffle re-deals mid-scroll —
by design, per the comment. Certification must state that boundary behaviour as the
*specified* behaviour, or the owner must change the spec. No DB-side keyset cursor exists.

**F12-3 · Two feed RPCs, two visibility implementations, neither uses `can_view_post`.**
Both re-implement the rule inline. Today both are *consistent or stricter* than the
canonical rule (older RPC: stricter — friends-posts never surface; newer: faithful). The
D-003 spec's warning ("a second implementation is a second thing to get wrong") applies
verbatim to the feed. Not a defect today — P1–P4 prove current equivalence on real data —
but it is the standing drift risk this row's certification should pin with a test.

**F12-4 · The older RPC under-includes.** `get_feed_candidates` never returns
friends-privacy posts, even to accepted friends. If the client still uses it anywhere,
a member's friends-post is invisible in that surface — a product-behaviour question, not a
leak. Owner should know which RPC serves which surface before certifying. (Repo evidence.)

## 4. REALTIME — database-side posture (delivery certification is device work)

- Publication `supabase_realtime`: **29 tables**, including `posts`, `post_reactions`,
  `post_comments`, `profiles`, `follows`, `friendships`, `user_notifications`.
- Realtime enforces the same RLS as reads: `posts`' one read policy is
  `can_view_post(auth.uid(), …)` (role PUBLIC), so a subscriber receives only rows the
  canonical rule allows. Single rule for query, feed-RPC-adjacent reads, and realtime —
  no second opinion on the read side (the RPC-side second opinions are F12-3).
- What this audit CANNOT certify from here: actual delivery latency/completeness on web
  and device, reconnection behaviour, and subscription filters in client code. That is the
  Phase-4-overlap instrument gap already before the owner.

## 5. INDEX SUPPORT (correctness-adjacent; cost is Phase 4)

`idx_posts_created_at_desc` · `idx_posts_is_public_created` (partial, matches branches 1–2)
· `idx_posts_privacy_created_at` · `idx_posts_user_id_created_at` (branch 3 / network) ·
unique `posts_user_idempotency_key` (write-path dedup). Every `feed_candidates` branch has a
matching index shape. Buffer/latency measurement stays in Phase 4 per the pending ruling.

## 6. ROW 12 STATE AFTER THIS AUDIT

| Slice | State | Evidence |
|---|---|---|
| Candidate-pool privacy correctness (DB) | **PROVEN on live data** | P1–P4 |
| Ordering determinism (DB) | **PROVEN present**; specified hour-boundary re-deal documented | F12-1/2 |
| Visibility-rule consistency | proven equivalent today; drift risk named | F12-3 |
| Which RPC the client uses; realtime delivery; device behaviour | **UNKNOWN — repo + instruments** | Chrome / owner reads; Phase-4 overlap |
| Friends-positive path | vacuous (no friends-posts exist) | §2 |
| Row 12 overall | **OPEN — audit half complete; certification blocked on the §4 sequencing ruling + repo/client evidence** | this document |

**Next gate step for this row:** RED TEST — a pinned test set asserting P1–P4 plus the
friends-positive case (seeded fixture), so the certification is re-runnable rather than a
one-day snapshot. Writing those tests requires the repository. **STOP: OWNER dependency —
Chrome, or you run the reads.** Exact dependency restated: `src/hooks/feed/useFeedQuery.ts`
(which RPC, both mounts), `src/pages/Feed.tsx:319` region, and the existing feed test files.

**Nothing modified. Judging Panel untouched. Phases 2–5 untouched.**
