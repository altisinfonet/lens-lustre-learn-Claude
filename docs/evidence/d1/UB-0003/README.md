# UB-0003 · purge the user-block notice ledger after 24 h (D1) · `20261005_0002` · carries UB0002-3 (SEC, LOW)

**Finding.** `20261003_0002` (SEC-UB-1) keeps one row per blocking pair in `public.user_block_notices` (the last time the admin was told) and lets a new notice through only when that row is ≥ 24 h old. Nothing deletes rows, so the ledger grows by one row per distinct pair, forever.

**Why deleting is safe.** The claim is `INSERT … ON CONFLICT … DO UPDATE … WHERE n.notified_at <= EXCLUDED.notified_at - interval '24 hours'`, so a row ≥ 24 h old already lets the next notice through. Deleting it changes nothing: the next block of that pair inserts and notifies once, exactly as it would have updated and notified. A row **younger** than 24 h **is** the cap, and the purge refuses any keep window under 24 h.

**What ships.**
- **`public.purge_user_block_notices(_keep 24 h, _batch 5000, _max_batches 200)`:** bounded batches; the next call continues where the last stopped. It raises below 24 h. SECURITY DEFINER with `search_path ''`, revoked from the API roles.
- **Cron `purge-user-block-notices`:** `23 * * * *`, command `SELECT public.purge_user_block_notices();`. It passes the P5 (once a minute at most) and P9 (no HTTP or credential) checks.
- **The first purge runs inside the migration.**
- **Rollback:** removes the job and the function. The purged rows are not restored; each was ≥ 24 h old, so it gated nothing.

## Proof — `ub0003-run-tests.sh` → `ub0003-transcript.txt` (ALL CASES PASS)
The cap is the **real** `notify_admin_user_blocked()` (verbatim from 20261003_0002), fired by real `user_blocks` INSERTs, on real pg_cron 1.6.

| Check | Result |
|---|---|
| Fail-first | 200,000 rows ≥ 24 h old pile up with no way out; the PROBE refuses (no purge) |
| Equivalence, on the real trigger | a 25 h-old row present → **1** notice · row purged → **1** notice (same) · a 23 h-old row → **0** notices (the cap, never purged) |
| Apply | the first purge removes 200,000 rows in a 389 ms apply; the 300 rows inside the window are all kept; none older than 24 h |
| Guard | `_keep` 23 h → refused |
| Bound | batch 1000 × 5 = 5,000 per call, then 5,000, then 2,500; the window rows are untouched |
| PROBE mutants (each red, each undone) | job removed · job paused · 24 h guard removed · `authenticated` granted · a 27 h row left (purge not running) |
| Real scheduler | the job ran (`succeeded`); a 30 h row was gone |
| Rollback | lane-guarded; the job and the function are gone; the ledger is untouched; the PROBE is red again; re-apply works |
