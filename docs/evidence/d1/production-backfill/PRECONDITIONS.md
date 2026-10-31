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
