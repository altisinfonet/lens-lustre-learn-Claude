# OPTION 2 — minimal replacement RC · **PATCHES PREPARED, NOT APPLIED**

**Nothing here has been applied.** No branch, no commit, no push, no merge, no tag. The RC worktree
is unmodified; each patch was produced by copying the file to `/tmp`, editing the copy, and
`diff -u`-ing against the original. **Nothing in this folder closes a §25 row.**

## C1 · File list — **three files, not four**

| # | File | Item | In merge scope |
|---|---|---|---|
| 1 | `.github/workflows/apply-migration.yml` | Track R item 1 | **YES** |
| 2 | `.github/workflows/verify-schema-dependencies.yml` | Track R item 2 | **YES** |
| 3 | `functions/_seo.ts` | Track R item 5 | **YES** |

**`cloudflare/seo-edge-injector/worker.js` is EXCLUDED — B1 is negative.** It is **not** among the
138 files in `main…a42b209e`, and it **does not carry the construct**: line 139 already reads
`JSON.stringify(obj).replace(/</g, "\\u003c")` with the comment *"Safe JSON: HTMLRewriter inserts as
raw, so escape `</script`"*. It is the **negative control** for item 5, not a fourth file.

## C2 · The patches

`01-apply-migration.yml.patch` · `02-verify-schema-dependencies.yml.patch` ·
`03-functions-_seo.ts.patch`. Unified diffs against `a42b209e`. **Apply with review, not blindly.**

## C3 · What each change does **NOT** fix — the residue, before the owner rules

**Patch 1 — `apply-migration.yml`.** Fixes: the four `${{ inputs.* }}` shell interpolations move to
`env:`; `--single-transaction` is added; the host is parsed for validation.
**Does NOT fix:**
- The header still documents the **session/direct** URI (`postgres:<pw>@db.<ref>…:5432`) while the
  ref gate parses `postgres.<ref>` and refuses it. **The patch adds `HOST` parsing but does not
  reconcile the documented setup value** — a separate wording decision the owner must make, because
  changing it changes what secret the owner is told to store.
- `--single-transaction` makes *this workflow* atomic; it does **not** make the **327 of 635**
  migration files that lack their own `BEGIN` individually safe if run another way.
- It does not remove the workflow's fundamental property: a job holding the production DB URL,
  dispatchable by anyone with write access to `main`.

**Patch 2 — `verify-schema-dependencies.yml`.** Fixes: `source_dir` via `env:`, plus an allowlist.
**Does NOT fix:** the same **username-only credential-target parse** as patch 1's gate — this patch
does not touch the credential gate at lines 75–88, so a URI whose username names the right ref but
whose host points elsewhere still passes there.

**Patch 3 — `functions/_seo.ts`.** Fixes: `<` escaped at the single serialisation point, covering
**all** fields on **all five** producers at once.
**Does NOT fix — read this before treating it as closure:**
- **It changes the merge, not production.** `_seo.ts` is edge/Pages code; a replacement RC changes
  what is *merged*, not what is *serving*. **If the path is live and offending data already exists,
  this ships a fix while the exposure continues** until a separate deploy.
- **Whether any live row already contains a `</script/` payload is UNREAD.** Answering it means
  reading `journal_articles.title`, `courses.title`, `journal_articles.tags`,
  `featured_artists.artist_name` and `site_settings.managed_pages[].json_ld` on production. Not
  done, deliberately.
- It does not change the CSP. `public/_headers:14` still carries `script-src 'self' 'unsafe-inline'`,
  so any *other* inline-injection path remains executable.
- It does not fix `stripHtml`, which remains a tag-stripper that three producers still call for
  `description`. After this patch that no longer matters for jsonLd, but `stripHtml` is **not** an
  escape anywhere else it is used.

**None of the three patches touches Track R items 3, 4, 8, 9, 10** — those are edge-function code,
excluded from this release by **B13 condition 2**, and including them would enlarge the RC without
reducing merge risk. **They remain open**, and items 3 and 4 are hard preconditions on any future
deploy (see below).

## C4 · Which of the 9 release gates a replacement RC resets, and which survive

A new RC changes the last non-`docs/` commit, so everything anchored to `a42b209e` re-bases.

| Gate | Effect of a replacement RC | Why |
|---|---|---|
| §3 identity (code RC SHA, tree) | **RESETS** | `a42b209e` is no longer the last non-docs commit |
| §3.2 / §5.0 scope counts | **RESETS** | files-changed, ±lines and commit counts all move |
| §25 evidence rows measured against `main…a42b209e` | **RESETS** | every row re-bases to the new endpoint |
| PR #104 title and body | **RESETS** | they state the frozen RC and the counts |
| §11 owner signature | **RESETS** | signed against an RC that no longer exists |
| CI on the exact head | **RESETS** | 17 checks re-fire against the new head |
| **§25.3 infrastructure rows 1.1 / 1.2 / 1.6a** | **SURVIVE** | provider state, not repository state — measured against project refs and the R2 account, not against any commit |
| **B13 15a (capture + hash of 71 production functions)** | **SURVIVES** | a deployment-state measurement; independent of the RC |
| **C-14-L, C-3/C-4 CORS census, LANE-COMPARISON-2026-08-30** | **SURVIVE** | deployed-source measurements; independent of the RC |

**Survives but must be re-run:** the **drift measurement (B13 15b)** — it is defined *against the
RC*, so a new RC requires a new run. The instrument, the protocol and the harness all survive; only
the numbers move.

**Also unaffected:** the Track R reconciliation's **repo-source** findings remain true of
`a42b209e`, but three of them (items 1, 2, 5) are what the replacement RC *fixes*, so their status
would change from CONFIRMED-open to CONFIRMED-repaired **in the new RC only**.

## Standing

**Prepared only.** No branch, no commit, no push, no merge, no tag, no deploy, no migration, no
§5.3 probe, no provider write, no ledger edit, no guard install. No secret value was read.
