# TC-v3 · production apply pack — what these two files are, and how they differ from the repo migration

**Author** D1 (Database & Runtime) · 2026-09-03
**Lane** production `jtdtehuqtinjxropkkcn`, cluster `7656985631720456337`
**Status** files delivered. **Nothing has been applied to production. D1 has no production apply authorisation and did not seek one.**

This file exists because `v3_PRODUCTION_paste.sql` carries **no comments at all**, on the Auditor's instruction. The reasoning has to live somewhere, and a migration whose reasoning was thrown away is a migration nobody can review next year. This is that somewhere.

---

## 1 · The two files

| file | sha256 | bytes |
|---|---|---|
| `v3_PRODUCTION_paste.sql` | `b0320fa7c6f83d96ad909ff322f43b73e1a4c8db75740a9b6dfca9fd64d0fe24` | 4,163 |
| `verify-production.sql` | `50fd86f50500d28ae4868303ec0900d3a1bc8f584c22a5b47024d99d555970fe` | 25,087 |

Run the first, confirm it commits, then run the second and read every verdict.

---

## 2 · Why the paste file is not the migration of record

**The migration of record is unchanged and stays unchanged:**

```
supabase/migrations/20260903090000_top_contributors_v3.sql
commit c38f796 · blob 7c994d54 · 12,928 B
sha256 05390ba6fd868c501fbc35b7391bfa4e89a3d3c2b752855a2c46ad6376108480
```

`v3_PRODUCTION_paste.sql` is a **derived artefact** for one transport — a hand paste into the Supabase SQL editor, which swallowed a leading `--` today. It is not a new version of the migration and it must never be committed to `supabase/migrations/`.

### 2.1 What was removed, and the proof that nothing else changed

Every `--` line comment. All of them, not only the header — a swallowed `--` anywhere turns a comment into executable text, and inside the dollar-quoted function body that corrupts the function definition. Removing the whole class removes the whole hazard.

Measured, not asserted. Both files were applied to two identical scratch PostgreSQL 16.13 databases carrying **production's own default-privilege rule**, and `pg_get_functiondef` was read back from each:

```
diff repo-definition paste-definition
  <     -- 30 UTC days: today, plus the 29 before it. Identical to v2.
  <     -- uid is the tie-break so the order is stable between calls rather than
  <     -- shuffling two equal scores on every refresh. Identical to v2.
```

**Three comment lines. Nothing else.** With SQL line comments stripped from both definitions, the two are byte-identical — same sha256, `44e26022e1e105a3423b22b7a3b973260e7a63de7523f2dd82f72a28c1a1df55`.

And every catalogue attribute matched exactly:

```
TABLE(user_id uuid, rank_position integer, contributor_score integer, recent_score integer)
volatility s | security_definer true | search_path=public | nargs 0
proacl {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
```

**Stated plainly so it is on the record:** `prosrc` will differ from a repo-file apply by those three comment lines. SQL comments are not executable, the parsed query is identical, and the catalogue is identical — but if anyone later diffs `pg_get_functiondef` on production against the repo file, that is the difference and it is expected.

If the Auditor would rather have the header back, **block comments would have been safe**: a `/* ... */` comment has no leading marker to lose. `verify-production.sql` uses them throughout for exactly that reason. Say the word and the paste file gets its header back the same way. That choice was not made unilaterally.

### 2.2 What was **added**, and why

Two things, both defensive, both easy to delete:

**A `BEGIN; ... COMMIT;` wrapper.** DDL is transactional in PostgreSQL. Without it, a failure partway through leaves a half-applied state; with it, either everything lands or nothing does.

**A lane guard, as the first statement.** It reads `pg_control_system().system_identifier` and raises unless the cluster is `7656985631720456337`. Pasting into the wrong project is the single most expensive mistake available here, and it costs one statement to make it impossible. **Shown firing:** run against a scratch cluster it aborted with

```
ERROR: LANE GUARD: this file is for PRODUCTION jtdtehuqtinjxropkkcn
(cluster 7656985631720456337). This cluster is 7681285470400259712. Nothing applied.
```

**A post-apply `DO $verify$` block, before `COMMIT`.** It asserts the frozen return shape, `STABLE SECURITY DEFINER`, `search_path=public`, zero arguments, PUBLIC absent, `anon` and `authenticated` present, v2 still there, and the helper still shut. Any failure raises, the transaction rolls back, **and a broken v3 cannot be committed.** This is deliberately not left to `verify-production.sql`: a verification you run afterwards reports, it does not control.

> **Note for psql users:** the file contains its own `BEGIN`/`COMMIT`, so run it **without** `--single-transaction`. The Supabase SQL editor has no such flag and needs no change.

---

## 3 · What `verify-production.sql` changes from the staging file

It is `verify-after-apply.sql` **adapted, not copied**. Three real differences:

1. **BLOCK 0 is new** — asserts the production cluster fingerprint. If it reads FAIL, stop: every other block is measuring the wrong database and their PASSes mean nothing.
2. **BLOCK 2 predicts from production's default-privilege rule, which is not staging's.** Production carries **one** entry for `public` functions, granted by `postgres`, read 12:29:14Z: `{anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. Staging carries two. Predicting production from staging's rule would produce a wrong expected string. The predicted post-apply ACL — `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` — was **reproduced on a fixture carrying production's exact rule with the paste file applied verbatim**, not inferred.
3. **Every reference reading quoted is production's own**, taken read-only on 2026-09-03.

`matches_prediction_exactly` is reported **separately from the verdict** on purpose. A mismatch there is a finding to report, not automatically a failure: a role added to this database since 12:29:14Z would change the string without weakening anything. The verdict tests the properties that matter; the string tests whether the world still looks the way it did.

### 3.1 It was shown failing before it was delivered (C-34)

On a fixture built with production's default-privilege rule, 60 members and a 44-member 30-day window — chosen to reproduce production's own measured loosened count of 44 at 08:46:15Z:

| condition | result |
|---|---|
| all correct | BLOCK 1–7 **PASS**, BLOCK 0 FAIL (fixture is not production — the guard working) |
| PUBLIC left on v3 | BLOCK 2 **FAIL**, `public_holds_execute t`, `matches_prediction_exactly f` |
| row cap removed | BLOCK 3 **FAIL** at 44 rows; BLOCK 7 returns 44 rows, **41 FAIL** and 3 PASS — the 41 members that leak |

A check that has never been seen to fail is not a control.

---

## 4 · Order, and what is not authorised

1. `v3_PRODUCTION_paste.sql` on **production**. It commits or it rolls back; there is no partial state.
2. `verify-production.sql` immediately after. **The gate is blocks 0–7 all PASS**, with block 7 showing three rows, `same_user` and `same_lifetime` true on every one.
3. Only then does D2 switch the Home card to v3 and `recent_score`. **A green run is a precondition of the behaviour step, not a report on it.**

**Staging is still unapplied.** The staging apply was refused in D1's session by the permission classifier at 11:11Z and `apply-migration.yml` is blocked on that lane by H-4, so the staging-first rule has not been satisfied by anything D1 can do. Applying to production first is a deviation from expand→behaviour→contract discipline and is **the Auditor's call to record, not D1's to make quietly.** It is named here so it cannot be discovered later.

**Rollback**, if any block reads FAIL: a one-line frontend revert to v2. **Client first, database second.** v2 is untouched by this apply and still anon-executable, so nothing has to be dropped and no SQL has to run to restore what a member sees. **Do not drop v3 to tidy up a failed verification before the Auditor has read the failing rows** — dropping it destroys the evidence of why it failed.

---

## 5 · Evidence classes

| class | applies to |
|---|---|
| **VERIFIED** | §2.1 equivalence and §3.1 negative controls — run personally on scratch PostgreSQL 16.13, 2026-09-03 |
| **VERIFIED** | production `pg_default_acl` §3.2 — read personally, SELECT only, 12:29:14Z |
| **VERIFIED** | the lane guard firing — run personally against a non-production cluster |
| **N/A** | production post-apply state — **nothing has been applied** |
| **BLOCKED** | the staging apply that should have preceded this — classifier refusal 11:11Z, H-4 on the workflow route |

*D1 · Database & Runtime · 2026-09-03 · production SELECT only · no SQL apply · no grant altered on either lane.*
