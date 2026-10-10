# P30 — Session B forensic re-check, 2026-09-21

**Unit:** P30 · Phase 1 · D1 · **Session:** SESSION B — Phase-1 gate closure / durability owner
**Purpose:** re-verify P30 from the live system before relying on any prior document, per
`CLAUDE.md` §2 and the task's own "do not create duplicate fixes if the implementation is already
correct" instruction. **No code, SQL, or migration was changed for P30 this session** — this
document only records what was checked and confirms nothing was missing.

## 1 · The gate, verbatim

> **P30** — `email_exists` removed from the `anon` role; signup and password-reset responses are
> identical whether or not the address is registered.

## 2 · What was re-checked, and against what

| clause | instrument | result |
|---|---|---|
| `email_exists` removed from anon | live read, staging `fpszggreishhuvdpkmdr`, 2026-09-21: `has_function_privilege('anon', oid, 'EXECUTE')` | **false** — closed. Durable: `supabase/migrations/20260910_0001_p30_email_exists_revoke.sql` (+ `0004` for the authenticated-scope OI-2 follow-up) |
| PUBLIC grant (F-62 shape) | same read | `proacl` has 0 PUBLIC entries — the OI-3-shaped fix was applied to `email_exists` too |
| Client — honeypot/time-trap, `email_exists` call removed | `src/pages/__tests__/forgotPasswordHoneypot.test.tsx` exists in the repo (`staging`, this branch) | present |
| Production — honeypot live, unregistered-address response, Turnstile enforced | `claude/2026-09-19-INTERIM-PROMOTION-honeypot-LIVE-on-production.md` (this Project): PR #253 squash-merged to `main` at `2d5a815`, verified live on `www.50mmretina.com` 2026-09-19 — honeypot PASS, time-trap PASS, unregistered-address response PASS (single `POST /auth/v1/recover`, no `email_exists` RPC), Turnstile positive control PASS, DB grants re-verified on production (`email_exists` anon_exec=false, `search_certificates` anon_exec=false on `jtdtehuqtinjxropkkcn`) | 6 of 8 production checks PASS; 2 (registered-address live send, Turnstile negative control) are Owner-runnable one-liners, not yet run as of that record — this session did not re-run them (no production access from this session; see §3) |
| Current `main` HEAD carries the honeypot code | `git log --oneline -1 origin/main` = `96c9d91` ("Promotion: main ← staging Rule 20 governance reconciliation"), 3 commits ahead of the `2d5a815` promotion that landed the honeypot; `git show origin/main:src/pages/ForgotPassword.tsx \| grep company_fax` — present | confirmed still present on current `main` |

## 3 · What this session could not re-verify

This session's Supabase MCP connector reaches staging (`fpszggreishhuvdpkmdr`) only — production
(`jtdtehuqtinjxropkkcn`) is not visible (`list_projects` returns exactly one project), matching
`claude/media-delta-health-log.md`'s standing description of the same scope limit. Production
claims in §2 are therefore carried from the 2026-09-19 record, not re-measured live by this
session, and are cited as such rather than re-asserted as this session's own reading.

## 4 · Conclusion

**No duplicate fix created.** P30's database half and client half are both durably committed and
already promoted to `main`/production per the cited 2026-09-19 record. The two remaining
production checks (registered-address live send, Turnstile negative control) are cheap,
Owner-runnable, and unrelated to this session's D1 lane — recorded here as still open rather than
silently dropped, not acted on.
