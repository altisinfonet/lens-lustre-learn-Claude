# §25.3 rows 1, 2, 3 — measured capture

Produced by Session 2 (independent measurement), WO-13 Task 2. Read-only throughout: only `SELECT`
statements were issued, and the only HTTP method used against a deployed endpoint was `OPTIONS`
(a CORS preflight, non-mutating by specification). No migration, no policy change, no function
deploy, no write of any kind. No credential value appears in this file.

**Redaction note:** the raw preflight responses carried a `set-cookie: __cf_bm=…` Cloudflare
bot-management cookie. Per the standing constraint on cookies, those four lines are redacted in
`preflight_raw.txt`; nothing else in the responses was altered.

---

## Connection identity

| | Row 1 | Row 2 |
|---|---|---|
| lane | **production** | **staging** |
| project ref | `jtdtehuqtinjxropkkcn` | `ztzutckwdhetphwghuzj` |
| database | `postgres` | `postgres` |
| `current_user` / `session_user` | `postgres` / `postgres` | `postgres` / `postgres` |
| `current_setting('role')` | `none` | `none` |
| server | PostgreSQL 17.6 (aarch64) | PostgreSQL 17.6 (x86_64) |
| access route | Supabase MCP server, this session | same |

**Role class, stated plainly:** `postgres` is the database-owner/superuser class, **not** a
read-only role. The read-only property of this capture is a property of the *statements I issued*
(SELECT only), not of a grant. An auditor reproducing this under §25.4 route (a) with a genuinely
read-only role would get the same rows; I did not have such a role and did not request one.

## Row 3 identity

| | value | as-of |
|---|---|---|
| endpoint | `https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/submit-judge-decision` | 2026-08-31T06:24:48Z |
| function id | `4626a932-2a8b-4a76-a132-4aeb0c8d743c` | 2026-08-31T06:24Z |
| **deployed version** | **23** · status ACTIVE · `verify_jwt: true` · `import_map: false` | 2026-08-31T06:24Z |
| `ezbr_sha256` | `cd6e035019b48937b82eadfe45533f06b08cd28d2a1120a40b114179b9e59d1a` | 2026-08-31T06:24Z |
| `updated_at` (epoch ms) | 1784729078126 | — |
| gateway echo | `sb-project-ref: jtdtehuqtinjxropkkcn`, `x-served-by: supabase-edge-runtime`, `x-sb-edge-region: us-east-1` | 2026-08-31T06:24:49Z |

---

## Exact queries

Identity / count query, run against each lane unchanged:

```sql
SELECT now() AT TIME ZONE 'UTC' AS as_of_utc,
       current_database() AS db, current_user AS role_name, session_user AS session_role,
       current_setting('role', true) AS role_setting, version() AS pg_version,
       (SELECT count(*) FROM pg_policies
         WHERE schemaname='public' AND tablename='ad_creative_comments') AS policy_count,
       (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relname='ad_creative_comments') AS rls_enabled,
       (SELECT to_regclass('public.ad_creative_comments')::text) AS table_exists;
```

Enumeration query, run against each lane unchanged:

```sql
SELECT schemaname, tablename, policyname, permissive, roles::text AS roles, cmd,
       coalesce(qual,'(null)') AS qual, coalesce(with_check,'(null)') AS with_check
FROM pg_policies
WHERE schemaname='public' AND tablename='ad_creative_comments'
ORDER BY cmd, policyname;
```

Row 3 probe, run four times with different `Origin` values:

```
curl -sS -i -X OPTIONS "https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/submit-judge-decision" \
     -H "Origin: <ORIGIN>" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: authorization, content-type"
```

---

## MEASURED RESULT — before any comparison to the ledger

### Row 1 — production `jtdtehuqtinjxropkkcn` · as-of 2026-08-31T06:24:00.150559Z

`policy_count = 7` · `rls_enabled = true` · table exists.

| # | policyname | permissive | roles | cmd |
|---|---|---|---|---|
| 1 | Deleted accounts cannot delete | RESTRICTIVE | {authenticated} | DELETE |
| 2 | Members or admins delete an ad comment | PERMISSIVE | {authenticated} | DELETE |
| 3 | Deleted accounts cannot insert | RESTRICTIVE | {authenticated} | INSERT |
| 4 | Members comment as themselves | PERMISSIVE | {authenticated} | INSERT |
| 5 | Members read ad comments | PERMISSIVE | {authenticated} | SELECT |
| 6 | Deleted accounts cannot update | RESTRICTIVE | {authenticated} | UPDATE |
| 7 | Members edit their own ad comment | PERMISSIVE | {authenticated} | UPDATE |

### Row 2 — staging `ztzutckwdhetphwghuzj` · as-of 2026-08-31T06:24:03.390207Z

`policy_count = 9` · `rls_enabled = true` · table exists. All seven above, **plus**:

| # | policyname | permissive | roles | cmd | predicate |
|---|---|---|---|---|---|
| 8 | Banned users cannot comment on ads | RESTRICTIVE | {authenticated} | INSERT | `WITH CHECK (NOT is_banned((SELECT auth.uid())))` |
| 9 | Ad comments follow the ad's visibility | RESTRICTIVE | {authenticated} | SELECT | `USING (EXISTS (SELECT 1 FROM ad_creatives c WHERE c.id = ad_creative_comments.creative_id AND (c.is_active OR has_role((SELECT auth.uid()), 'admin'))))` |

The two extra policies are the whole of the difference; the seven shared policies are byte-identical
in name, permissive flag, roles, cmd, qual and with_check across both lanes.

### Row 3 — `submit-judge-decision` · as-of 2026-08-31T06:24:49Z

Deployed **version 23**. Served response headers, `OPTIONS` preflight, HTTP/2 200 in all four cases:

| Origin sent | `access-control-allow-origin` served |
|---|---|
| `https://www.50mmretina.com` | `*` |
| `https://staging.50mmretina.com` | `*` |
| `https://evil.example.org` | `*` |
| *(no Origin header)* | `*` |

Also served, identically in all four: `access-control-allow-methods: POST, OPTIONS` ·
`access-control-allow-headers: authorization, x-client-info, apikey, content-type` ·
**no `access-control-allow-credentials` header** (as-of 2026-08-31T06:24:49Z).

The value is a static wildcard: an arbitrary foreign origin receives the same grant as the
production origin. This agrees with the bundle's own code — the deployed
`submit-judge-decision/index.ts` (sha256 `9531b0ca5b9f71ba40843c2d6e80ce665dfd8930693d4df5ea99011563a36b44`,
captured 2026-08-30) carries the literal `"Access-Control-Allow-Origin": "*"` at line 45. Carried and
served agree.

---

## COMPARISON to the ledger's claims — made only after the above

| Row | ledger claim | measured | verdict |
|---|---|---|---|
| 1 | 7 policies, production | **7** | **agrees** |
| 2 | 9 policies, staging | **9** | **agrees** |
| 3 | v23, serving `Access-Control-Allow-Origin: *` | **v23**, serving `*` | **agrees** |

All three ledger claims reproduce. What the counts alone do not say, and what this capture adds:
the two policies production lacks are both **RESTRICTIVE**, i.e. both *tighten* access. As-of
2026-08-31T06:24:00Z production has no policy preventing a banned user from inserting an ad comment,
and no policy tying ad-comment visibility to the parent creative's `is_active` flag. That is the
substance behind "7 vs 9", and a count would have hidden it.

---

## Closure route claimed

**Route (b) — an export the auditor can independently validate — claimed with a stated limit.**

This file plus `preflight_raw.txt` is a durable artefact with a sha256 over it. What the hash proves
is that the file has not changed since it was written. It does **not** prove the values came from the
databases: I generated it, and a hash of one's own output is not provenance.

What makes it independently validatable is that every value is reproducible from the exact queries
above, against the two named project refs, by anyone holding read access — which is the check §25.4
route (a) describes. **The right disposition is: treat this as route (b) evidence whose validation
step is re-running the three queries.** It is not a CI log and it is not signed. If the auditor
requires a self-authenticating export, this does not meet that bar and should be re-taken as a CI
job whose logs they read directly.

## Stamped negatives

- No write, migration, policy change or function deployment was performed — as-of 2026-08-31T06:25Z.
- No `access-control-allow-credentials` header served by `submit-judge-decision` on any of the four
  probes — as-of 2026-08-31T06:24:49Z.
- No policy on `ad_creative_comments` in either lane targets a role other than `authenticated` —
  as-of 2026-08-31T06:24:03Z.
- No difference between the two lanes other than the two staging-only policies named above —
  as-of 2026-08-31T06:24:03Z.
