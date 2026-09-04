# OI-3 — `verify_certificate_by_token`: a reading, not a revoke

**Requested by the Auditor as the input to a ruling.** D1 has changed nothing about this function and
recommends changing nothing about it today. Everything below is `SELECT`-only against production
`jtdtehuqtinjxropkkcn`, 2026-09-04.

---

## 1 · What it is

```sql
CREATE OR REPLACE FUNCTION public.verify_certificate_by_token(_token text)
 RETURNS TABLE(id uuid, title text, description text, type text, issued_at timestamptz,
               recipient_name text, certificate_id text, verification_token text,
               is_revoked boolean, revoked_at timestamptz, revoked_reason text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT c.id, c.title, c.description, c.type, c.issued_at,
         p.full_name, c.certificate_id, c.verification_token,
         COALESCE(c.is_revoked, false), c.revoked_at, c.revoked_reason
  FROM public.certificates c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE c.verification_token = _token
  LIMIT 1;
$function$
```

`oid 22558` production / `18037` staging · `prosecdef=true` · `provolatile=s` ·
`proacl {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` ·
**PUBLIC EXECUTE entries = 1** · anon and authenticated both true. **Identical on both lanes.**

---

## 2 · The WHERE clause, which is the only control

`WHERE c.verification_token = _token` — **exact equality on a value the caller must already supply.**

That single line decides everything, and three properties follow from it:

1. **No enumeration surface.** No `ILIKE`, no wildcard, no range, no `OR`, and `LIMIT 1`. You cannot
   ask it *which* certificates exist. You can only ask *"is this exact string a valid token"*, one
   guess per call. Contrast `search_certificates`, whose `ILIKE '%' || _name || '%'` with `LIMIT 50`
   is precisely a directory.
2. **It reveals nothing to a caller who does not already hold the token.** A wrong guess returns zero
   rows. There is no oracle beyond valid/invalid, and validity is the thing verification exists to
   answer.
3. **The token it returns is the token you gave it.** The select list includes
   `c.verification_token`, which reads alarming — but the row only exists because the caller supplied
   that exact value. **Echoing back a secret to the party that just presented it discloses nothing.**
   (This is the one place a scanner keying on "returns a secret column" would misfire, which is why
   it is written down.)

**So it is a capability endpoint, and the capability is the token.** That is the same pattern the
frozen list already endorses: *"verify-by-unguessable-token stays public; search-by-identity does
not."*

---

## 3 · Which makes the whole question: is the token actually unguessable? — MEASURED

```
certificates_total   11
with_token           11        distinct_tokens  11
tok_len_min          64        tok_len_max      64
tok_hex_only         11        tok_uuid_shaped   0     tok_digits_only  0
```

**64 hex characters = 256 bits of key space**, every token distinct, no short or malformed outliers.
Assuming the generator is a CSPRNG — *which this reading does not verify, see §6* — that is not
guessable by any practical means, online or offline.

**Verdict on the capability model: it holds.** The exposure of `verify_certificate_by_token` to `anon`
is, on today's evidence, **correct product behaviour and not a finding.**

---

## 4 · Two supporting facts that make the case stronger

**`search_certificates` does NOT leak the token.** Its select list is `NULL::text AS
verification_token` — the column is in the return type but deliberately nulled. Confirmed in practice
on the fixture: `verification_token IS NULL` for every row returned. Had it leaked, the capability
model would already be broken and OI-3 would be urgent rather than a reading.

**`anon` has no direct read on the table.** Demonstrated on the fixture: `SET ROLE anon; SELECT
count(*) FROM public.certificates` → `permission denied for table certificates`. The `SECURITY
DEFINER` function is the only way in, so its `WHERE` clause really is the only control — exactly the
condition under which that clause has to be judged carefully, and it survives the judgement.

---

## 5 · ⚠ A THIRD FUNCTION, NOT ON THE FROZEN LIST AND NOT IN ANY UNIT'S SCOPE

While reading these I found **`verify_certificate(_cert_id text)`** — `oid 25132` production /
`18036` staging, `SECURITY DEFINER`, `STABLE`, and carrying the **same** PUBLIC-granted ACL
(`PUBLIC entries = 1`, anon true). It appears **nowhere** on the frozen list — neither cleared nor
blocked — exactly like `verify_certificate_by_token`.

```sql
WHERE c.id::text = _cert_id OR upper(c.certificate_id) = upper(_cert_id)
LIMIT 1
```

It returns `NULL::text AS verification_token`, so it does not leak the capability. It is lookup by the
**human-readable ID printed on the certificate** — structurally the same flow the Auditor already
ruled correct for `verify_staff_id` in C-60: somebody holds an artefact and types the identifier
printed on it.

Guessability, measured as **shape only** (no values read out): `certificate_id` is 15 characters,
`AAAA-` + 10 mixed alphanumerics, **11 of 11 distinct and 0 of 11 matching a sequential pattern** —
so roughly 36¹⁰ ≈ 2⁵¹. Not enumerable by hand; far weaker than the token's 2²⁵⁶, and **with no rate
limit**.

**D1's reading:** same class as `verify_staff_id` — a designed public verification path whose real
gate is a **rate limit**, not a revoke. **Not raised as a revocation, and not acted on.** Flagged so
it is on the record rather than discovered later by someone assuming the frozen list was exhaustive.

---

## 6 · What this reading does NOT establish — stated plainly

- **It does not verify how tokens are generated.** 256 bits of *length* is not 256 bits of *entropy*
  if the generator is weak or seeded predictably. The generator was not located or read. **That is
  the one thing that could overturn §3**, and it is the obvious next question if the Auditor wants
  certainty rather than a strong prior.
- **n = 11.** Every distribution statement rests on eleven rows. It is consistent, not conclusive.
- **No function was called against production to test any of this.** Bodies, ACLs and aggregates were
  read from the catalogue and the table; behaviour was exercised only on the scratch fixture.
- **It says nothing about transport.** Whether tokens leak through URLs, referrers, logs or shared
  screenshots is a client and delivery question, not a database one.

**Classification: VERIFIED** for the ACLs, bodies and aggregate measurements; **INFERRED** for
"unguessable", since it rests on length and distinctness rather than on reading the generator.

---

## 7 · D1's recommendation, for the Auditor's ruling

| object | recommendation |
|---|---|
| `verify_certificate_by_token(text)` | **Leave public. Not a finding.** Exact-match on a 256-bit token, no enumeration surface, returns nothing to a caller who does not already hold the capability. Closing it would break public verification — the very thing P31 exists to preserve. |
| `verify_certificate(text)` | **Not a revoke.** Same class as `verify_staff_id` (C-60). Its gate is a **rate limit**. Worth adding to the register as its own item so it stops being invisible. |
| the generator | **The one open question.** If certainty is wanted, read the code that produces `verification_token` and confirm it is a CSPRNG. |
