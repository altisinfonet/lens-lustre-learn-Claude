# Certificates + admin user pagination — SHIPPED TO PRODUCTION
**2026-08-25 · `main` = `b671e1f` · PR #101 · deploy verified live**

---

## What shipped

A **cherry-picked** PR, not a branch merge. `staging → main` would have shipped 111 files / 21 commits, 96 of them belonging to the lane-isolation / SEO / CORS / storage / email workstream. PR #101 carries **15 files and nothing else**.

| Check | Result |
|---|---|
| Files changed on `main` vs previous `main` (`6ebe6c3`) | **15, no extras** |
| Every blob on `main` vs the same path on `staging` | **byte-identical, all 15** |
| CI | **6/6 green** — Web build, Security (3), Typecheck, UI gate |
| Local gate before upload | typecheck clean · **2,345 tests passed, 1 skipped, 0 failed** |
| Diff size | +2,892 / −304 |

## Database — applied first, verified against staging

Applied to production **before** the code, so there was never a window where the code called something that did not exist. Every object md5-compared to staging's copy of the same object; all eight identical.

| Object | production = staging |
|---|---|
| `certificates.heading` (table now 18 columns; full column/type/nullability md5 matches staging) | ✅ |
| CHECK `certificates_type_check` — 16 types, adding `achievement` + `custom` | ✅ |
| CHECK `certificates_heading_only_for_custom` | ✅ |
| `admin_list_certificates` (returns `heading`, `total_count`) | ✅ |
| `admin_search_certificate_recipients` | ✅ |
| `cleanup_certificate_references()` | ✅ |
| trigger `trg_cleanup_certificate_references` | ✅ |
| index `idx_certificates_issued_at_id_desc` | ✅ |

`admin_search_users_v2` was already in production from #97 — its `pg_get_functiondef` md5 matches staging exactly, so the merged `AdminUsers.tsx` is talking to the function it was written against. Grants checked on every new function: `authenticated` only; **`anon` has none**.

Also verified present in production before merge, because the merged code calls them: `get_my_certificate_entries`, `profiles.last_active_at`, `profiles.last_platform`, `competition_round_publish.{competition_id,round_number,published_at}`, `app_role` enum values, and the `site_settings` rows `certificate_logo` and `certificate_signature` — both pointing at `https://cdn.50mmretina.com/...`, which production's CSP `img-src` already allows, so the logo and signature render.

## Deploy verified live, not assumed

Read out of the running production bundle at `www.50mmretina.com`:

```
/assets/generateCertificatePdf-d2bx4PUh.js
  canvas surface present (certificateCanvas / toPngDataUrl / PT_TO_MM) ... true   <- new in #98
  heading support ................................................... true
  "OF ACHIEVEMENT" .................................................. true

/assets/Certificates-DG6IraL2.js
  "Your Certificate" / "Download Certificate" ....................... true   <- new in #98/#99
```

The canvas adapter did not exist before this release, so its presence is proof the new code is serving — not an inference from a green deploy badge.

## ⚠ One thing I got wrong

**I did not bump the build marker.** `src/main.tsx` still reads `__APP_BUILD = "2026-08-20-2"`, confirmed live in the browser.

The marker's own comment states the rule: bump on *every* release that changes what the client sends to the database. This release does exactly that — new `heading` in inserts and updates, two new RPCs, two new type values. Nothing is broken by the omission (Vite rehashed the changed chunks, so caching is fine), but the diagnostic is blunted: if a member reports odd certificate behaviour, the marker will read `2026-08-20-2` and cannot distinguish "running the new bundle" from "running a stale one". That is precisely the ambiguity the marker exists to remove, and it is the failure this repo already got burned by on 2026-08-20.

**Fix: a one-line follow-up PR setting the marker to `2026-08-25-1`.** Not shipped — flagged for the owner's go.

## Not done in this release

- **The 23 test certificates are still in production.** A backup was taken (`PRODUCTION_CERTIFICATES_BACKUP_2026-08-25.json` — 23 certificates, 11 notifications, 12 audit rows) and a purge script written (`PRODUCTION_CERTIFICATE_PURGE.sql`). The purge must be run by the owner: this environment refuses mass deletes against production. The script also clears `db_audit_logs`, because the `audit_certificates` trigger writes a full JSON copy of every deleted row — a plain `DELETE` would leave 35 copies behind rather than none.
- **The 96-file lane-isolation workstream on `staging`** — untouched, needs its own review. The one thing to read before it ships is the production Cloudflare Pages **build command**: `public/_headers` is now a template with `__CDN_HOST__` placeholders filled by `scripts/generate-headers.mjs`. Generated output was proved byte-identical to what main serves today, but only if the build command invokes `package.json`'s `build` script.
- **Excellence Featured / Testimonials** — 8 bugs analysed in `EXCELLENCE_TESTIMONIALS_ANALYSIS_2026-08-25.md`, deferred by the owner.

## What to test in the live admin panel

1. Issue a certificate of each type — especially `achievement` and `custom`, the two that never worked
2. Custom: blank heading → prints *OF ACHIEVEMENT*; typed heading → prints that
3. Live preview while typing title / description / heading
4. Delete, Revoke, Restore — all three (the confirm dialog was broken once and fixed)
5. Delete a certificate → the member's notification disappears with it
6. Recipient search by name and by email
7. Certificate list past page 1
8. Admin → Users: paging, role filter, badge filter, search
9. Member side: `/certificates` → view and download → logo and signature both present
