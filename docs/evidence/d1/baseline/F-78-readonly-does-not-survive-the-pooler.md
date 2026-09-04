# F-78 — the baseline's read-only guarantee did not survive the session pooler

**Found by running `scripts/db-baseline.mjs` end to end for the first time, 0-D1-01.**
**Found by the script's own negative control, which did exactly what it was built to do.**

---

## 1 · What happened

`d1-baseline.yml`, target `staging`, run **33877831292**, job **101038963294**, **2026-09-04T13:24:18Z**:

```
Lane OK: credential points at 'ztzutckwdhetphwghuzj', which matches target 'staging'.
THE READ-ONLY NEGATIVE CONTROL SUCCEEDED IN CREATING A TABLE. The session is NOT read-only.
Aborting before any probe. Drop public.__d1_readonly_negative_control__ by hand and report this.
##[error]Process completed with exit code 1.
```

The script **refused to write a baseline on an unproven read-only claim** and aborted before a single
probe ran. That is the designed behaviour and it is why this defect was caught on the first real run
instead of being published as a green artefact.

## 2 · ⚠ DAMAGE, STATED PLAINLY

The negative control is a real `CREATE TABLE`. Because the session was **not** read-only, it
**succeeded**, and left `public.__d1_readonly_negative_control__` on the **staging** database —
regular table, 1 column, 0 bytes, owner `postgres`.

**Dropped 2026-09-04T13:27:45Z.** Verified afterwards in the same statement:
`control_tables_remaining = 0`, `posts = 17`, `profiles = 513` — both unchanged from the pre-run
reading at 13:24:23Z. **No member data was touched at any point.**

This is the only write this investigation made to any lane, it was made by the guard rather than by a
probe, and it is recorded here rather than mentioned in passing.

## 3 · Root cause — isolated on a fixture, not inferred

The mechanism was implemented correctly. `db-lane-guard.mjs` sets
`PGOPTIONS='-c default_transaction_read_only=on …'` and passes it to `psql`. **The comment and the
code agreed; the assumption underneath both was wrong.**

`PGOPTIONS` is a **startup-packet** parameter. Supabase's **session pooler** does not forward it to
the backend. Same code, same flag, two transports:

| transport | `current_setting('default_transaction_read_only')` | `CREATE TABLE` |
|---|---|---|
| **direct** — scratch PostgreSQL 16, D1 container, 2026-09-04 | `on` | **ERROR: cannot execute CREATE TABLE in a read-only transaction** ✓ |
| **Supabase session pooler** — CI, 13:24:18Z | not applied | **SUCCEEDED** ✗ |

The apply-migration header already records that this project connects through the **session pooler**
(`postgres.<ref>` username, port 5432). Nothing about that is wrong; what was wrong was relying on a
startup-packet setting across it.

## 4 · The fix — enforcement moved into the query stream

`BEGIN READ ONLY; <sql>; COMMIT;` travels as ordinary SQL. **No pooler can strip it.**

`PGOPTIONS` is **kept as well** — belt and braces, and it still works on a direct connection — but it
is no longer the thing being relied on.

**Only the read-only path is wrapped.** Every `db-seed-staging.mjs` call passes `{ readOnly: false }`
and is deliberately untouched, or the seeder could not write at all.

### C-34 — shown failing before it was shown passing, on the fixture

```
A. no wrapper, no PGOPTIONS (the pooler's behaviour, reproduced)
     CREATE TABLE            -> CREATE TABLE          <- the defect, and it left __sim_pooler__ behind
     current_setting         -> off

B. with the wrapper, still no PGOPTIONS
     BEGIN READ ONLY; CREATE TABLE …; COMMIT;
                             -> ERROR: cannot execute CREATE TABLE in a read-only transaction

C. with the wrapper, a legitimate probe
     BEGIN READ ONLY; SELECT 1; COMMIT;   -> 1
```

And the output stays machine-readable, verified byte-exact with the helper's own flags
(`--no-psqlrc -X -A -t -q -v ON_ERROR_STOP=1`): stdout is `[{"a":1,"b":"x"}]` and `JSON.parse`
succeeds. `-q` keeps the `BEGIN`/`COMMIT` status lines off stdout, so the probes are unaffected.

`scripts/db-seed-staging.test.mjs` — **18 passed, 0 failed** after the change, unchanged from before.

## 5 · What this does NOT establish

- **The baseline JSON still does not exist.** This unblocks it; it does not produce it. 0-D1-01 is
  **NOT DONE** until the run completes and its JSON is committed.
- **Not verified through the pooler yet.** The fix is proven on a direct fixture. It becomes proven on
  the real transport only when the next `d1-baseline.yml` run reports the control firing with
  SQLSTATE 25006 — which is the very next step, and the run's own output is the evidence.
- **Scope.** `proveFingerprint` and every probe use the same helper and therefore inherit the wrapper.
  Nothing else in the repository calls `psql()` with `readOnly` true.
