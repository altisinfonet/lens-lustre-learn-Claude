# GATE 2 · STEP A1 — PRE-CHECK BEFORE A PRODUCTION CREDENTIAL RESET
2026-08-21 · READ-ONLY. Nothing reset. No value of any secret was read, printed or stored.
All probes were written to return **counts/booleans/names**, never contents.

## Q1 — Is `SUPABASE_DB_URL` genuinely absent/empty?  **YES**
Evidence (CI, from run 32546116626 on branch staging/schema-dump-tool):
```
env:
  DB_URL:
##[error]SUPABASE_DB_URL is not set
##[error]Process completed with exit code 1
```
The secret resolved to empty inside GitHub's own injection step; the workflow's
fail-closed guard stopped 13s in, before any connection was attempted. This is the
authoritative test — a non-existent secret and an empty one are indistinguishable to a
consumer, and both fail identically.
*Limit:* neither session can enumerate secret names (no `gh` CLI; the GitHub API path is
proxy-blocked here; the GitHub MCP exposes no secrets tool). The CI resolution above is
stronger evidence than a listing anyway: it tests the actual consumption path.

## Q2 — Has the referenced workflow ever successfully used it?  **NO**
- `apply-migration.yml`: **0 runs, ever** (verified by the code session via the workflow API).
- Independent corroboration from the database itself: all **32** ledger rows carry a single
  `created_by` value — `50mmretinaworld@gmail.com` — i.e. every applied migration went
  through the Supabase platform identity (dashboard/connector), **not** a CLI path
  authenticating with a database password. There is no trace of the credential ever
  having been used.

## Q3 — Does any production application/service depend on this credential?  **NO EVIDENCE OF ANY**
| Probe | Result |
|---|---|
| `cron.job` rows | **16 jobs**, of which **0** contain a connection string / `password=` / `dbname=` / `db.<ref>` pattern → pg_cron runs in-database, no stored credential |
| `pg_foreign_server` | **0** |
| `pg_user_mappings` | **0** |
| `dblink` / `postgres_fdw` / `wrappers` installed | **0** (available but not installed) |
| `site_settings` rows containing an actual postgres connection string | **0** (2 rows matched a broad regex — `smtp_settings`, `seo_pages` — but only on the word "password"; **zero** contain `postgres://` or the DB host) |
| Custom login roles beyond Supabase's managed set | **0** — the single hit, `supabase_functions_admin`, is a Supabase-managed role, not a user-created one |

### What a database-password reset does NOT touch (architecture, stated precisely)
- **API keys** (anon/publishable and service_role) are JWTs signed with the project's JWT
  secret — a different credential entirely. A DB-password reset does not rotate them, so
  the website, the Android app and every edge function keep working.
- **Vault secrets** (`edge_cron_secret`, `edge_scheduled_posts_secret`,
  `edge_service_role_key`, `test_agent_ingest_token`) live *inside* the database and are
  unaffected by the role's password.
- **pg_cron** executes in-database; **Auth/Storage/Realtime** use Supabase-managed internal
  roles.

### The honest limit of this pre-check
Everything above proves nothing *inside* the database or the repository uses the password.
I cannot prove a negative for something entirely outside both — a BI tool, a laptop script,
or a third-party service someone configured by hand. Two facts make that very unlikely:
the password was never stored in the one place built for it (`SUPABASE_DB_URL`), and the
migration path never used it. If such a consumer exists, the symptom would be an external
tool failing to connect — never a member-facing outage.

## VERDICT: **PRE-CHECK GREEN.** Reset is safe to authorize.
Recommended timing note: production is live and members are posting (row counts moved
during this session). The reset does not interrupt the site, but doing it while nobody is
mid-migration is still the cleaner choice — nothing is mid-migration now.

**STOPPED at A1 as instructed. No reset performed. Awaiting authorization for A2.**
