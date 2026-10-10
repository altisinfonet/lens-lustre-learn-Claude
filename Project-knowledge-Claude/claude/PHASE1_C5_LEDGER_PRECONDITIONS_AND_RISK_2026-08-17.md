# PHASE 1 · CONTROL CYCLE 5

Git renames EXECUTED and verified. Everything else read-only.
No ledger mutation. No `db push`. No TypeScript work. No B3d-IMG-1.

---

# THE APPROVED RENAMES — DONE, under the transport invariant

```
STEP 1 UPLOAD NEW      both new files, one commit          88c3766
STEP 2 VERIFY REMOTE   b1f43e25 = b1f43e25   MATCH
                       699e17ec = 699e17ec   MATCH   ← deletion permitted only after this
STEP 3 DELETE OLD      bfe7ad3, 99a56da
STEP 4 VERIFY FINAL    new: MATCH / MATCH · old: removed / removed
                       origin .sql files 618 · duplicates on origin ZERO
                       working tree vs origin: identical
```

Local proof: `R100`, `2 files changed, 0 insertions(+), 0 deletions(-)`.

---

# THE OWNER'S ARITHMETIC WAS RIGHT AND MINE WAS WRONG

I carried 597 forward. Resolving the pairs gives 618 files with 618 unique
versions, so the Git-only set is **599**. Recalculated mechanically, not assumed:

```
PRECONDITION 4   Git version set    618 unique across 618 files
PRECONDITION 5   Intersection        19
PRECONDITION 6   Git-only           599
PRECONDITION 7   Production-only       0
PRECONDITION 8   Duplicates            0   ✅
PRECONDITION 9   Repair row count    599
```

# PRECONDITIONS 1–3 — THE ACTUAL LEDGER, READ FROM PRODUCTION

**⚠ Three tables are named `schema_migrations`:** `auth.`, `realtime.`, and
`supabase_migrations.`. The target must always be schema-qualified.

```
supabase_migrations.schema_migrations
  version          text  NOT NULL     ← PRIMARY KEY
  statements       ARRAY NULL
  name             text  NULL
  created_by       text  NULL
  idempotency_key  text  NULL         ← UNIQUE
  rollback         ARRAY NULL

PK          schema_migrations_pkey (version)
UNIQUE      schema_migrations_idempotency_key_key (idempotency_key)
TRIGGERS    NONE
RLS         false
FKs pointing at it   NONE
rows        19
```

Two consequences that matter: `name` is nullable, so a `(version, name)` insert
is legal; and multiple NULL `idempotency_key` values are permitted, because
Postgres treats NULLs as distinct in a UNIQUE index — so 599 rows do not
collide.

**PRECONDITION 10** — the 599 `(version, name)` pairs are generated mechanically
from the filenames (`/tmp/repair_rows.json`), e.g.
`('20260812110000', 'post_drafts')`.

---

# HISTORICAL RISK CLASSIFICATION — 599 MIGRATIONS

**First run of this classifier was wrong and is corrected here.** The DML
pattern was `(update\s+)\s`, which demands two whitespace runs and silently
missed every plain `UPDATE public.x SET …`. Category E was under-counted by
about a quarter. Corrected counts (non-exclusive — a file may sit in several):

| | Category | Count |
|---|---|---|
| A | schema / object creation | 165 |
| B | GRANT / REVOKE | 153 |
| C | RLS / POLICY / view security | 196 |
| D | FUNCTION / TRIGGER | 308 |
| E | **DML / data transformation** | **204** |
| F | ALTER / constraint / type | 238 |
| G | storage / configuration | 51 |
| H | **destructive / irreversible** | **9** |
| I | uncertain | 10 |

## THE EXCEPTION LIST — 38 files, and why exactly these

Baselining executes nothing. The **only** harm pathway is: a version is recorded
as applied when it was not, and a future directory-ordered apply then skips it.
So the question is never "did this file have effects" — it is **"can we confirm
this file RAN?"**

- A file that declares a named object is self-confirming: the object exists in
  production, therefore the file ran. That covers the large majority.
- A file whose only effect is **data-level or destructive** leaves no named
  object behind. Its application **cannot** be confirmed this way.

That is the principled reduction from 188 raw candidates to **38**:

```
20260227065702  INSERT INTO public.photo_of_the_day …
20260322105821  UPDATE public.site_settings SET value = (value #>> '{}')::jsonb …
20260322151807  INSERT INTO storage.buckets ('email-assets') …
20260401144817  UPDATE public.gift_credits SET expires_at = expires_at + INTERVAL …
20260406103031  ALTER TABLE public.competitions ADD COLUMN voting_ends_at …
20260406112648  UPDATE judging_tags SET visible_in_round = ARRAY[2] …
20260408142134  UPDATE public.competitions SET phase = 'judging' …
20260416050223  UPDATE site_settings SET canonical_base …
20260416134319  ALTER TABLE public.competitions DROP COLUMN voting_starts_at        ← H
20260418091217 / 091301 / 091349 / 091516 / 091700   DO-block competition seeds
20260421043247  DO $$ … v_admin_id …
20260422140346 / 140554                              DO-block data fixes
20260425100905  INSERT INTO public.site_settings ('judging_realtime_distributed_mode')
20260427080203  INSERT INTO public.system_tag_decision_map …
20260427121011  UPDATE public.site_settings SET value = (value - 'api_key') …      ← secret removal
20260428061530  ALTER TABLE public.judging_tags DISABLE TRIGGER USER
20260428080624  SELECT set_config('app.bypass_round_lock','on',true)
20260429163853  DELETE FROM public.certificates WHERE id = 'a76f3734…'             ← H
20260430140739 / 141248 / 142259                     DO-block judging fixes
20260501125805 / 152809 / 155736 / 180829            DO-block judging fixes
20260502131212  DELETE FROM db_audit_logs …                                        ← H
20260502162609  ALTER TABLE public.judge_decisions DROP CONSTRAINT …               ← H
20260502173941  INSERT INTO public.competition_round_publish …
20260503091919  DELETE FROM judge_tag_assignments WHERE entry_id='c696a97c…'       ← H
20260513044455  DELETE FROM public.admin_notifications WHERE message LIKE '%HOTFIX5-SMOKE-%'
20260515085557  SELECT public.wallet_ledger_v2_diff_snapshot('1 hour')             ← calls a live function
20260525112627  ALTER TABLE public.profiles_public_data DROP COLUMN date_of_birth  ← H
20260805070000  ALTER TABLE public.profiles ADD COLUMN gender
```

Note what this list is made of: **one-time production data repairs**, several
of them targeting specific rows by UUID, plus column drops and a secret removal.
These are precisely the migrations that must never be replayed.

## CHARACTERISED RESIDUAL RISK — not "acceptable because all baselines have risk"

**The risk is directional, and it points the safe way.** For these 38, the two
possible errors are not symmetric:

- If a file **did** run and we record it applied → correct.
- If a file **did not** run and we record it applied → it is skipped forever.
  What is lost is a one-time data repair from Feb–Aug 2026, on a platform that
  has been serving members throughout. Its absence would already be visible as
  wrong data.
- If we **refuse** to record it and someone later runs a directory-ordered
  apply → it **re-executes**. `DELETE FROM certificates WHERE id='a76f3734…'`,
  `DELETE FROM judge_tag_assignments WHERE entry_id='c696a97c…'`,
  `UPDATE competitions SET phase='judging'`, `DROP COLUMN date_of_birth` — run a
  second time against today's data.

**Not baselining is the more dangerous option for exactly these 38 files.**
That is the characterisation, and it is the opposite of the intuitive answer.

## GENUINELY UNKNOWN — 10 files, marked UNKNOWN, not APPLIED

10 files fall in category I: nothing my classifier recognises. **I have not
inspected them individually and I will not convert them to APPLIED to make the
ledger tidy.** They stay UNKNOWN until read. That is a small, bounded piece of
work — 10 files — and it belongs in the next cycle, not in an assumption here.

---

# PROPOSED LEDGER REPAIR — NOT EXECUTED

```sql
insert into supabase_migrations.schema_migrations (version, name)
values
  ('20260224160300', '865c285a-6543-4437-a363-05dd0aa3ae09'),
  …                                              -- 599 rows total
  ('20260813120000', 'feed_author_identity')
on conflict (version) do nothing;
```

## PROVEN FROM THE ACTUAL PRODUCTION SCHEMA ABOVE — NOT FROM CLI DOCUMENTATION

| Requirement | Proof |
|---|---|
| changes only migration metadata | the statement names exactly one relation, `supabase_migrations.schema_migrations` |
| executes no migration SQL | the `statements` column is left NULL; nothing reads or runs it. There is no `EXECUTE`, no `DO`, no dynamic SQL in the statement |
| invokes no application function | no function call appears anywhere in the statement |
| performs no DML outside the ledger | one `INSERT`, one target table; **and the ledger has NO triggers** (verified: `triggers_on_ledger = NONE`), so nothing can fan out from the write |
| does not alter schema objects | contains no DDL verb of any kind |
| idempotent | `on conflict (version) do nothing`, against the real PK `schema_migrations_pkey (version)`; re-running is a no-op. 599 NULL `idempotency_key` values are legal — Postgres treats NULLs as distinct in a UNIQUE index |
| bounded exact row count | **599**, and `select count(*)` must read exactly `19 + 599 = 618` afterwards |
| precise rollback | `delete from supabase_migrations.schema_migrations where version in (<the same 599>);` — returning the ledger to exactly 19 rows |

**Why the SQL form and not `supabase migration repair`:** the CLI's contract is
a claim about code I have not read. The statement above is verifiable by
inspection in seconds. Per rule 29, a documented contract is not evidence.

## VERIFICATION SNAPSHOT — run immediately before AND after

```
ledger_rows   19 → 618        ledger_max_version  20260817051750 (UNCHANGED)
tables 145 · views 10 · functions 374 · indexes 436
policies 686 · triggers 148 · constraints 1318
```

Every schema count must be **identical** afterwards. Row counts for `posts`,
`profiles` etc. will drift — the platform is live. Any movement in the schema
counts means the operation did something it must not have, and the rollback
above runs immediately.
