# F-93 on production — preconditions and ordering

Read-only assessment, 2026-09-06. **Nothing has been run against production.**
Run #23 remains held at the environment gate.

## Measured on production (`jtdtehuqtinjxropkkcn`), read-only

```
members                  116        no_handle                17
f93_functions_present      0        guard_tables_present      0
claim_username_present     1        claim_gates_on_predicate  false
claim_public_entries       1        ← PUBLIC holds EXECUTE
history_rows              99        released_names             0
distinct_handles          99
```

`no_handle` moved 18 → 17 with the member total and the newest join timestamp
both unchanged. Nobody joined in that window, so **an existing member claimed a
handle through `claim_username` while this assessment was being written.** That
path is in live use on a lane with no reserved list.

### The set moved again, and this is now the document's most important number

Re-measured 2026-09-06, after the Auditor and I had independently agreed on
`members 116, no_handle 17`:

```
members 117        no_handle 18
```

**A member joined between the two readings.** Both of us measured 116/17 and both
of us were right when we measured it. Neither number is true now.

This is not a correction to either measurement — it is the tap, demonstrated for
the third time in one day, and it is why the on-create trigger lands before the
backfill rather than after. It also has a direct consequence for the run:

> **Any expected-value table computed over the 17 is already one row short.**
> The predicted slug set must be recomputed against the live `custom_url IS NULL`
> set inside the same run that backfills it — not from a list prepared earlier,
> however carefully. A prediction made against a set that is still growing
> silently stops covering the newest member, and the newest member is exactly
> the one nobody has looked at.

## THE ORDERING

**The on-create trigger lands BEFORE the backfill, not after.**

The backfill fixes a set that is moving. If the tap is still open when it runs,
every signup between the backfill and the trigger arrives without a handle, and
we do the whole thing twice — once badly. Closing the tap first means the
backfill runs against a set that can only shrink.

Full order, and none of it is interchangeable:

1. **Guard tables** — `reserved_custom_urls`, `transliteration_map`,
   `name_part_spellings`.
2. **Functions** — `custom_url_fold_accents`, `custom_url_transliterate`,
   `custom_url_slug`, `custom_url_available`, `custom_url_ever_held`,
   `generate_custom_url`.
3. **`claim_username` gated on `custom_url_available`** (F-96b).
4. **The on-create trigger** — closes the tap.
5. **The backfill** — cleans up what is behind it.

### Why the backfill cannot go first

`generate_custom_url` → `custom_url_available` → `reserved_custom_urls`. Without
the tables it raises `42P01 relation does not exist` and cannot half-run.

The dangerous case is not that failure. It is a simplified generator that skips
the reserved check and *succeeds*: it would assign `admin`, `winners`, `feed` or
`wallet` to real members, who then sit permanently behind those routes,
unreachable, with nothing appearing broken.

### Why step 3 cannot come after renaming is enabled

F-96b is live on production: `claim_gates_on_predicate = false`. It is
unexploitable today only because `released_names = 0` — nobody has renamed. The
moment the change window ships, a released name can be taken by another member
and every link ever shared for its former holder resolves to the new one.

## PRECONDITION, NOT A STEP: every revoke is `FROM PUBLIC, anon`

`claim_public_entries = 1`. **PUBLIC holds EXECUTE on production**, so a revoke
written `FROM anon` will read as done and will not be done. That is F-98,
already proven on staging this morning, where the `authenticated` entry
genuinely vanished from the ACL while every member could still call the
function.

* Every revoke in the production pack is `REVOKE … FROM PUBLIC, anon` — the
  word `public` is the whole difference.
* Verification is `pg_proc.proacl`, checking the **empty-grantee `=X/…` entry is
  absent**. `has_function_privilege` cannot distinguish a direct grant from an
  inherited one and told both the developer and the Auditor the revoke had
  worked when it had not.

## The digit tripwire

`distinct_handles = 99` across 99 held handles — **no duplicates**. So the
digit-suffix rate on the production backfill should be near zero.

The preflight reports `digit_from_identical_names` and
`digit_from_collapsed_slugs` **separately**. A raw count cannot tell "two people
are genuinely called the same thing" from "the slug is collapsing distinct
names", and only the second is a defect. Staging's 474 was entirely the first —
511 rows carrying 37 distinct names. **A production rate anywhere near that is a
STOP, not a pass**, and the Auditor reads it before anything commits.

## THE TWELVE TRIGGERS ON public.profiles

The previous version of this document said the five fixture-cascade triggers are
`AFTER INSERT` and therefore unreachable from an `UPDATE`. That is true and it is
half the answer. Production carries **twelve** non-internal triggers on
`public.profiles`, and the half a reader actually needs is the ones that **do**
fire on a `custom_url`-only `UPDATE`. All twelve read from `pg_trigger` on
production, read-only; the bodies read from `pg_proc.prosrc`.

**Six fire. None aborts the backfill, and one is load-bearing.**

| Trigger | Why it fires | What happens |
|---|---|---|
| `block_custom_url_update` | `BEFORE UPDATE WHEN (old.custom_url IS DISTINCT FROM new.custom_url)` | **RAISES unless `app.allow_custom_url_update` is true — and NULL→value is DISTINCT, so it fires on every row of the backfill.** See the precondition below. |
| `protect_admin_name` | `BEFORE UPDATE`, **no WHEN, no column list** | Body guards on `OLD.full_name IS DISTINCT FROM NEW.full_name`. No-op here. |
| `trg_guard_profile_moderation` | `BEFORE UPDATE`, **no WHEN, no column list** | Body guards on `is_banned` / `is_suspended` / `suspended_until` changing. No-op here. |
| `trg_validate_profile_full_name` | `BEFORE INSERT OR UPDATE`, unconditional | Raises only on a null or whitespace `full_name`. Measured on production: **0 of the targets are null or blank**, so it cannot abort. |
| `trg_forbid_custom_url_change` | `BEFORE UPDATE OF custom_url` | Guarded by `OLD.custom_url IS NOT NULL`. NULL→value passes. |
| `sync_profiles_public_data_trg` | `AFTER INSERT OR DELETE OR UPDATE`, unconditional | **Writes to a second table. Load-bearing — see below.** |

**Six do not fire.** `on_first_admin_assignment`, `trg_auto_follow_official` and
`trg_auto_subscribe_newsletter` are `AFTER INSERT` only. `trg_profiles_normalise_name`
is `UPDATE OF full_name`, `trg_ensure_member_always_has_picture` is
`UPDATE OF avatar_url`, and `trg_sync_fallback_avatar_to_gender` is
`UPDATE OF gender` — a `custom_url`-only update touches none of those columns.

**So the backfill will not quietly rename a member, assign an avatar, follow the
official account or subscribe anyone to the newsletter.** That is a negative
result, checked for deliberately and found absent; it is recorded because
silence would not be the same as having looked.

### PRECONDITION: `app.allow_custom_url_update` must be set in the same transaction

`block_custom_url_update` aborts the backfill on its **first row** otherwise.
Migration 0010 already handles it with a transaction-`LOCAL` `set_config(...)`,
with the F-78 pooler reasoning written beside it. That is a precondition of the
**run**, not a detail of one file: a precondition that lives only in a migration's
comment is not a precondition anybody can check before dispatching.

### `profiles_public_data` is written by the backfill, and the after-check must read it

`sync_profiles_public_data_trg` fires on every `UPDATE` and upserts into
`public.profiles_public_data`. Its `INSERT` column list **and** its
`ON CONFLICT DO UPDATE SET` both carry `custom_url`, so the handle propagates
automatically. Verified in `prosrc`, not assumed.

**This is the difference between a backfill that works and one that reports
success while the names stay dead.** `dashboard-init` reads
`profiles_public_data` — not `profiles` — for the winners row and the voting
photographers (`admin.from("profiles_public_data").select("id, full_name, avatar_url, custom_url")`).
Had this trigger not carried the column, `profiles.custom_url` would have filled,
`profiles_public_data.custom_url` would have stayed NULL, and F-98c's fix would
have looked broken on those surfaces with nothing to explain it.

Measured on production, read-only, so post-run drift can only have been caused by
the run:

```
profiles 117   profiles_public_data 117   missing ppd row 0   handle drift 0
profiles no_handle 18          profiles_public_data no_handle 18
profiles_public_data non-internal triggers: 0   (the cascade stops here)
```

**The after-check therefore reads BOTH tables.** Zero on `profiles` alone is not
the acceptance condition; `handle_drift` must still be 0 and both `no_handle`
counts must be 0.

## The backfill creates nothing

All five triggers that fired on the staging fixtures are `AFTER INSERT ON
public.profiles`. The backfill only runs `UPDATE … WHERE custom_url IS NULL` on
rows that already exist, and an UPDATE cannot fire an AFTER INSERT trigger. The
cascade is unreachable by construction, not avoided by care.

**No fixture accounts on production, ever.** The preflight is a read-only
SELECT. If a future change ever needs to INSERT a profile on production, that is
a different operation with its own risk and its own authorisation.

## Standing rule, from tonight

**No edge function is deployed from an unmerged branch.** If a fix is urgent
enough to deploy it is urgent enough to merge first, or the deploy waits. The
only exception is a site-down incident. Cite the precedent: the wallet 401 had
been broken for days and one more hour would have cost nothing, and the deploy
opened a window where a redeploy from the tree would have silently reverted the
fix with no change in git to explain it.

This is held including when the Auditor is the one asking.
