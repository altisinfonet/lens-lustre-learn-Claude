# P5-b · `publish-scheduled-posts` calls its edge function only when a post is due — evidence (D1, T1) · `20261004_0007`

**Gates.** GATE_REGISTER **P5** clause 3: "idle back-off is implemented and its effect measured" (clause 1, once a minute, already holds for this job). **P9**: "the outbound HTTP helper no longer performs an inline `vault.decrypted_secrets` lookup per call". R-82: design + enforced guard + synthetic test at launch scale.
**Input:** the Owner's production read, 2026-10-04 ~15:10 UTC — **A-P9-2**: `publish-scheduled-posts` every minute via HTTP, its secret read from `vault.decrypted_secrets` inline. Staging (read-only, 2026-10-04): the same job with the header values as literals; 0 scheduled posts.

## Design
| Before | After 0007 |
|---|---|
| every minute: one HTTP call + one inline vault decrypt, whether or not a post is scheduled (1,440 + 1,440 a day) | every minute: `publish_scheduled_posts_tick()` → `scheduled_posts_due()` (two index probes). **Not due → nothing else happens.** Due → the vault target is read and the **same** call is made |
| target (and on staging, literal secrets) in the cron command and in every `cron.job_run_details` row | target evaluated **inside the database** into vault `p9_cron_http:publish-scheduled-posts` (the `pg_temp` capture of 0006); the old job to `p9_cron_previous:…` for an exact rollback |

`scheduled_posts_due()` is exactly the edge function's two selections (`supabase/functions/publish-scheduled-posts/index.ts`): a `pending` row with `scheduled_for <= now()` (the claim) **or** a `publishing` row not updated for 5 minutes (the self-heal reclaim). The new partial index `idx_scheduled_posts_publishing_stale` (empty in normal use) keeps the second probe off a sequential scan. Latency is unchanged: a due post goes on the next minute, as before. The job is not event-woken: a post becomes due by the clock, not by a write.

**Safety:** if a captured header is NULL (its vault secret missing on that lane), the apply refuses (`MOVE-002`) instead of storing a broken target — nothing changes.

**Rotation (stated):** on production the header used to be read from the vault every minute. After 0007 the evaluated header sits in `p9_cron_http:publish-scheduled-posts`. Rotating the cron secret now means updating that one secret (`vault.update_secret(<id>, jsonb_set(<target>, '{headers,x-scheduled-posts-secret}', to_jsonb('<new>'))::text)`), run by the Owner — D1 never handles it.

## Proof
| Kind | File | Fails first on |
|---|---|---|
| Live | `supabase/migrations/PROBE_p5b_scheduled_posts_tick.sql` (read-only, S1–S3) | the pre-0007 state; 4 mutants (inline-vault HTTP command, 30-s schedule, API grant, a due-check that forgets the stale-reclaim selection) — each red, each undone |
| Build | `scripts/db-p9-cron-http-check.mjs` (the sibling P9 PR) | its self-test reds production's shape of this job: H1 (HTTP from cron) + H2 (inline vault) |
| Synthetic | `p5b-run-tests.sh` + `p5b-fixture.sql` → `p5b-transcript.txt` | — |

## Synthetic test — scratch PG 17, **real pg_cron 1.6**; vault and pg_net stubbed with their real signatures; `scheduled_posts` columns and indexes verbatim from staging; the job's command executed by hand so every count is exact
| Reading | Before | After |
|---|---|---|
| a day of minutes (1,440), nothing due | **1,440 HTTP calls, 1,440 vault decrypts** | **0 and 0** (1,440 idle ticks) |
| a post at its time | call | **woken**, the call = the old url + headers; published → idle |
| `publishing` 1 min / 6 min | — | idle / **woken** (the reclaim) |
| failed rows; a post shifted +15 min | — | idle |
| 100,000 rows + 1,000 future | — | idle; **two index-only scans, 0.66 ms, 25 buffers** |
| a missing vault secret | — | apply **refused** (MOVE-002), nothing changed |
| staging's literal shape | — | converted; literals gone from the command |
| rollback | — | lane-guarded; job restored **byte for byte** (both shapes); index and vault secrets gone; every row kept; PROBE red again |
