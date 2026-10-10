# PHASE 1 · CONTROL CYCLE 2 — D1 forensic (read-only) + D2 + D3

No production migration. No SQL executed against production. Ledger untouched.

---

# D1 — MIGRATION LEDGER FORENSIC (read-only)

## D1.1 Why 615 in Git and 19 in production

The ledger records a migration **only when it is applied through Supabase's own
tooling** — the CLI or the MCP connector. Both write a row to
`supabase_migrations.schema_migrations`.

Every ledger row is dated **2026-08-13 or later**, and every one corresponds to
work done through the connector from that date. Everything before it was applied
by the earlier **Lovable pipeline**, which executes SQL directly and does not
write to that table. The migrations ran; nothing recorded that they ran.

So this is **not** 596 unapplied migrations. It is 596 applied migrations with
no receipt.

## D1.2 Classification of the 615 Git versions

| Class | Count | Evidence |
|---|---|---|
| Historical — applied, unrecorded | **597** | all versions < `20260813171159`; the objects they declare are present in production (see D1.3) |
| Potentially unapplied | **0** | every one of the 18 Git versions ≥ `20260813171159` appears in the ledger; the set difference is empty |
| Duplicate / superseded | **2 version collisions + 49 objects** | two version strings used twice (below); 49 objects created by one migration and dropped by a later one |
| Uncertain | **12 index declarations** | see D1.3 |

Distribution of the 597 unrecorded versions: Feb 63 · Mar 111 · Apr 217 ·
May 118 · Jun 13 · Jul 37 · Aug 40.

## D1.3 Is production consistent with Git's cumulative intent?

Method, stated so its limits are visible: every `CREATE TABLE` / `CREATE
FUNCTION` / `CREATE INDEX` name was extracted from all 618 migration files,
objects dropped by a later migration were excluded, and a sample was checked for
existence in production. This proves **presence**, not that each object's
*definition* matches what Git's cumulative replay would produce. A full replay
comparison is not possible read-only.

| Object class | Checked | Absent in production |
|---|---|---|
| tables | 84 | **0** |
| functions (incl. every critical RPC) | 40 | **0** |
| indexes | 24 | **12** |

**Tables and functions: consistent.** Every table sampled and every critical
RPC — `get_feed_candidates`, `post_publish_with_media`, `judging_write_decision_atomic`,
`wallet_ledger_apply_v2`, `submit_competition_entry`, `media_begin_upload`,
`can_view_post`, `suggest_hashtags` and others — exists.

**Indexes: NOT consistent.** 12 of 24 sampled index names declared in Git do not
exist in production:

```
idx_ce_comp_status   idx_cv_entry        idx_feed_events_user
idx_posts_privacy_created   idx_posts_user_created   idx_ava_entry
idx_jal_comp   idx_jal_judge   idx_jea_entry   idx_js_entry
idx_pvr_entry  idx_pvr_status
```

Two distinct sub-classes, and they must not be treated alike:

- **Superseded by rename** — production carries an equivalent under a longer
  name: `idx_posts_privacy_created_at`, `idx_posts_user_id_created_at`,
  `idx_feed_events_user_created`, `idx_comp_entries_comp_status`. Harmless.
- **`idx_pvr_*`** — these index a `pvr` table that **does not exist** in
  production at all. Either the migration never ran, or the feature was removed
  without removing its migration. **UNRESOLVED. Do not baseline the ledger
  until this is explained.**

## D1.4 Is there a safe reconciliation that records without executing?

**Yes.** Supabase's CLI has an operation for exactly this case. It writes ledger
rows and runs none of the SQL:

```
supabase migration repair --status applied <version> [<version> ...]
```

The equivalent direct form, same effect:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('<version>', '<name>')
on conflict (version) do nothing;
```

Both are metadata-only. Neither touches a table, function, policy or index.

## D1.5 The exact proposed operation — NOT EXECUTED

```
# READ THIS BEFORE RUNNING. Records 597 historical migrations as already
# applied. Executes none of their SQL. Reversible by deleting the rows.
supabase migration repair --status applied \
  $(ls supabase/migrations/*.sql | sed 's|.*/||' | grep -oE '^[0-9]{14}' \
    | sort -u | awk '$1 < "20260813171159"')
```

**Preconditions I will not waive:**

1. The `idx_pvr_*` question above must be answered first. Baselining while an
   unexplained absence exists records "applied" over something that may not be.
2. The two duplicate version strings (D1.6) must be resolved first — `repair`
   keys on version, so a duplicated version records one row for two files.
3. A ledger snapshot must be taken immediately before, so the operation can be
   undone row-for-row.

## D1.6 Collision risk from filename/version mismatch

**Two real collisions, both pre-existing, neither mine:**

```
20260801160000_notifications_history_and_grouping.sql
20260801160000_require_own_profile_photo.sql

20260810120000_bell_actor_known.sql
20260810120000_tag_anyone_not_only_friends.sql
```

The ledger's primary key is `version`. Two files sharing one version can only
ever produce one row — so after any baseline, one of each pair is
indistinguishable from the other, and a future `db push` would consider the
second already applied and skip it. This is the concrete mechanism by which the
drift would become silent damage.

**Third mismatch, mine, now resolved by D2:** `20260816T1900_hashtag_index.sql`
vs ledger `20260817051750`.

## D1.7 On "never run db push"

Recorded as rejected, per the owner's rule 7. It is a safety control, not a
resolution: it leaves Git and production disagreeing permanently and makes the
repository unusable as a source of truth for anyone new. A CI guard may be added
as a *temporary* control while D1.5's preconditions are cleared. It is not the
architecture.

---

# D2 — GIT-ONLY CLEANUP (executed, verified)

```
R100  supabase/migrations/20260816T1900_hashtag_index.sql
   →  supabase/migrations/20260817051750_hashtag_index.sql
R100  supabase/migrations/20260816T1900_hashtag_index_ROLLBACK.sql
   →  supabase/rollback/20260817051750_hashtag_index_ROLLBACK.sql

2 files changed, 0 insertions(+), 0 deletions(-)

cbb3efaecc9a82fe4da1c9adb497e93461a9b1a2   migration, unchanged
f377fbef5d644309fe7185fb41cd1dc2f259a6f1   rollback,  unchanged
```

ROLLBACK files remaining in `supabase/migrations/`: **0**.

**A fault occurred mid-transport and is recorded rather than hidden.** The two
deletions committed before the two uploads did; for a short window `origin/main`
held **neither** filename and the migration was absent from Git. Caught by the
post-transport hash verification, not by luck — the check reported `MISSING`
against both expected hashes. Both files were re-uploaded and re-verified.
Production was never involved: no SQL ran at any point, and the file's only
executed copy is the one already applied on 2026-08-17.

Lesson recorded: **upload before delete**, never the reverse, when the transport
is not atomic.

---

# D3 — STRICT TYPESCRIPT, MEASURED ONLY

`tsconfig.app.json` was **not modified** (verified with `git diff --quiet`).
Strictness was applied as a command-line flag for measurement only.

```
CURRENT_TYPECHECK_RESULT   0 errors (tsc --noEmit -p tsconfig.app.json)
STRICT_FAILURE_COUNT       49
FILES_AFFECTED             29
```

**STRICT_FAILURE_CATEGORIES**

| Count | Code | Meaning |
|---|---|---|
| 7 | TS2322 | `string \| null` assigned where `string \| undefined` expected |
| 4 | TS2322 | `RefObject<T \| null>` vs `RefObject<T>` |
| 3 | TS7016 | untyped third-party module, no declaration file |
| 3 | TS2345 | `string \| undefined` passed where `string` required |
| 3 | TS2322 | `string \| null` assigned to `string` |
| ~9 | TS7006/7031 | implicit `any` on parameters and destructured bindings |
| 2 | TS18048 | value possibly `undefined` |
| rest | mixed | argument-shape mismatches |

**Worst files:** `WallPosts.tsx` (9) · `VerifyCertificate.tsx` (3) ·
`UserMenu.tsx` (3) · `Referrals.tsx`, `JudgePanel.tsx`, `CourseEditor.tsx`,
`useWallet.ts`, `useJudgeCompetitions.ts` (2 each).

Read plainly: the overwhelming majority are **null-vs-undefined** mismatches,
which are mechanical and low-risk. 49 across 29 files is a contained job, not a
rewrite. No change made; awaiting separate approval.
