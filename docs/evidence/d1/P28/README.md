# P28 · Index-to-heap review gate — evidence (D1, T1)

**Gate:** "no table ships with more index than heap without a written reason; the ratio checked at review." This gate creates a standing rule, written in `index-ratio-rule.md`.

| Half | Instrument | Fail-first |
|---|---|---|
| At review (build time) | `scripts/db-p28-index-review-check.mjs` + self-test (14 cases), CI `d1-p28-index-review.yml`. Every `CREATE INDEX` in a migration dated 20261004 or later needs a `-- P28:` line (table, rows at launch, why). The reasons file must equal the PROBE list | A planted `CREATE INDEX` without the line turns it red; the same index with its line turns it green (`p28-transcript.txt` §1) |
| On the lanes | `supabase/migrations/PROBE_p28_index_ratio.sql` (read-only): every table with heap ≥ 1 MB has index ≤ heap or a written reason, and stale reasons are reported | Scratch PG17, with `posts` built like staging's: no reason → red; as committed → green; reason no longer needed → red (§2) |

**Staging today** (Supabase MCP, read-only, 2026-10-04 08:18 UTC): 151 public tables. 114 have more index than heap at any size, which is why there is a 1 MB floor (rule §2). Only 1 table is judged: **`public.posts`**, heap 2.8 MB, indexes 6.5 MB (12 indexes). Its written reason is in `scripts/db-p28-index-ratio-reasons.json`:
- 3.25 MB of it is the trigram GIN on `content`, which is the only content-search path until P20.
- The redundant candidates (`idx_posts_user_id`, `idx_posts_content_hash` with 0 scans) are listed for A-4c. **No index is dropped, because of the C-2 hold.**

**To close on the lanes:** the Owner dispatches `PROBE_p28_index_ratio.sql` on staging and then on production. Production may judge more tables. Any it names gets a written reason in the same PR as the reason file.
