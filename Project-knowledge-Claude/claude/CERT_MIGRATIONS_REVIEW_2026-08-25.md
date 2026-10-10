# Independent review of the two certificate migrations — and a third that is not in the repository (2026-08-25)

**Production was not touched.** Every statement run for this review was a `SELECT` against
`pg_catalog` / `information_schema` / read-only counts. No DDL, no DML, no migration applied.

Verdict up front:

| Migration | Verdict |
|---|---|
| `UNAPPLIED_20260825120000_certificate_delete_removes_notifications.sql` | **SAFE TO APPLY** — two documentation defects, no behavioural risk |
| `UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql` | **BLOCKED** — one of its three objects is superseded on staging by an untracked migration |
| `20260825101651 certificate_custom_heading` | **NOT IN THE REPOSITORY AT ALL** — applied to staging, no file, no rollback |

---

## 1. The finding that blocks everything: a third migration exists only on staging

Staging's ledger, newest first:

```
20260825101651  certificate_custom_heading           <-- NO FILE IN THE REPOSITORY
20260825070751  certificate_delete_removes_notifications
20260825054031  certificate_types_and_admin_search
20260824144927  admin_user_lookup_by_email
20260824120321  admin_user_list_pagination
```

`certificate_custom_heading` has **no file** under `supabase/migrations/`, **no rollback file**,
and is referenced nowhere in the tree — `grep -rl heading supabase/migrations/ supabase/rollback/`
returns nothing. What it did, measured:

| | Production `jtdtehuqtinjxropkkcn` | Staging `ztzutckwdhetphwghuzj` |
|---|---|---|
| `certificates` columns | **17** | **18** — extra column `heading` |
| `admin_list_certificates` returns | (absent) | `TABLE(id, user_id, title, description, type, **heading**, issued_at, is_revoked, revoked_at, revoked_reason, certificate_id, total_count)` — **12 columns** |
| repo file's `admin_list_certificates` returns | — | **11 columns, no `heading`** |

So **the file under review is not the object that was tested on staging.** — VERIFIED.

Three consequences, each concrete:

1. **The file cannot be replayed onto staging.** `create or replace function` cannot change a
   function's return type. Applying the repo file to staging would fail with *"cannot change
   return type of existing function"*. A migration that cannot be re-applied to the lane it
   supposedly came from is not a record of that lane.
2. **Applying it to production would create a different object from the one staging runs.**
   Functionally the app would survive — `CertRow` in `AdminCertificates.tsx` has no `heading`
   field, so the UI does not read it — but the lanes would then run different definitions of
   the same function, which is the drift the plan exists to prevent.
3. **§8.10's "staging schema matches production's structure" is now false.** One extra column,
   introduced outside the repository.

This is a §14 **HS-4** condition — two instruments (the repository file and the deployed
staging function) disagree about the same fact. Per HS-4 the resolution is not to pick the
convenient one.

**Owner decision required, and it is a product decision, not a technical one:**
is `heading` wanted?

- **Yes** → a real migration file must be written for it (plus rollback), and the repo's
  `admin_list_certificates` corrected to the 12-column form. Staging is already in that state.
- **No** → `heading` must be dropped on staging and the function re-created there from the
  file — which requires an explicit `drop function` first, because of the return-type change.

Either answer changes staging, which means a new commit, which means the next RC is cut
after that — not before.

---

## 2. `certificate_types_and_admin_search` — object by object

### 2.1 The CHECK constraint — SAFE, proven mechanically

```
alter table public.certificates drop constraint if exists certificates_type_check;
alter table public.certificates add constraint certificates_type_check check (type = any (array[...]));
```

Not additive — it replaces a constraint and `ADD CONSTRAINT ... CHECK` validates every
existing row. So the list was compared set-wise against production's live definition rather
than against the file's own comment:

```
file list count : 16   unique: 16   duplicates: NONE
prod list count : 14
in PROD but NOT in FILE (would break existing rows) : NONE
in FILE but NOT in PROD (additions)                 : ['achievement', 'custom']
```

Production holds **23 certificates** across **8 distinct types**, all inside both lists.
Validation will therefore pass. The `ACCESS EXCLUSIVE` lock and full-table validation are
immaterial at 23 rows. — VERIFIED SAFE.

### 2.2 `admin_search_certificate_recipients` — SAFE

File body vs staging's deployed `prosrc`: byte-identical after stripping SQL comments
(normalised md5 `e9255f775433` on both sides). Staging's deployment route strips comments;
the logic is the same statement for statement. `search_path` is `public, auth` in the file and
`public, auth` on staging — correct, because the body reads `auth.users` for the email.
SECURITY DEFINER with the `has_role(auth.uid(),'admin')` gate, `revoke` from public/anon,
`grant execute` to authenticated. Absent from production, so this is a create. — VERIFIED SAFE.

### 2.3 `admin_list_certificates` — **BLOCKED**, see §1

### 2.4 `idx_certificates_issued_at_id_desc` — SAFE

`create index if not exists`, absent on production, 23 rows. — VERIFIED SAFE.

---

## 3. `certificate_delete_removes_notifications` — SAFE TO APPLY

### 3.1 The file matches staging exactly

`cleanup_certificate_references` — file body md5 **`1e7b5d7c8099ae8ced5cef3a40a1af43`**,
246 bytes. Staging's deployed `prosrc` md5 **`1e7b5d7c8099ae8ced5cef3a40a1af43`**, 246 bytes.
Identical without normalisation. — VERIFIED.

### 3.2 Everything it touches is new on production

```
trg_cleanup_certificate_references exists on production : 0   -> `drop trigger if exists` is a no-op
cleanup_certificate_references     exists on production : 0   -> this is a create, not a replace
```

Existing triggers on `public.certificates`:

| trigger | level | timing | events |
|---|---|---|---|
| `audit_certificates` | ROW | AFTER | INSERT, DELETE, UPDATE |
| `trg_generate_certificate_identifiers` | ROW | BEFORE | INSERT |
| `trg_notify_certificate_issued` | ROW | AFTER | INSERT |

**No existing BEFORE DELETE trigger**, so there is no firing-order interaction to reason
about. `audit_certificates` still fires AFTER the delete, unchanged. — VERIFIED.

### 3.3 The un-filtered delete is safe on production data — checked, not assumed

The trigger runs `delete from public.user_notifications where reference_id = OLD.id` with no
type filter. The file argues a uuid identifies one row in one table. Measured on production:

```
user_notifications rows ................................. 3401
rows whose reference_id IS a certificate ................. 11
of those, rows with type <> 'certificate_issued' .......... 0
reference_id column type ................................. uuid
```

`reference_id` is `uuid`, not text, so a cross-table match would require a uuid collision.
Every notification currently pointing at a certificate is `certificate_issued`. — VERIFIED SAFE.

SECURITY DEFINER with `revoke all … from public/anon/authenticated` is correct: the function
is reachable only as a trigger, and definer rights are what let an admin's delete clean up
another member's notification past the `auth.uid() = user_id` RLS policy.

### 3.4 Two documentation defects — neither affects safety

1. **The file's measured orphan count does not reproduce.** The header states
   *"staging 3 orphans, PRODUCTION 1"* as of 2026-08-25. Production measures **0** today by
   the file's own query. The migration does not touch historical rows either way, so this is
   a stale claim, not a risk — but under Standing Rule G0 a claim in a migration header is
   evidence and should not be wrong.
2. **No rollback file**, see §4.

---

## 4. Both migrations are missing their rollback files

`supabase/rollback/` contains `UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql`
but **nothing for either certificate migration**, and nothing for `certificate_custom_heading`.
§13.1 requires a captured rollback before any release, and §17-9 requires a rollback target
that is itself verified. Three rollback files are missing:

- drop `admin_search_certificate_recipients`, `admin_list_certificates`,
  `idx_certificates_issued_at_id_desc`, and restore the 14-value CHECK constraint
- drop `trg_cleanup_certificate_references` and `cleanup_certificate_references`
- whatever reverses `certificate_custom_heading`, once that migration exists as a file

---

## 5. Expansion order — NOT YET PROVEN, and why

Order *within* the schema is straightforward: the two reviewed migrations share no objects and
are independent; the ledger applied `certificate_types_and_admin_search` →
`certificate_delete_removes_notifications` → `certificate_custom_heading`, and the same order
works on production. All three must precede the application promotion, per expand-then-deploy.

But the order **cannot be certified**, for a reason that is not about ordering:

**One of the three migrations does not exist as a file, and one of the files does not match
what was tested.** Expansion order is a property of a known set of migrations. That set is not
yet known. Certifying an order over an incomplete set would be exactly the fake-GREEN this
programme is trying to eliminate.

A further reconciliation item, noted rather than acted on: staging's ledger versions
(`20260825054031`, `20260825070751`) do not match the repository filenames
(`20260825060000`, `20260825120000`), and
`UNAPPLIED_20260824000000_admin_user_list_pagination.sql` is still named UNAPPLIED on staging
although it is applied on both lanes. §12.4 step 4 requires the repository files and the
database ledger to be reconciled before promotion; today they are not.

---

## 6. What must happen before production is touched

1. **Owner decides whether `certificates.heading` is wanted.**
2. Write the missing migration file for `certificate_custom_heading` (or remove the column
   from staging), and correct `admin_list_certificates` in the repo so the file and the
   deployed object are the same thing.
3. Write the three missing rollback files.
4. Reconcile ledger versions against repository filenames; rename the already-applied
   `UNAPPLIED_…admin_user_list_pagination.sql`.
5. Re-run the schema guard against production for the resulting tree.
6. Only then apply the schema to production, in ledger order, and only then promote the app.
