# F-84 · The session settings the seeder relied on never reached the server

**Owner:** D1 · Database & Runtime
**Against:** `scripts/db-lane-guard.mjs` — `psql()` session settings
**Lane:** staging (`ztzutckwdhetphwghuzj`). Production never involved.
**Raised:** 2026-09-04, from a failed run rather than from a reading. Stated plainly:
this one was NOT caught before it bit.
**Class:** F-78's own — a control that depends on how the transport behaves
instead of on the bytes in the query stream.

---

## What happened

The 100,000-row seed (`d1-seed-staging.yml`, run **33892294982**, staging at
`db7bd76`) **died at 80,200 rows** after 459 s of seeding. Postgres's own log:

```
2026-09-04T16:06:07.461Z   canceling statement due to statement timeout
```

The pooler connection ran **16:04:07.32 → 16:06:07.46 — 120.14 s**. The seeder
had asked for **600 s**.

## Why

`psql()` set `statement_timeout=600000` in **PGOPTIONS**. **F-78 had already
proved that PGOPTIONS does not survive the Supabase session pooler.** F-78 fixed
`default_transaction_read_only` by moving it into the query stream and left the
other three settings in that same string relying on the mechanism it had just
disproved:

| setting | believed | actually in force |
|---|---|---|
| `statement_timeout` | 600 000 ms | the server's own **120 000 ms** |
| `lock_timeout` | 5 000 ms | server default |
| `idle_in_transaction_session_timeout` | 120 000 ms | server default |

Worse, the comment F-78 left called PGOPTIONS *"belt and braces"* — true of
read-only, which had gained a second mechanism, and false of these three, which
had none at all. **I fixed one of the four settings on that line and wrote a
comment that described the other three as protected.**

Batch time grows with the table — nine triggers a row, a follower lookup a row,
growing indexes — so the run walked into a limit it had explicitly set out of the
way and could not see coming.

## Diagnosis was nearly impossible, and that is a second defect

`enqueue_post_job()` catches its own failure and `RAISE WARNING`s **once per
row** (the `post_jobs` queue does not exist on staging — recorded in F-79). A
failed 5,000-row batch therefore carries ~5,000 warnings ahead of the one line
that says what went wrong, and on run 33892294982 that line was pushed past the
CI log's line-truncation limit. **The cause could not be read from CI at all** —
it had to be recovered from the database's own logs.

`psql()` now keeps the **last 40 lines** of stderr and says how many it dropped.
The error is at the end; a head slice keeps 40 warnings and throws away the
diagnosis.

## The fix

Every setting travels as SQL, as `SET LOCAL`, **inside the batch's own
transaction** — the Auditor's ruling, and the stronger form: a session-level
`SET` would leak to whatever else reused that pooled backend.

```
write: BEGIN; SET LOCAL statement_timeout = 600000; SET LOCAL lock_timeout = 5000;
       SET LOCAL idle_in_transaction_session_timeout = 120000; <sql>; COMMIT;
read : BEGIN READ ONLY; SET LOCAL statement_timeout = 180000; … <sql>; COMMIT;
```

PGOPTIONS is kept as **the belt, and the comment now says it is not the braces.**

### Proved on a fixture (F-65), with the server-side limit planted

A scratch PostgreSQL 16 with `statement_timeout = 300ms` — the pooler's 120 s
scaled so the control runs in seconds — and **PGOPTIONS never set**, which is
what the pooler does.

```
PLANT · SET LOCAL removed  (the Auditor's named control)
  ERROR:  canceling statement due to statement timeout          exit 1
  ^ reproduces run 33892294982 verbatim

FIX · SET LOCAL inside the batch's own transaction
  the long batch completed                                      exit 0

SET LOCAL really is local — after COMMIT, statement_timeout = 300ms again
F-78 not regressed — BEGIN READ ONLY still gives
  ERROR:  cannot execute CREATE TABLE in a read-only transaction
stdout stays machine-readable — [{"a":1,"b":"x"}], JSON.parse succeeds
```

### A claim I made that the fixture contradicted, corrected rather than dropped

My first version of this fix carried a comment saying the explicit `BEGIN` on the
write path was needed **because `SET LOCAL` outside a transaction is a no-op**.
The fixture said otherwise:

| measured | result |
|---|---|
| `SET LOCAL` genuinely alone in its own invocation | `WARNING: SET LOCAL can only be used in transaction blocks`, setting does not persist |
| `psql -c "SELECT txid_current(); SELECT txid_current();"` | **741, 741** — psql already wraps a multi-statement `-c` in ONE implicit transaction |
| the payload **without** an explicit `BEGIN` | completed, exit 0 |

So the explicit `BEGIN` is **not required** for `SET LOCAL` to bite here. It is
kept for a better reason, and the comment now says that reason instead: without
it the guarantee rests on a psql **client** behaviour rather than on what we
send. Swap psql for a driver, or let that behaviour change, and `SET LOCAL`
degrades to a warning nobody reads — which is exactly the F-78/F-84 failure mode.
Making the transaction explicit puts the guarantee back into the SQL.

Recorded because a mechanism I asserted and then measured to be wrong is worth
more in the ledger than a comment quietly rewritten to match.

## Proof the tests could have failed

`psqlPayload(sql, { readOnly, timeoutMs })` is a pure function, so it is tested
on the string it builds, not by a regex over the file.

```
PLANT: SET LOCAL statement_timeout removed  (the Auditor's named plant)  32 passed, 2 failed
PLANT: SET LOCAL downgraded to session-level SET                        31 passed, 3 failed
PLANT: the caller's timeout ignored, a constant used instead            33 passed, 1 failed
PLANT: lock_timeout and idle_in_transaction dropped                     33 passed, 1 failed
PLANT: SET LOCAL moved BEFORE BEGIN, where it is a no-op                32 passed, 2 failed
PLANT: the write path loses its explicit transaction                    33 passed, 1 failed
PLANT: F-78 REGRESSION — BEGIN READ ONLY dropped                        33 passed, 1 failed
PLANT: the write path wrapped READ ONLY — the seeder could not write    32 passed, 2 failed
NO PLANT                                                                34 passed, 0 failed
```

`db-seed-staging.test.mjs` unchanged at 34 passed, 0 failed.

## State of staging — the partial seed is intact and confined

Two independent readings agree exactly.

| count | mine, 16:08:57Z | Auditor, 16:13:27Z |
|---|---|---|
| `posts` | 80,217 | 80,217 |
| seeded present | 80,200 | 80,200 |
| `user_notifications` | 58,516 | 58,516 |
| `profiles` | 513 | 513 |
| `follows` | 513 | 513 |
| `post_media` | 5 | 5 |
| `album_photos` | 0 | 0 |
| `post_hashtags` | 0 | — |
| database | 502 MB | 502 MB |

`posts` = 17 real + 80,200 seeded, exactly the progress line the run printed
before it died. **No member table moved.** The failure was a cancelled statement,
not a corrupted write: the batch that was cancelled rolled back whole.

**The 80,200 rows STAY.** Resume-by-gap is the seeder's design —
`INSERT … ON CONFLICT (id) DO NOTHING`, resuming from the first missing ordinal —
so the run continues from 80,201 rather than starting again. They are not torn
down, and the teardown proven on 300 rows at `122d6ea` reverses them when the
Owner asks for that.
