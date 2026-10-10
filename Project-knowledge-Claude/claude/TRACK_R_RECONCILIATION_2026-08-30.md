# TRACK R — reconciliation of the auditor's 16 findings

**RC inspected: `a42b209e4f70a6efed4f3dcdb654e0f994416594`** (worktree HEAD verified against that SHA
before every read). **Nothing here closes a §25 row.** No repository, ledger or provider change was
made. **This is an analysis. No repair was started.**

"Merge scope" = the 138 files in `main…a42b209e`; *in scope* means the file changed in that range.

## Summary

| # | Verdict | Evidence class | Merge? | Deploy only? | Sec | Data | Ruling | Disp |
|---|---|---|---|---|---|---|---|---|
| 1 | **CONFIRMED** (4/4 sub-claims) | REPO-SOURCE | **YES** | no | **HIGH** | **HIGH** | none | **A** |
| 2 | **CONFIRMED** | REPO-SOURCE | **YES** | no | **HIGH** | MED | none | **A** |
| 3 | **CONFIRMED — release-introduced** | REPO-SOURCE | no | **YES** | none | **HIGH** | B13 c2 | **C** |
| 4 | **CONFIRMED — release-introduced** | REPO-SOURCE | no | **YES** | none | MED | B13 c2 | **C** |
| 5 | **CONFIRMED** (both halves) | REPO-SOURCE | **YES** | no | **HIGH** | none | none | **A** |
| 6 | **PARTLY CONFIRMED + BLOCKED** | REPO-SOURCE / BLOCKED | **YES** | no | MED | MED | none | **B** |
| 7 | **PARTLY CONFIRMED + BLOCKED** | REPO-SOURCE / BLOCKED | **YES** | no | MED | none | none | **B** |
| 8 | **CONFIRMED** | REPO-SOURCE | no | **YES** | none | **HIGH** | B13 c2 | **C** |
| 9 | **CONFIRMED** (repo) | REPO-SOURCE | no | **YES** | MED | **HIGH** | B13 c2 | **C** |
| 10 | **CONFIRMED** | REPO-SOURCE | no | **YES** | none | MED | B13 c2 | **C** |
| 11 | **CONFIRMED** | REPO-SOURCE | **YES** | no | none | none | none | **D** |
| 12 | **CONFIRMED** | REPO-SOURCE | **YES** | no | none | none | none | **D** |
| 13 | **CONFIRMED — release-introduced** | REPO-SOURCE | **YES** | no | none | none | none | **D** |
| 14 | **CONFIRMED** | REPO-SOURCE | **YES** | no | LOW | LOW | none | **D** |
| 15 | **NOT REPRODUCED** | REPO-SOURCE | n/a | n/a | — | — | — | **E** |
| 16 | **PARTLY CONFIRMED + BLOCKED** | REPO-SOURCE / BLOCKED | **YES** | no | — | — | none | **B** |

Dispositions: **A** pre-merge blocker requiring replacement RC · **B** pre-merge evidence/test
repair only · **C** post-merge obligation covered by a ruling · **D** unrelated or deferred ·
**E** false positive.

## Per item

**1 · `apply-migration.yml` — CONFIRMED, all four sub-claims.** Injection at lines **174, 175, 207,
231** (`FILE='${{ inputs.migration }}'` etc.); path validation at 184–197 runs *after* and cannot
mitigate. *Negative control:* `target` is `type: choice` (61–64) and is **not** injectable — the
defect is specific to the two free-text inputs. *Destination validation:* line 141 parses the ref
from the **username only**; the **host is never checked**. *Direct/session URI:* header lines 29–33
instruct the owner to use the session string; measured, it parses to `postgres` and is **refused** —
the file's setup instruction cannot satisfy its own gate. *Atomicity:* `--single-transaction`
**0 occurrences**; **308 of 635** migration files contain `BEGIN`, so 327 do not self-wrap.
**Merge arms it:** the lane gate (100–114) requires `main` for a production dispatch, so merging is
what makes the injectable workflow dispatchable against production. *Repair (not implemented):*
inputs via `env:`, `--single-transaction`, validate host, correct the header URI.

**2 · `verify-schema-dependencies.yml` — CONFIRMED.** Line **108**
`node scripts/verify-schema-dependencies.mjs '${{ inputs.source_dir }}'`; `source_dir` declared
41–45 as `type: string`, default `"src"`. *Negative control:* `target` is `type: choice` (37–40).
Credential gate 75–88 carries the same username-only weakness. *Repair:* same `env:` pattern;
constrain `source_dir`.

**3 · `migrate-post-media` / `CDN_HOST` — CONFIRMED, release-introduced.** `index.ts:47` imports
`CDN_HOST` from `_shared/manifestPlan.ts`; that file has **0** occurrences and exports
`cdnHostFor()` (line 74). The range **removed** the export
(`-export const CDN_HOST = "cdn.50mmretina.com";`) while the consumer is unchanged. *Negative
control:* every other named import in the same statement resolves — the absence is specific.
*Repro:* `deno check` — **BLOCKED, no Deno runtime**; evidence is static.

**4 · `seo-crawler-verify` / `siteOrigin` — CONFIRMED, release-introduced.** `index.ts:17` calls
`siteOrigin()`; the file has **zero import statements** and **0** local definitions. Both lines are
`+` additions in the range, with no import added.

**5 · `functions/_seo.ts` jsonLd — CONFIRMED, both halves, severity raised.** Lines 117–118 emit
`JSON.stringify(meta.jsonLd)` raw into a `<script>`; `public/_headers:14` sets
`script-src 'self' 'unsafe-inline'`. *Negative control — decisive:*
`cloudflare/seo-edge-injector/worker.js:139` performs **the identical job and escapes it**
(`JSON.stringify(obj).replace(/</g,"\\u003c")`, with the comment "Safe JSON: HTMLRewriter inserts as
raw, so escape `</script`"). The correct pattern already exists in this codebase and was not applied
here. **`stripHtml` is NOT an escape** (WO-8 B2): it is `.replace(/<[^>]*>/g," ")`, a tag remover; a
payload with no closing `>` — e.g. `</script/` — survives it and survives `JSON.stringify`, measured.
So **every** field reaching `meta.jsonLd` on **all five** producers is unescaped. *Writers, measured:*
admin (and `content_editor` on `courses`/`journal_articles`); RLS enabled on all five tables;
**service-role bypass = 0** write paths reach the fields. **`content_editor` holders = 0.**

**6 · Lane variables — PARTLY CONFIRMED + BLOCKED.** Confirmed: `scripts/lane-config.mjs`
`laneValue()` returns `productionDefault` when the variable is **unset**. *Negative control:* an
**empty** value throws — the silent path is specifically the unset case. **BLOCKED:** whether a build
succeeds with an unresolved `%VITE_SITE_ORIGIN%` in `dist/index.html`. `generate-headers.mjs:88` and
`generate-seo-assets.mjs:92` guard leftovers; **no** guard covers `index.html` and no substitution
was found in `vite.config.ts`. Deciding it requires **running a build** — not available.

**7 · `PrivacyGapNotice` — PARTLY CONFIRMED + BLOCKED.** Confirmed: line 71
`const who = privacy === "private" ? "Only you" : "Only your friends";`. **BLOCKED:** "direct media
URLs remain publicly reachable" needs a runtime fetch and/or the R2 public-access flag, already
BLOCKED at §25.3 row 1.6a. The copy is confirmed; the premise that makes it misleading is **not
established**, so this may not be filed E.

**8 · `submit-judge-decision` — CONFIRMED.** `judge_decisions` upsert **188**; atomic RPC **215**
whose non-23514 failure sets `atomicWrite.ok=false` and is explicitly non-fatal (comment 205–212);
tag mirror **256** returning `ok:true`/200 with `tag_mirror_warning` (287–298); final `ok:true`/**200**
(327–337). *Negative control:* SQLSTATE **23514** is deliberately classed `rewind_refused` — the code
**does** distinguish expected from unexpected failure and returns 200 for both.
**Cross-reference — three findings, one function:** item 8 · **C-4** (deployed local wildcard CORS;
RC calls `getSecureHeaders`) · the step-3 **DRIFT** row for the same slug. The RC corroborates C-4
from the repo side: line 37 imports `getSecureHeaders`, line 76 derives `corsHeaders = corsFor(req)`,
and line 48 comments on the local wildcard it replaced.

**9 · Storage-lane assertion — CONFIRMED in the repo; superseded in significance by C-14-L.**
`_shared/s3.ts` `assertStorageLane` at line 81: the production branch checks bucket equality and
**returns at ~107**, before the endpoint/`public_url` check at ~119, which is reachable only on the
non-production branch. *Negative control:* the staging path **does** check it, and
`src/__tests__/storageLane.test.ts:62` pins that case — the omission is asymmetric and untested.
**C-14-L (DEPLOYED-SOURCE):** `assertStorageLane` appears in **zero of 71** deployed bundles.
Production does not run the early-return; it runs **no lane assertion at all**. `purge-s3-orphans`
and `detect-orphan-files` carry **0** occurrences of `PRODUCTION_BUCKET`, `PRODUCTION_PROJECT_REF`,
"storage lane" or `50mm-staging`. **WO-9 A3 correction:** `purge-s3-orphans` is destructive;
`detect-orphan-files` is **read-only** and is a safety-critical **input** to it.
**WO-8 B3 — value origin:** `getS3Settings()` (deployed line 178) reads `site_settings` where
`key='s3_storage_settings'` — a **database read**, not an environment variable and not a literal.
A wrong value can therefore reach them without a deploy, and no deployed guard checks it. **The
value itself was not read; no secret was handled.**

**10 · `measure-post-media` — CONFIRMED.** Lines 105–106 hard-code
`https://cdn\.50mmretina\.com/…` in `CANDIDATE_PATTERNS`; the lane-derived `cdnHostValue()` (72) is
applied as a re-check **after** parsing (comments 34, 96). On staging, rows on the staging CDN are
filtered out before the lane check → a misleading empty result. *Negative control:* the lane
re-check exists and works — the defect is **ordering**.

**11 · `CommentThread` — CONFIRMED.** Line **438**
`opacity-0 group-hover/comment:opacity-100 transition-opacity`; **0** occurrences of
`focus-within`/`focus-visible` in the file. Keyboard focus does not reveal; touch has no hover.
*Negative control:* the control stays focusable and clickable — a **visibility** defect, not a
functional one.

**12 · `CloudflareEdgeChecklist` — CONFIRMED.** Line 23
`ROUTES = [SITE_APEX_HOST, SITE_HOST].filter(Boolean)`; line 27 `StepKey` has five keys; line 134
hard-codes `{completed}/5 Complete`. On a single-host lane `SITE_APEX_HOST` is empty, four steps
render, and the counter can never exceed 4/5. *Negative control:* the two-host lane reaches 5/5 —
the defect is lane-conditional.

**13 · Ad comment sign-in affordance — CONFIRMED, release-introduced.** The range **removes**
`placeholder={user ? "Add a comment…" : "Sign in to comment"}` from `AdComments.tsx`; the RC keeps
only a toast on attempt (line 138). *Negative control:* the toast survives — a loss of a
**persistent** affordance, not a total loss.

**14 · `health-check.mjs` — CONFIRMED.** Lines 252–259: any non-ok GitHub response pushes a note and
`return`s — **no `fail()`** — so a run reports healthy while CI status was never read. *Negative
control:* when the API responds, red workflows do call `fail()` (~296); only the unreachable case is
silent.

**15 · SVG optimisation / svgo — NOT REPRODUCED.** No file and line, so the searches establishing
absence at this RC: `git grep -il 'svgo' -- . ':(exclude)package-lock.json'` → **5 hits, all
documentation or `bun.lock`**, no script/config/build step;
`grep -rilE 'optimi[sz]e.*svg|svg.*optimi[sz]' scripts/ src/` → **0**; `scripts/` enumerated in full
(18 entries), none performs SVG optimisation. **I looked; the construct is not present.** Not
BLOCKED — the search was possible and was performed. E **for this RC only**, not a judgement on the
auditor's original context.

**16 · Test-suite findings — PARTLY CONFIRMED + BLOCKED. A conflict between two measurements.**

| | This run (A5, re-run 2026-08-30) | Auditor's run |
|---|---|---|
| Platform | Linux 6.18.44-fc-v22 x86_64 | not stated |
| Node / npm / vitest | v22.22.2 / 10.9.7 / **3.2.4** | not stated |
| Checkout | **`9ac4524d703035e6d2debd9e97ab9a0e73de3bc9`** | "exact-RC" |
| Lockfile | sha256 `2c19224ae1dde95988d507d715b7858130dc303ac4a2d9ea0b06d1b352fb7a9f`, unmodified | not stated |
| Ordering | **no seed recorded — not replayable in its own order** | not stated |
| Invocation | `env -i … CI=true` → `npx vitest run --reporter=verbose` after `npm ci` | not stated |
| Result | 179 files (178 passed, 1 skipped) · 2,476 tests · **2,475 passed · 0 failed · 1 BLOCKED** · **exit 0** | CRLF, Windows-portability, full-suite interference failures |

**Provenance correction, carried in (WO-9):** the WO-3 report and C-16 state the suite ran from a
detached checkout at `a42b209e`. **It ran at `9ac4524`** — proven again by A5's own transcript line
`git rev-parse HEAD`. Mitigation stands and is measured: **0** non-docs difference between them, and
the sole differing file (`docs/PROMOTION_LEDGER.md`) is referenced by **0** test files.

**CRLF — the evidence goes against this run.** Exactly **one** tracked file carries CR bytes
(`tools/PUSH-TO-GITHUB.bat`); `core.autocrlf` **unset**; **no `.gitattributes`**. A Windows checkout
with `autocrlf=true` rewrites line endings tree-wide, and a Linux run **cannot** surface that.
**BLOCKED — no second platform.**

**Full-suite interference — BLOCKED.** No ordering seed was recorded, so this run cannot be replayed
in its own order and cannot test for order-dependence.

**Vacuous / source-text-brittle — PARTLY CONFIRMED.**
`src/__tests__/candidatePatternWidening.test.ts:251–252` reads a `docs/` file and asserts
`existsSync(...) === true` — a filesystem assertion, not a behavioural one. And
`src/test/judging-invariants.test.ts` **self-skips** into a green summary; **it is not passed**.
*Scope:* those two examined; **no survey of all 179 files for vacuity.**

**This run is ONE DATA POINT, not the baseline. The suite is not green on the strength of it.**

## Closing

**11 CONFIRMED** (3 of them release-introduced) · **3 PARTLY CONFIRMED + BLOCKED** · **1 NOT
REPRODUCED** · **1 conflict resolved against this session's own run**. No repair started.
**Nothing here closes a §25 row.**
