# P10-F1 · the four certificate tests, and why they were red

**2026-10-04 · D2 · executes AUDITOR R-70 §4 · staging `edc1451`.**

## The cause, re-verified here rather than taken from the ruling

R-70 §4 found it: #291 (D1 Unit C, `f6fe1a5`, 2026-09-24) neutralised three
withdrawn certificate migrations under R-24 / R-26 by prefixing every line of
each body with `-- `. The four tests read those files and regex-match their SQL.

Re-measured on `edc1451` before changing anything:

```
npx vitest run src/__tests__/adminCertificates.test.ts src/__tests__/certificateTiers.test.ts
  4 failed | 50 passed (54)
```

Every failure reads `expected '-- ====…' to match /…/`.

## The part of the cause that the ruling did not need, but the fix does

Look at WHICH four failed. Every pattern that crosses a line break, or anchors
to the start of one, died:

| assertion | pattern | why it died |
|---|---|---|
| refuses an empty recipient query | `/if v_q = '' then\s*\n\s*return;/` | `\s*` cannot match `-- ` |
| deletes only rows keyed to the certificate | `/delete from public\.user_notifications\s*\n?\s*where reference_id = OLD\.id;/` | same |
| refused on any type but custom | `/heading is null\s*\n\s*or \(type = 'custom'/` | same |
| returned by admin_list_certificates | `/^  heading         text,$/m` | `^  ` is now `-- ` + spaces |

**And every pattern that fits inside one line still passed** — against a line
that is now a comment. That is forty-six assertions, and they were passing by
accident: not checking anything, just matching substrings in commented-out text.

So the red four were never the whole defect. They were the only part of it loud
enough to notice.

## Why the fix is not "let the regexes tolerate `-- `"

Loosening those four would turn the file uniformly green and uniformly
meaningless: fifty assertions reading a body the database has never seen in that
form, none of them able to fail for the reason they were written. That is C-34
inverted — not a test that could not have failed, but a test that can no longer
fail honestly.

## What was done

`src/test-utils/neutralisedMigration.ts` performs the recovery the neutralised
file documents **in its own header**:

> strip this block, then strip exactly three characters from the start of every
> remaining line, and the result is the original file.
>
> sha256 of the original, before neutralisation (newline-preserving): …

and then **verifies that sha256**, throwing if it does not match. The four
locator functions in `adminCertificates.test.ts` and `certificateTiers.test.ts`
now read through it. Nothing under `supabase/**` is touched: the migrations stay
neutralised, which is the R-24 / R-26 ruling and it stands.

Recovery checked against all three files before any test was changed:

| file | recorded sha256 | recovered |
|---|---|---|
| `UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql` | `882377860500…` | MATCH |
| `UNAPPLIED_20260825120000_certificate_delete_removes_notifications.sql` | `8ffaa7fd7f34…` | MATCH |
| `UNAPPLIED_20260825170000_certificate_custom_heading.sql` | `fc33500515dc…` | MATCH |

The forty-six accidental passes now pass for the right reason, and the suite
gains a guard it never had: **nothing checked that hash until now.** Standing
Rule 21 — the header is an instructing comment, and therefore a control.

## Result

```
npx vitest run src/__tests__/adminCertificates.test.ts src/__tests__/certificateTiers.test.ts
  54 passed (54)
```

which is the same 54/54 R-70 §4 got by restoring the three files from `f6fe1a5^`
— reached without un-neutralising anything on disk.

## C-34 · the guard is shown able to fail

Both mutants applied to `UNAPPLIED_20260825170000_certificate_custom_heading.sql`
only, run, then the file restored and its sha256 confirmed byte-identical
(`044b1920b473…` before and after).

**MUTANT A — one character of the preserved body changed.**

```
→ …certificate_custom_heading.sql: the neutralised body no longer recovers to
  the sha256 its own header records.
    recorded:  fc33500515dc9d08262d6b736c7fd9470166e92cbb7c8e96d1e77376864ba9a1
    recovered: b118ed2ed1ed475f19c62fa64fc47f23046a4951c266601241cd807a96f4fe0d
```

Every test using the helper fails, naming the file. This is the case that did
not exist before: editing a neutralised body used to be silent.

**MUTANT B — the `END $withdrawn$;` guard line removed.**

```
× is refused by the database on any type but custom
× is returned by admin_list_certificates, or the admin screen cannot see it
  2 failed | 25 passed (27)
```

The helper stops recognising the file as neutralised, hands back the raw text,
and the original four go red again — i.e. the fix is doing the work, not
masking it.

## What this still does NOT prove — raised, not papered over

These assertions read **withdrawn** files. The objects they describe are live on
staging (R-70 §4: `certificates.heading` exists, `admin_list_certificates`
returns it), but **no applied migration in this repository creates them**:

```
grep -rln admin_search_certificate_recipients supabase/migrations/
  UNAPPLIED_20260911101721_new_project_full_schema_bootstrap.sql
  UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql
  20260910_0028_p32identity2_admin_search_and_generate_url_revoke.sql   (revoke only)
```

`cleanup_certificate_references` and `certificates.heading` are named only by the
withdrawn files and by the (also `UNAPPLIED_`) full-schema bootstrap.

So a green suite here is evidence about the **text of three withdrawn files**,
not about the live schema, and it should not be read as the latter. Closing that
gap means an applied migration, which is `supabase/**` — D1 and the Auditor.
Raised as **F-D2-2**.

## One existing guard went red, and it was right to

`src/test-utils/__tests__/migrations.test.ts` keeps a `DELIBERATE` allowlist of
tests that read `supabase/migrations/` with their own `readdirSync`, each with a
written reason. Routing the two certificate tests through the shared helper made
their entries stale, and the guard said so, in both of its self-checks:

```
× the allowlist has no stale entries
× the guard can actually see the files it is meant to police
```

That is the guard working. Its own comment states the remedy: *"A listed file
that no longer reads the directory should come off the list, or the list stops
describing the repository."* So the two entries were removed — the only change
made to that file, and not a loosening: every other assertion in it, including
the three synthetic-tree self-checks, is untouched and green.

This is a test edit, so it is named here rather than left in the diff: **two
allowlist entries deleted, nothing else.**

The same change also moves these two call sites toward what that helper exists
for. Its header says the original bug "was not that anyone wrote a bad filter —
it was that fifteen call sites each wrote their own." There are now two fewer.
`neutralisedMigration.ts` takes `MIGRATIONS_DIR` from
`@/test-utils/migrations` rather than rebuilding the path, and **refuses** a
fragment that matches more than one file instead of taking the first — a check
neither certificate test had.

### The gap this opens, stated rather than left

The guard walks `src/` for `*.test.ts(x)` only. Resolution for these two tests
now lives in `src/test-utils/neutralisedMigration.ts`, which is not a test file
and is therefore outside the scan. Nothing today reads the directory naively
there, but the guard can no longer prove that. Extending its walk to the
non-test helpers under `src/test-utils/` would close it; that is a change to a
guard D2 did not design, in a PR about certificate tests, so it is **raised as
F-D2-3 and not done here**.

## Out of scope, and why it matters anyway

A fifth test, `src/lib/__tests__/referralReward0023Withdrawn.test.ts`, fails on
**`main` only**, with the same cause in a different file: the rollback it reads
exists only on `main`, was neutralised under R-24 / R-26, and so no longer opens
with the banner the test requires. It is not one of the four R-70 named, and it
is not fixed here. **It means main's Android `npm test` gate fails for two
reasons, not one.** Raised as **F-D2-1**.
