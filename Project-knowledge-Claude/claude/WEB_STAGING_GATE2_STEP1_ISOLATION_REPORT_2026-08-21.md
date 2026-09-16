# WEB STAGING · GATE 2 · STEP 1 — ISOLATION CONFIGURATION REPORT
**2026-08-21 · No production application data modified. No staging Pages project created
(held per instruction 3). No Phase 1–5 work. No Judging Panel work.**

## 1 · WHAT WAS CHANGED
**Nothing.** Step 1's only mutation — the two `ISOLATION_FORBIDDEN_REFS` variables — is a
Cloudflare **Pages** setting, and Pages has no API surface in this session (see §5). One
of the two targets does not exist yet in any case (staging Pages project, correctly not
created). So this step changed no system state anywhere.

## 2 · WHAT WAS VERIFIED (all four checks demanded, all PASS)

| # | Check | Method | Result |
|---|---|---|---|
| 1 | production ref ≠ staging ref | `list_projects` (both returned in one call) | **PASS** — `jtdtehuqtinjxropkkcn` vs `ztzutckwdhetphwghuzj`; separate hosts `db.jtdtehuqtinjxropkkcn…` / `db.ztzutckwdhetphwghuzj…` |
| 2 | production bucket ≠ staging bucket | `r2_buckets_list` + `r2_bucket_get` on each | **PASS** — `50mm` (created 2026-03-07, **APAC**) vs `50mm-staging` (created 2026-08-21, **ENAM**); distinct objects, `agentcrm` untouched |
| 3 | staging database still empty | direct SQL on staging | **PASS** — `public_tables 0`, `pg_policy 0`, `auth.users 0`, `supabase_migrations` schema **absent** |
| 4 | production not modified by staging work | direct SQL on production | **PASS** — see below |

### Check 4, in detail — the decisive evidence
- **Migration ledger UNCHANGED: 32 rows, max version `20260820181949`** — byte-identical to
  this morning's measurement. No DDL was applied to production at any point tonight.
- Every production statement issued this session was a `SELECT`/catalog read. No
  `apply_migration`, no INSERT/UPDATE/DELETE, no storage write.
- Structural counts consistent: 156 relations via `information_schema.tables`
  (= the 146 base tables + 10 views measured earlier by `pg_class` — **same system,
  different counter**, not a change), 730 policies, 101 auth users.
- Row counts **have** moved organically: posts 262, media_objects 273, post_media 270
  (this morning: 264 / 265 / 263). Attribution: **live member activity** — members posting
  and deleting through the app. Not staging work; nothing in this session can write there.
  Recorded as a healthy Phase-2 signal, not as a discrepancy.

## 3 · IDENTITIES (for the record; no secrets printed)
| | Production | Staging |
|---|---|---|
| Supabase ref | `jtdtehuqtinjxropkkcn` | `ztzutckwdhetphwghuzj` |
| Project name | 50mmretinaworld | 50mmretinaworld-staging |
| Region / PG | ap-northeast-2 / 17.6.1.141 | ap-northeast-2 / **17.6.1.155** |
| R2 bucket | `50mm` (APAC) | `50mm-staging` (ENAM) |
| Pages project | `lens-lustre-learn-claude` | *not created (correct at this gate)* |
| Publishable key | held, not printed | held, not printed |

⚠ Two non-identical elements recorded now rather than discovered later: staging Postgres is
one patch ahead (.155 vs .141 — Supabase provisions current patch; harmless, but staging is
therefore not a byte-identical twin), and the staging bucket landed in **ENAM** while
production is **APAC** (R2 gave no location choice in the create call). Neither affects
isolation; both affect "staging behaves exactly like production" claims, so they are on the
record.

## 4 · TESTS AND RESULTS
No test suites were run in this step (nothing changed to test). The four isolation checks
above are the step's evidence, each a live measurement, none inferred.

## 5 · BLOCKED — the exact boundaries

### 5a · `ISOLATION_FORBIDDEN_REFS` on production Pages — CLAUDE CANNOT DO
Re-tested this step, not assumed: the Cloudflare connector's complete tool set is
`d1_*`, `hyperdrive_*`, `kv_*`, `r2_*`, `workers_*`, `search_cloudflare_documentation`,
`migrate_pages_to_workers_guide`. **There is no Pages tool of any kind** — no read, no
write. Direct `api.cloudflare.com` is egress-blocked from this sandbox and no Cloudflare
credential exists in the environment.

**Exact action required (owner, or the Chrome-panel Claude which already has the tab):**
Cloudflare dashboard → Workers & Pages → project **`lens-lustre-learn-claude`** →
Settings → Variables and Secrets → **Production** environment → add one plain-text
variable: name `ISOLATION_FORBIDDEN_REFS`, value `ztzutckwdhetphwghuzj`.
**Not a secret.** Do not add it to Preview yet — Preview builds are still production-wired,
so forbidding the staging ref there is correct, but forbidding it becomes wrong the moment
Preview is repointed at staging; it is cleaner to set Preview when the staging lane exists.
Verify: the variable appears under Production; next production deploy's log line changes
from `forbidden=[]` to `forbidden=[ztzutckwdhetphwghuzj]`.
**Effect:** switches on the guard's leak-check half (rule R3). Until then only R2
(expected-ref-present) is exercising — stated in the Gate-1 record and unchanged.

### 5b · Staging Pages `ISOLATION_FORBIDDEN_REFS = jtdtehuqtinjxropkkcn` — NOT YET APPLICABLE
The staging Pages project does not exist (instruction 3). This variable is part of its
creation spec and will be set at that moment, not before.

### 5c · Production schema dump — CLAUDE CANNOT DO with available credentials
`supabase db dump --schema-only` / `pg_dump -s` both require the production **database
password** (or a Supabase access token). Neither exists in this environment, the Supabase
MCP exposes no dump tool, and **I will not ask for a secret to be pasted into chat.**

Exact command, for whoever runs it on a machine that holds the credential:
```
supabase db dump --schema-only --db-url \
  "postgresql://postgres:[DB_PASSWORD]@db.jtdtehuqtinjxropkkcn.supabase.co:5432/postgres" \
  -f prod_schema.sql
```
(`[DB_PASSWORD]` from Supabase dashboard → Project Settings → Database → Database password.
The file contains schema only — no member rows, no photographs, no auth data.)

**Alternative that needs no secret at all, offered for your decision — NOT started:**
I can reconstruct the schema by reading production's catalog through my existing read-only
SQL access (`pg_get_functiondef`, `pg_get_viewdef`, `pg_get_triggerdef`, `pg_indexes`,
`pg_policy`, `information_schema`), apply it to staging via `apply_migration`, then **prove
equivalence by measurement** — comparing staging vs production on table count, per-table
column counts, function count, policy count, index count, constraint count, and RLS-enabled
flags, with any mismatch failing the gate. Honest risk: a hand-built extraction can miss
things a real `pg_dump` handles natively (extension objects, default privileges, sequence
ownership, grant details); the comparison battery is designed to catch exactly that, but
"caught by comparison" is weaker than "never diverged". **Your call — I have not begun.**

## 6 · GATE 2 STEP 1 STATUS
**AMBER — not GREEN.** All four isolation verifications PASS; the step's one configuration
change is blocked at a genuine capability boundary (§5a). It goes GREEN the moment
`ISOLATION_FORBIDDEN_REFS` is set on production Pages and a deploy log shows
`forbidden=[ztzutckwdhetphwghuzj]`.

## 7 · NEXT GATE-2 STEP (not started)
Step 2 = staging database schema baseline, gated on your choice in §5c. Only after that:
Step 3 (staging Pages project + its four variables + domain), then edge functions,
synthetic seed, and the isolation battery.
