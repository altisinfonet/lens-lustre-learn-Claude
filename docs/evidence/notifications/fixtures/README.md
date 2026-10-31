# N0 fixture (local Postgres 16)

Two databases, built from these files:

- staging-shaped: `N0_fixture_common.sql` only (no cron, no pg_net, no push /
  e-mail tables) — proves every section survives a missing table.
- production-shaped: common + `N0_fixture_production_extra.sql`.

Run:

```
createdb n0stg  && psql -d n0stg  -f N0_fixture_common.sql
createdb n0prod && psql -d n0prod -f N0_fixture_common.sql -f N0_fixture_production_extra.sql
psql -d n0prod --set ON_ERROR_STOP=1 -c "SET p32.lane='production';" -f supabase/migrations/PROBE_20261104_0100_notifications_map.sql
```

Seen on 2026-10-31:

| Run | Result | Why |
|---|---|---|
| no `p32.lane` | FAIL (refused) | lane guard |
| first draft, either lane | FAIL | `CREATE TEMP TABLE AS` refused inside `BEGIN READ ONLY` → maker set moved to a CTE |
| second draft, staging-shaped | FAIL | `push_config` missing → that line moved into a guarded block |
| final, staging-shaped | PASS, rc 0 | 8 sections print `*_SKIP` with the reason |
| final, production-shaped | PASS, rc 0 | base64 bodies decode to the printed md5 (4/4); the body holding `Bearer …` is withheld (SECRET_SUSPECT); the push secret, e-mail addresses and ids never appear |
| review round 1 (blocking: secret screen) — previous PROBE vs the 5 bypass cases added to the fixture | FAIL | `v := '…'`, `DECLARE _t text := '…'`, a 44-char base64 key, an e-mail address and a hard-coded uuid all decoded from B64 |
| final after review, both shapes | PASS, rc 0 | all 5 bypass cases and the `Bearer` body WITHHELD (md5 + length only); 0 leak hits; BEGIN ATOMIC function and a procedure listed; `UN_DUP60S_ROWS` = 4 for 5 rows 10 s apart (rows, not pairs); push host printed as host name only |
| review round 2 (blocking: screen still bypassable; trigger / index / default / alarm text unscreened) — previous PROBE vs 10 new cases | FAIL | JSON header key, `CONSTANT`/`DEFAULT` declarations, `E'…'`, header-name signature, a key in a `--` comment, a trigger argument, a uuid in a WHEN clause, a partial-index literal, a column-default literal, an e-mail in an alarm key — all 10 printed |
| final after round 2, both shapes | PASS, rc 0 | **no function source is printed at all** (SRC = md5 + length; 0 B64 lines); trigger = table, name, timing, events, `has_when`, `args=N`; partial index `WHERE <predicate>`; literal default `<literal>`; alarm key prefix only; 0 hits for all 17 planted values |
| review round 3 (blocking: alarm keys without `:` printed whole; the round-2 alarm claim was untested — no alarm row existed) — previous PROBE vs new rows | FAIL | e-mails in alarm keys (`/`, space), free-text type / platform / status / template labels, a `user:p@ss@host` push URL, an index-expression literal — 8 values printed |
| final after round 3, both shapes | PASS, rc 0 | alarm keys print the leading `[a-z_]` run only (`push_fail<…>`, `mail<…>`); free-text labels `<other>`; push URL → `plain_supabase_function_url=f` only; index literals `<lit>`; cron call list limited to names in `pg_proc`; maker / caller / other-schema filters also search BEGIN ATOMIC bodies; 0 hits for every planted value |
| review round 4: **nothing blocking**; four small notes applied | PASS, rc 0 | with `client_min_messages=warning` as the role default the counts still print (35 lines; `SET LOCAL client_min_messages = notice`); a uuid-shaped type label → `<other>`; free-text types fold into ONE `<other>` line; CRON handler also catches a timeout |

Planted values are low-entropy markers (`PLANTED_…`, plus the e-mail / uuid /
label shapes) so the repository's own secret scan does not flag a fixture;
the leak check greps for `PLANTED`, `R3`, `@x.z`, `@y`, `beef`, `0b5e2a8c`.
