# OFF-2 · exactly once — server-side idempotency keys (D1 half, T1) · `20261004_0008`

**Rule.** MASTER R-90 OFF-2: "Server-side idempotency keys (D1) so nothing is ever duplicated." The D3 decision file OFF-5 (§3 R4, R8; pushed by D3, awaiting the Owner's signature) adds: "every outbox item carries a client-generated idempotency key (UUID v4). D1 enforces it with a unique constraint per action table, so a duplicate send returns the original result." OFF-5 §5 leaves the table list open for D1. R-82: design + enforced guard + synthetic test.

## The outbox action tables, read on staging 2026-10-04 (`scripts/db-off2-outbox-contract.json`)
| Table | Action (OFF-5 §2) | A repeated send today | After 0008 |
|---|---|---|---|
| `posts` | new post | one row: `posts_user_idempotency_key` (partial) + `create_post_with_media()` returns the first post | unchanged |
| **`post_comments`** | comment | **a second comment, a second notice, `comments_count` +1 again** | **UNIQUE (user_id, idempotency_key)** |
| **`reports`** | report | **a second report** | **UNIQUE (reporter_id, idempotency_key)** |
| `post_reactions` | like / unlike | one row: (post_id, user_id) | natural key, measured |
| `comment_reactions` | like a comment | one row: (comment_id, user_id) | natural key |
| `follows` | follow / unfollow | one row: (follower_id, following_id) | natural key, measured |
| `friendships` | friend request | one row: least/greatest pair | natural key, measured |
| `post_reports` | report (legacy path) | one row: (post_id, reporter_id) | natural key |
| `user_notifications` | mark read | the same UPDATE | update-only |

**The design for the two gaps.** `idempotency_key text` (NULL for existing rows and today's client: behaviour unchanged) + CHECK "NULL or a UUID" + a **full** `UNIQUE (owner, idempotency_key)` constraint. It is not a partial index, so PostgREST can name it in `on_conflict`. A repeat never fires an AFTER trigger: no second notice, no double count.

**Contract for D2's outbox (OFF-2 client half).** Send the key with every comment and report. Either:
- `insert(...)`, and treat 23505 naming `post_comments_user_idempotency_key` / `reports_reporter_idempotency_key` as **delivered**; or
- `upsert(..., { onConflict: 'user_id,idempotency_key', ignoreDuplicates: true })`.

Then read the row back by (owner, key). That is the "original result". Posts already go through `create_post_with_media(_idempotency_key)`.

## Proof
| Kind | File | Fails first on |
|---|---|---|
| Build | `scripts/db-off2-idempotency-check.mjs` + self-test (12 cases), CI `d1-off2-idempotency.yml` | **the real tree without 0008**: 4 hits (post_comments, reports × column, UNIQUE) |
| Live | `supabase/migrations/PROBE_off2_idempotency.sql` (read-only, every contract table) | **staging today** (run read-only 2026-10-04): "post_comments: no idempotency_key column · reports: no idempotency_key column". Also 4 mutants: partial index instead of the constraint, wrong column order, a natural key dropped, posts' index dropped |
| Synthetic | `off2-run-tests.sh` + `off2-fixture.sql` → `off2-transcript.txt` | — |

## Synthetic replay test — scratch PG 17; staging's columns, keys and privileges; stand-ins for the comment-count and notify triggers
| Reading | Before 0008 | After |
|---|---|---|
| one comment sent 3 times | **3 comments, count +3, 3 notices** | **1, +1, 1**; sends 2–3 get 23505 naming the constraint; read-back by key = the original row |
| upsert path (`ON CONFLICT (user_id, idempotency_key) DO NOTHING`) | — | first inserts, repeat returns nothing, no error |
| 8 sessions, same key, same instant | — | **1 wins, 7 × 23505, 1 row** |
| 100,000 sends, 1,000 members, each key ×3, random order | — | **33,334 comments = keys**; count and notices = one per key |
| same key, two members / no key / a non-UUID key / as `authenticated` | — | 2 rows / unchanged / 23514 / allowed |
| a report ×3 · like ×3, follow ×3, friend request both ways | — | 1 · 1 / 1 / 1 |
| rollback | — | lane-guarded; constraints dropped, **column and its keys kept**; PROBE red; a re-apply with a repeat that crept in is refused naming the count (PRE-003); a clean re-apply works |

## Findings
- **F-OFF2-1 (posts, for D2 and the Auditor):** `create_post_with_media()` checks the key and then inserts. Two sends racing get one post, and the loser gets **23505 on `posts_user_idempotency_key`** rather than the post id. The outbox rule above (23505 = delivered, then read back) covers it. Making the function itself return the id on that race is a change to the publish RPC: a separate unit, if wanted.
- **F-OFF2-2:** `image_comments` has no natural or key uniqueness either. OFF-5 §2 marks no offline action on images, so it is not in the contract. If image comments are ever queued, it gets the same constraint.
- `post_comments` and `reports` grant `anon` table-level ALL on staging (RLS governs). Recorded for SEC; not changed here.
