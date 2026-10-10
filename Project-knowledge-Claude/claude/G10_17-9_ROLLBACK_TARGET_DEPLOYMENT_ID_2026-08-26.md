# §17-9 rollback target — Cloudflare Pages deployment ID — VERIFIED 2026-08-26

Read directly from the Cloudflare dashboard in the owner's browser. Read-only: no deployment
was created, rolled back, retried or deleted. Supersedes the "BLOCKED — capability unavailable"
and "NOT YET VERIFIED" entries for this line in every earlier record.

## Target

| Field | Value |
|---|---|
| Commit | `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` |
| Tree | `a0c3f34d724867f0a10fc768f6987e21fd4ddbfa` |
| Subject | `web: environment isolation — remove committed .env, add bundle-isolation guard (#87)` |
| Merged to `main` | 2026-08-21 19:09:18 UTC (2026-08-22 00:39:18 IST) |
| Pages project | `lens-lustre-learn-claude` (account `a7810011a99de537a210130f86306785`) |

## ⚠ There are TWO production deployments of this one commit

| # | Deployment ID | Status | Timestamp (UTC) | Duration | URL |
|---|---|---|---|---|---|
| 1 | `19064989-ebd8-43e9-85d5-51464c31d126` | **success** | `2026-08-21T19:10:45.118075Z` | 1m 25s | https://19064989.lens-lustre-learn-claude.pages.dev |
| 2 | `9c0c1201-41b4-4abf-9b5f-18598b5189d7` | **success** | `2026-08-22T02:16:57.441908Z` | 1m 27s | https://9c0c1201.lens-lustre-learn-claude.pages.dev |

Both `Production`, both branch `main`, both commit `32930e7`, both succeeded.

Deployment 1 fired **1 minute 27 seconds after the merge** — the automatic build. Deployment 2
is a **second build of the same commit roughly 7 hours later**.

## Which one is the §17-9 rollback target

**`9c0c1201-41b4-4abf-9b5f-18598b5189d7`.**

This is a technical fact, not a judgement call: Cloudflare Pages serves the most recent
**successful** Production deployment, so from 2026-08-22 02:16:57 UTC until the next production
deployment this was the artefact serving `50mmretina.com`, `www.50mmretina.com` and
`lens-lustre-learn-claude.pages.dev`. Deployment 1 was superseded seven hours after it was
created and never served again.

Build log for deployment 2, as displayed: initialize 4s · clone repo 3s · build 1m 9s ·
deploy 12s. Build settings, assets, functions, redirects and headers panels are present.

## Open — NEED EVIDENCE

**Why the commit was built twice is not established.** The details page does not label
deployment 2 as a retry, and nothing in the repository explains a second build at
02:16 UTC. Candidates not distinguished by any artefact seen: a manual "Retry deployment", a
Pages settings change (environment variables or build command) that triggered a rebuild, or an
operator-initiated redeploy. Recorded as OPEN rather than guessed. It does not change which
deployment is the target.

## Consequence for §13 rollback procedure

A rollback to this target is two independent actions, and the record should say so:

1. **Cloudflare** — promote deployment `9c0c1201-41b4-4abf-9b5f-18598b5189d7` via
   *Manage deployment → Rollback* on the Pages project. Owner action; not performed.
2. **Database** — the schema at that point is NOT the schema live today. Since that tree,
   production has applied `admin_user_lookup_by_email`, `admin_user_list_pagination` and the
   three `certificate_*` migrations. Rolling the application back to `32930e7` without
   considering those is only safe because every one of them is additive — but
   `admin_search_users_v2`, `admin_list_certificates` (12-column), `certificates.heading` and
   `trg_cleanup_certificate_references` would remain in place, unused by that older bundle.
   That is the expand-then-deploy property working in the rollback direction, and it should be
   stated explicitly in the §10 RC record rather than left implicit.

## §17-9 status

**VERIFIED** — the rollback target is identified by commit, by tree, and now by Cloudflare
deployment ID, with its status, timestamp and duration measured. The line's remaining
dependency (§13 procedure text naming both the Cloudflare and database halves) sits in the §10
RC record, which does not yet exist.
