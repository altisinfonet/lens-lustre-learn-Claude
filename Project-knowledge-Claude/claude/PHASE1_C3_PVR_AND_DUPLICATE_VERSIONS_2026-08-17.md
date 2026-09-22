# PHASE 1 · CONTROL CYCLE 3 — read-only investigation

No production change. No `migration repair`. No baseline. No `db push`.
No file renamed or deleted. Reads only.

---

# PART 1 — `idx_pvr_entry` / `idx_pvr_status`

## RESOLVED. They are historical/obsolete, and their absence is CORRECT.

| Question | Answer |
|---|---|
| Which migration created them | `20260421170513_ba7fc96b-…sql` — five indexes: `idx_pvr_entry`, `idx_pvr_participant`, `idx_pvr_competition_status`, `idx_pvr_status`, plus `idx_pvr_expires_at_pending` from `20260422075009_…` |
| Which table they target | **`public.photo_verification_requests`** — `pvr` is its alias, not a table name |
| Did the table ever exist in repo history | Yes. Created 2026-04-21. 13 migration files reference it. |
| Was it intentionally removed | **Yes, deliberately** — `20260427062252_3ab8f280-…sql` |
| Are the indexes obsolete/superseded | **Obsolete.** Dropped implicitly with their table by `CASCADE` |
| Does current code reference `pvr` | **No live query.** Two hits in `src/`, both comments (`useEntryPublicStatus.ts`, `SubmissionDetail.tsx`) |
| Is production missing a required object | **No** |
| Safe to classify historical/obsolete | **Yes** |

## The removal was deliberate, not accidental

`20260427062252` is a coherent decommissioning of the whole feature, in one file:

```
DROP TRIGGER  trg_notify_verification_request_created / _submitted / _decided
DROP FUNCTION notify_verification_request_created / _submitted / _decided
DROP FUNCTION get_stuck_verifications_admin, backfill_stuck_verifications
DROP TABLE    public.photo_verification_requests CASCADE
DROP TABLE    public.verification_requests CASCADE
-- then purges the legacy "Verification Required" judging tags
-- "…the four legacy system tags that the v3 spec no longer uses"
```

The v3 judging spec replaced it. The `CASCADE` removed the five `idx_pvr_*`
indexes with the table.

## Production state, verified

```
photo_verification_requests exists   false
indexes matching idx_pvr%            NONE
views referencing it                 NONE
```

## One live function still names it — and it is SAFE

`get_round_eligible_photos` mentions `photo_verification_requests` twice.
Reading its production body shows why that is not a fault:

```sql
IF to_regclass('public.photo_verification_requests') IS NOT NULL THEN
  RETURN QUERY EXECUTE $sql$ … FROM public.photo_verification_requests pvr … $sql$;
```

The reference sits inside a **dynamic SQL string**, behind a `to_regclass(...)`
existence guard. The table does not exist, so the branch never executes and the
string is never parsed. This is a deliberate compatibility guard, and it is the
reason nothing broke when the table was dropped. **Not called, not changed —
reading the definition is sufficient proof.**

## Correction to my own Cycle 2 report

I classified these as *uncertain* and said they might mean production was
missing something required. **That was wrong, and here is the mechanism.** My
drop-scan regex extracted the name that follows `DROP TABLE` — the *table*. The
indexes were removed implicitly by `CASCADE`, and no text scan of the SQL can
see an implicit drop. The scan reported "0 objects dropped later" for indexes
and I carried that forward.

**Production is consistent with Git's cumulative intent for these objects.**

## ➜ PRECONDITION 1 FOR THE LEDGER BASELINE IS CLEARED.

---

# PART 2 — THE TWO DUPLICATE VERSION STRINGS

## Both pairs are TWO DIFFERENT MIGRATIONS sharing one version. Both members of both pairs were applied.

### Version `20260801160000`

| | file A | file B |
|---|---|---|
| name | `…_notifications_history_and_grouping.sql` | `…_require_own_profile_photo.sql` |
| content hash | `1667738717bfd730f7b8503591ef9307129bb6af` | `b1f43e253b91c734bd47bbb9c9900e560f1671f6` |
| bytes | 7,625 | 4,961 |
| declares | `get_my_notifications_grouped`, `idx_user_notif_user_created` | `has_profile_photo` |
| present in production | **yes** (1 fn + 1 idx) | **yes** (1 fn) |

### Version `20260810120000`

| | file A | file B |
|---|---|---|
| name | `…_bell_actor_known.sql` | `…_tag_anyone_not_only_friends.sql` |
| content hash | `003542a4cd04240ac6bbfb97ff7c0b40998b6ff4` | `699e17ec14d1675fae548709f73f3a5679606f6e` |
| bytes | 7,967 | 4,467 |
| declares | `get_my_unread_notifications_grouped` | `validate_post_tag_insert` |
| present in production | **yes** | **yes** |

### The remaining questions

| Question | Answer |
|---|---|
| Same logical migration? | **No.** Different hashes, different sizes, **zero overlap** in declared objects. Notifications-grouping vs profile-photo requirement; bell-actor vs post-tagging rules. Unrelated. |
| Either version in the ledger? | **NEITHER** — both predate 2026-08-13 |
| Applied through the old pipeline? | **Yes, all four.** Every declared object exists in production; that is what proves each file ran. |
| Both first appeared in Git | commit `a57bb82`, 2026-08-11 — imported together, which is how the collision was introduced unnoticed |
| Safe to rename? | **Yes**, and rename is Git-only. Renaming changes no production object; the objects are already applied and the ledger holds neither version. |
| Rename targets free? | `20260801160001`, `20260801160002`, `20260810120001`, `20260810120002` — **all four unused** |

### EXACT FUTURE COLLISION RISK

`supabase_migrations.schema_migrations` is keyed on `version`. If the ledger is
ever baselined while a version is duplicated:

1. `migration repair --status applied 20260801160000` writes **one** row.
2. That single row satisfies **both** files.
3. Any later `db push` reads the ledger, sees `20260801160000` applied, and
   **skips both** — including one it may never actually have run.
4. Nothing errors. Nothing warns. The skip is silent.

That is the precise mechanism by which this drift becomes silent damage. Today
it is harmless only because both files happen to be applied already and nothing
runs `db push`.

### PROPOSED SAFE REPAIR SEQUENCE — NOT EXECUTED

Git-only. No production mutation. Preserves both files and both contents.

```
# 1. Record the before-state
git hash-object supabase/migrations/20260801160000_*.sql \
                supabase/migrations/20260810120000_*.sql

# 2. Rename the SECOND file of each pair to the next free version.
#    Chosen so alphabetical order still puts the pair adjacent, and the
#    original ordering between them is preserved.
git mv supabase/migrations/20260801160000_require_own_profile_photo.sql \
       supabase/migrations/20260801160001_require_own_profile_photo.sql
git mv supabase/migrations/20260810120000_tag_anyone_not_only_friends.sql \
       supabase/migrations/20260810120001_tag_anyone_not_only_friends.sql

# 3. Prove content is untouched — expect R100 and 0 insertions/deletions
git diff --cached --name-status
git diff --cached --stat
git hash-object supabase/migrations/20260801160001_require_own_profile_photo.sql   # b1f43e25…
git hash-object supabase/migrations/20260810120001_tag_anyone_not_only_friends.sql # 699e17ec…

# 4. Re-verify: zero duplicate versions remain
ls supabase/migrations/*.sql | sed 's|.*/||' | grep -oE '^[0-9]{14}' | sort | uniq -d
```

Which file of each pair to renumber is a judgement I will not make alone —
renaming the *second alphabetically* is proposed, but either is technically
safe since the two are independent.

**Transport note:** under the new rule this must run as
UPLOAD-NEW → VERIFY-REMOTE-HASH → DELETE-OLD → VERIFY-FINAL, for each file
separately. Four files, four verifications.

## ➜ PRECONDITION 2 IS UNDERSTOOD AND HAS A SAFE, PROPOSED, UNEXECUTED FIX.

---

# CONTROL PROCESS FINDING — NON-ATOMIC TRANSPORT

Recorded and adopted as standing procedure:

```
VERIFY SOURCE → UPLOAD NEW FILE → VERIFY REMOTE HASH
              → DELETE OLD FILE → VERIFY FINAL STATE
```

**Never delete before successful remote verification.** On partial failure:
STOP → reconcile → continue only once the state is proven.

Origin of the rule: in Cycle 2 the two deletions committed before the two
uploads, and `origin/main` briefly held neither filename. Caught by the
post-transport hash check, not by luck. Production was never involved.

---

# D3

No implementation. Strict mode unchanged. The measurement stands as recorded:
**49 errors across 29 files**, current typecheck **0**.
