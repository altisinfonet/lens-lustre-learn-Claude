# PRODUCTION SCHEMA FINGERPRINT — baseline for staging equivalence
Captured 2026-08-21 from `jtdtehuqtinjxropkkcn`, READ-ONLY (catalog reads only).
Purpose: after the authoritative dump is applied to staging (`ztzutckwdhetphwghuzj`),
re-run the identical query there and compare. Divergence = gate failure, not a shrug.

| metric | production |
|---|---|
| tables (public) | **146** |
| views / matviews | 10 / 1 |
| sequences | 3 |
| indexes | 437 |
| functions | **381** (of which SECURITY DEFINER: **323**) |
| policies (all schemas) | **730** |
| triggers (public, non-internal) | 148 |
| constraints (public) | 381 |
| enum types | 2 |
| RLS-enabled tables | **146 / 146** |
| total columns (public) | **1482** |
| installed extensions | 10 |
| **table_shape_md5** (relname:column-count over all tables) | `f1dab01aaba7b1b06ce325358f5e5d56` |
| **function_signature_md5** (name+identity args over all functions) | `04f420a6fb0e4893651e8cf6639dd934` |

The two md5s are the strong checks: they are digests over sorted sets (per the project's
G8 rule — "counts are never set equality; digests over sorted sets are"). Matching counts
with a mismatched digest means the right NUMBER of wrong things.

## Extensions that a fresh Supabase project does NOT get by default
Installed in production: `pg_stat_statements`, `pg_cron` (pg_catalog), `pg_trgm`,
`pgcrypto`, `pg_net`, `pgmq` (own schema), `plpgsql`, `uuid-ossp`, `supabase_vault`,
**`plpgsql_check` (installed into `public`)**.
A `supabase db dump` of `public` will not necessarily re-create `pg_cron`, `pg_net`,
`pgmq`, `pg_trgm` or `plpgsql_check` on the staging project — these must be verified
present (and created if absent) before the dump applies cleanly, since functions and
defaults may reference them.

## Not carried by any schema-only dump — explicit carry-forward list
1. **pg_cron scheduled jobs** live as ROWS in `cron.job`. Production schedules real work
   (email queue, boosts, gift expiry, judging invariants, etc. per the edge-function set).
   Staging will have none. Decide per job: recreate in staging, or deliberately omit
   (recommended: omit the outbound ones — email/push — so staging can never message a
   real member; recreate only what a test needs).
2. **`site_settings` rows** — including `s3_storage_settings.public_url`, which is what
   points the app at a media host. Staging must get its OWN row pointing at the staging
   bucket/CDN. This is configuration data, not member data: it must be authored fresh for
   staging, never copied wholesale (the production row names the production bucket).
3. **Auth users / sessions / member rows / photographs** — never copied. Synthetic only.
4. **Vault secrets** (`supabase_vault`) — staging gets its own; production values are
   never read or transferred.
