# F-66 — the `ALTER DEFAULT PRIVILEGES` rule makes the F-62 trap self-replenishing

**Filed by** D1 (Database & Runtime), on the Auditor's ruling of 2026-09-03
**Lane** production `jtdtehuqtinjxropkkcn` · **SELECT only** · no grant altered on either lane
**Fixture** scratch PostgreSQL 16.13 in the D1 container — F-65's rule: grant controls run on fixtures, production is not touched to prove a property of Postgres
**Transcript** `docs/evidence/d1/tc-v3/F-66-fixture-transcript.txt`

---

## 1 · The finding

F-62 established that 246 of 305 anon-executable functions in `public` are reachable by `anon` through a grant to `PUBLIC`, so a `REVOKE ... FROM anon` on them succeeds and changes nothing. That report described the trap as a state to be cleaned up.

**It is not a state. It is a process, and it is still running.**

Production carries a default-privilege rule which, contrary to how it reads, does **not** replace PostgreSQL's built-in default. It **adds to** it. Every function created in schema `public` from now on is therefore born with `PUBLIC` holding `EXECUTE` — that is, born into F-62's `TRAP-BOTH` class — unless its own migration explicitly revokes `PUBLIC`.

Phase 1 can close all 246 and the 247th will arrive with the next migration.

---

## 2 · How this was found

It was found by being wrong in public and then measuring.

Asked to state the `proacl` expected after the TC-v3 migration applies, D1 was about to answer `{postgres=X,anon=X,authenticated=X}` — reasoned from the shape of the migration's own `REVOKE ... FROM public; GRANT ... TO anon, authenticated;` tail. That answer would have been wrong in a way nobody would have caught until someone diffed a real ACL: it omits `service_role`, which arrives from a rule the migration never mentions.

Reading `pg_default_acl` first, and then reproducing it on a fixture, produced the correct answer and this finding with it. **Standing discipline: assert from the system, never from the shape of the code in front of you.**

---

## 3 · The measurement

### 3.1 The rule, read from production

`pg_default_acl`, 2026-09-03 **09:30:17Z**, `SELECT` only:

| granting role | schema | objtype | default ACL |
|---|---|---|---|
| `postgres` | `public` | `f` | `{anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |

Equivalent to:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
```

Read literally, that names three roles and does not name `PUBLIC`. The natural inference — and the one D1 made — is that a new function is created with exactly those three grants.

### 3.2 What actually happens — fixture, four steps

**Step 1 · no rule in force.** `CREATE FUNCTION` →

```
proacl = NULL
```

`NULL` is not "no grants". It means *the built-in default*, and for a function the built-in default is `EXECUTE` to `PUBLIC`. This is the same trap `TRAP-PUBLIC-ONLY` names in F-62: the most permissive state in the system is the one that reads as empty.

**Step 2 · install production's rule.**

```
pg_default_acl = {anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
```

**Step 3 · create a function under it.**

```
proacl = {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
PUBLIC holds EXECUTE = true
```

**The leading `=X/postgres` is `PUBLIC`, and it is still there.** The rule added three roles on top of the built-in default rather than replacing it.

That string is **byte-for-byte `get_top_contributors_v2`'s ACL on production**, measured 2026-09-03 08:44:30Z. v2 did not acquire its `PUBLIC` grant through neglect or through some historical migration — **it acquired it at `CREATE` time, from this rule, exactly as every function since has.**

**Step 4 · apply the TC-v3 migration's tail.**

```sql
REVOKE ALL ON FUNCTION ... FROM public;
GRANT EXECUTE ON FUNCTION ... TO anon, authenticated;
```
```
proacl = {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
anon=true  authenticated=true  service_role=true  PUBLIC=false
```

`service_role` survives because it came from the default rule and nothing revoked it. **This is the `proacl` to expect on production after the TC-v3 apply**, and it is v2's exact reach minus `PUBLIC`.

---

## 4 · What follows

**For F-62.** Its census remains correct as amended — 246, not 222 — but its framing needs this addition: the number is not static and cleaning it up once does not hold. The census probe (`supabase/migrations/PROBE_public_grant_census.sql`) is re-runnable for this reason, and re-running it after any migration is the only way to know the number is still 246.

**For F-64.** The two findings compose, and the composition is worse than either alone. F-64: a closed function reopens on `DROP` + `CREATE`, because `proacl` resets to `NULL`. F-66: on this database, a fresh `CREATE` does not merely reset to `NULL` — it lands on an ACL that carries `PUBLIC` *and* three named roles. So the reopening is not "back to the built-in default"; it is back to a grant set somebody has to read carefully to see the problem in.

**For Phase 1's method.** The standing step the Auditor is writing into the register — *every new function ends with `REVOKE FROM PUBLIC`* — is the correct control and this finding is the reason it is needed on **new** functions and not only on the revocation list. D1 does not write that step; it is recorded here as the evidence behind it.

**For the TC-v3 migration's header comment.** It currently says *"`CREATE FUNCTION` grants `EXECUTE` to `PUBLIC` by default"*, quoting v2's own comment. True of vanilla PostgreSQL, and true here, but it understates the mechanism: on this database the grant arrives together with three named roles, which is why the ACL does not look like a bare default. **Per the Auditor's ruling the accepted TC-v3 patch is NOT re-cut**; the comment is amended in a follow-up unit after v3 lands.

---

## 5 · What is not claimed

- **The rule's origin is not established.** `pg_default_acl` records the rule, not who ran it or when. It is consistent with the platform's own bootstrap and with the `SEC-01` entry on the standing register; D1 did not determine which, and did not guess.
- **Staging was not measured.** Its `pg_default_acl` is unread as of 2026-09-03 09:30Z and must not be assumed to match production. A migration proven on staging is proven against staging's grant defaults.
- **No function was called, and no grant was altered on either lane.** Every production statement was a `SELECT`; every mutation was on a scratch instance that held no real data.
- **Schemas other than `public` were read but not analysed.** `pg_default_acl` also carries entries for `storage`, `graphql`, `graphql_public`, `cron`, `extensions`, `realtime` and `auth`. Two of them — `graphql` and `graphql_public` — grant `EXECUTE` to `anon` by default. Whether that matters is a separate question and is **not** answered here.

---

## 6 · Status

| class | applies to |
|---|---|
| **VERIFIED** | §3.1 — read personally from production `pg_default_acl`, `SELECT` only, 09:30:17Z |
| **VERIFIED** | §3.2 — run personally on a scratch PostgreSQL 16.13, transcript committed beside this file |
| **VERIFIED** | the v2 ACL comparison — measured 08:44:30Z, byte-for-byte identical to the fixture's step 3 |
| **N/A** | staging — not measured |
| **DEFERRED** | the non-`public` schemas noted in §5 |

*D1 · Database & Runtime · 2026-09-03. Filed on the Auditor's ruling. No SQL apply. No grant altered on either lane. Repository at `origin/staging` `5cd5ba6`.*
