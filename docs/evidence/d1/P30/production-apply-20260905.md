# P30 · APPLIED TO PRODUCTION — 2026-09-05

`public.email_exists(text)` is no longer executable by `anon` on the production
database. This is the first production database change this team has made.

**Authority:** the Owner approved the waiting run at the `production` environment
gate. It had been dispatched 2026-09-04T12:53:42Z and sat unapproved for
**≈12 h 25 m** until he released it — the gate did exactly what it exists to do.

---

## 1 · The run

| | |
|---|---|
| Workflow | **Apply a database migration** — run **#22**, id **`33875099635`** |
| Job | **`101030093969`** — *Apply SQL to production* |
| Dispatched | **2026-09-04T12:53:42Z** |
| Approved & started | **2026-09-05T01:18:47Z** |
| Completed | **2026-09-05T01:19:04Z** — **17 seconds** |
| Ref | `main` @ **`493d4d49a79c0ffc036ba5af0053a11a94eed801`** |
| `TARGET_LANE` | `production` |
| Conclusion | success |

⚠ The ref is `main` **before** the P-0 promotion (`b309576`). P30's file has been
on `main` since #150; the promotion that landed later carried no SQL at all.

**The approver is not separately exposed by the Actions API.** `actor` and
`triggering_actor` both read `altisinfonet`, the repository account, which is
also the dispatcher. That the approval was the Owner's is recorded on the
Auditor's word and by the environment gate having held the run for 12 hours,
not by a field this developer could read. Stated that way deliberately.

## 2 · The migration file, confirmed from two independent sources

**`supabase/migrations/20260910_0001_p30_email_exists_revoke.sql`**

| source | value |
|---|---|
| Run log, `MIGRATION_PATH` | `supabase/migrations/20260910_0001_p30_email_exists_revoke.sql` |
| Run log, `CONFIRM_PATH` | *identical* — the workflow's two-field confirmation matched |
| Git, blob on `origin/main` | **`615fa25483504344e6578cea64d9c8a70123d688`** |
| Same blob on `origin/staging`? | **yes, identical** |

Four guards passed before anything touched the database, each its own step:
*The branch must match the target* · *Refuse to start without the database
credential* · *The credential must point at the target database* · *Validate the
requested file*.

## 3 · The SQL, verbatim

Everything executable in the file. The rest of the file is comment.

```sql
REVOKE ALL ON FUNCTION public.email_exists(text) FROM public;
REVOKE ALL ON FUNCTION public.email_exists(text) FROM anon;

COMMENT ON FUNCTION public.email_exists(text) IS
  'Account-existence check. NOT executable by anon — P30, frozen revocation list docs/gates/P1-revocation-list.md §2.1 (rev 2, blob 88c08093). Granting EXECUTE to anon turns the public API key into an account-enumeration oracle feeding phishing and credential-stuffing lists; the password-reset screen must answer identically whether or not the address is registered. authenticated and service_role retain EXECUTE — the frozen list authorised revoking from public and anon only. If this function is ever recreated with DROP+CREATE it REOPENS to PUBLIC (F-66) and the revoke must be re-applied and re-proved.';
```

`psql --set ON_ERROR_STOP=1 --echo-errors --no-psqlrc -f "$MIGRATION_PATH"`,
step *Run it*, 01:19:01Z → 01:19:02Z. Its entire output:

```
REVOKE
REVOKE
COMMENT
```

**Three command tags, and the file contains exactly three statements.** Nothing
else ran. Then step *Confirm*:

```
✅ Applied: supabase/migrations/20260910_0001_p30_email_exists_revoke.sql
Verify from the app, not only from SQL — that is the check that counts.
```

## 4 · Before and after — the Auditor's readings

⚠ **ATTRIBUTION. Every reading in this section is the AUDITOR's**, taken with
`SELECT` only on `jtdtehuqtinjxropkkcn`. D1 ran nothing against production, then
or since. They are cited, not claimed.

| | BEFORE `01:11:55Z` | AFTER `01:20:26Z` |
|---|---|---|
| `email_exists` anon EXECUTE | **true** | **FALSE** |
| `email_exists` acl | *(anon present)* | `postgres=X/postgres \| authenticated=X/postgres \| service_role=X/postgres` |

No `anon` entry, and no leading `=X/postgres` PUBLIC entry. `authenticated` and
`service_role` retain EXECUTE, which is what the frozen list authorised and what
the file's own probe asserts — an over-revoke is as much a defect as an
under-revoke.

### ⚠ A precision about *which* statement closed it

The Auditor's note reads *"the F-62 two-step form was applied correctly, not a
no-op."* The outcome is right; the mechanism deserves the sharper statement,
because this file argued it in advance and it is the C-49/C-53 discipline to
keep a finding attached to its instrument.

**On this catalogue the `FROM public` line WAS a no-op, and the migration says
so itself**, from a measurement taken before it was written:

> *"⚠ THAT CONDITION IS NOT SATISFIED BY email_exists … both: aclexplode
> grantee=0 (PUBLIC) entries = 0 … So on today's catalogue `REVOKE … FROM anon`
> alone WOULD have closed this one. This file does not claim otherwise."*

There was no PUBLIC entry **before** the apply, so the absence of one after is
not evidence that the first statement did work. **`REVOKE … FROM anon` is what
closed the door.** The `FROM public` line was written first for three stated
reasons — §1 of the frozen list mandates the shape; F-66 means a future
`DROP`+`CREATE` reopens the function to PUBLIC and the anon-only form would then
silently stop working; and it costs one statement. It is insurance against a
future catalogue, not the thing that acted today.

## 5 · Blast radius — nothing else moved

The Auditor's readings, after the apply:

| function | anon EXECUTE | expected |
|---|---|---|
| `email_exists` | **false** | ✅ the unit |
| `search_certificates` | **true**, acl `=X/postgres \| postgres=X \| anon=X \| authenticated=X \| service_role=X` | ✅ **P31 NOT APPLIED** |
| `get_top_contributors_v3` | true | ✅ PUBLIC-BY-DESIGN (F-76) |
| `verify_certificate_by_token` | true | ✅ OI-3, unchanged |

`search_certificates` still carries the leading `=X/postgres` PUBLIC entry — the
one function where F-62 genuinely bites, and the reason P31's file uses the same
two-step form for real rather than as insurance.

### Member data, identical either side

`posts` **377** · `profiles` **111** · `certificates` **11** ·
`user_notifications` **5,855** · `user_roles` **113** · `post_media` **342** ·
database **139 MB**.

**ZERO DAMAGE.** A grant change touches the catalogue, not a row, and the counts
either side say so rather than the design saying so.

## 6 · Proved over real anonymous HTTP

The check the workflow's own last line asks for — *"verify from the app, not
only from SQL"*. The Auditor, production anon key, no session bearer:

| request | result |
|---|---|
| `POST /rest/v1/rpc/email_exists` | **401** `{"code":"42501","message":"permission denied for function email_exists"}` |
| `POST /rest/v1/rpc/get_top_contributors_v3` | **200**, real rows |
| `POST /rest/v1/rpc/verify_certificate_by_token` | **200** |

An anon key is the attacker's instrument, so an anon caller is the only valid
test of an anon revoke — a logged-in browser cannot see this change at all,
because `authenticated` retains EXECUTE by design.

**Live site:** 7 pages all 200; bundle byte-identical (etag `de669099…`, index
sha `fc6310e5…`); home feed renders real content.

## 7 · The one member-visible consequence, and why it is safe

`ForgotPassword-BJl06yD9.js` is the **only** consumer of `email_exists` across
all 141 production chunks (Auditor's grep). It is **fail-open by construction**:

```js
let c = null;
try { const {data:f, error:k} = await rpc("email_exists", …);
      !k && typeof f === "boolean" && (c = f); }
catch { c = null }
if (c === false) { return }
await resetPasswordForEmail(...)
```

A 401 leaves `c` **null**, never `false`, so the guard does not trip and the
reset email still sends. Two independent mechanisms give the same answer: the
error branch sets nothing, and `null === false` is false.

**What a member sees change:** the *"No Account Found"* screen stops appearing;
everyone who submits the form now gets the generic "check your inbox" result.
That is a deliberate loss of a UX affordance the Owner once chose — and P30
exists precisely because that affordance was an account-enumeration oracle.

## 8 · Still open

- **P31 is NOT applied to production.** `search_certificates` remains executable
  by `anon`. Held.
- **`authenticated` retains EXECUTE on `email_exists`**, per the frozen list.
  Raised in the migration and unresolved: anyone may create an account, so
  `authenticated` is a smaller door against enumeration, not a shut one. It is
  rate-limitable and attributable in a way `anon` is not, which may be why the
  list stopped there. A revision of the frozen list, not a developer's decision.
- **Rollback available.** `20260910_0001_p30_email_exists_revoke.rollback.sql`
  restores the prior ACL. Nothing was dropped; the function body, volatility,
  `search_path` and `SECURITY DEFINER` flag are untouched, so this is reversible
  by redeploy. Recorded honestly: the restore is *privilege-equivalent*, not
  byte-equal, because `REVOKE`+`GRANT` re-appends `anon` to the ACL array.
