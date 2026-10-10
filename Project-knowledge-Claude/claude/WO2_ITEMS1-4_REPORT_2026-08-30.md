# WO-2 (revised) items 1–4 — function capture, hashing, lane delta, F-5/F-6, Row 2 control

> ⚠ **CORRECTED 2026-08-30 by F-16 – F-20. Read `FINDINGS_F16-F20_RESPONSE.md` alongside this
> file; where the two differ, that document governs.** Corrections applied below in place: the
> lane comparison is relabelled (it is **not** a B13 15b re-measurement — 15b remains **BLOCKED**),
> the superset/exposure claim is withdrawn, the approximations are replaced with exact counts, the
> reduced-record gap is **closed by re-fetch**, and the shared-module divergence is raised to
> numbered findings **C-1 (HIGH)** and **C-2 (MEDIUM)**.

**Nothing in this report closes a §25 row.** Everything below is compiler-generated measurement,
which under §25.4 cannot close a row no matter how clean it is.

Run 2026-08-30. Step 3 of your four-step instruction completed first and is reported separately in
`WO2_ITEM0_STEP3_FIX_2026-08-30.md`: the `00_README_AND_EVIDENCE_RULES.md` substitution was found
(a `**`/period transposition at byte offset 1898, inside the block-01 range your block hashes
localised), fixed, and re-verified to `bc21ca0f…4cc340` at 16741 bytes — matching your independent
measurement on both fields — after which `10_verify_pack.sh` returned **PASS=30 FAIL=0**.

---

## Standing note — the hard gate (carried into every report, per your instruction)

The hard gate is cleared **for this platform and this run only**. `11_mutation_control.sh` returned
`UNDETECTED=0` with **`NO-OP-HERE=1`** on Linux, which means **M8c has still never executed
anywhere it is a defect.** That is recorded as **BLOCKED — not as coverage.** Windows
re-verification has not been witnessed by this session; the Windows figures in
`BLOCKED_ITEMS_revision6.md` (B3) are AUDITOR-ATTESTED from an earlier round. B4 (symlink
resolution) remains untested on every platform by construction.

## Standing rule — F-11, applied

**NEVER EXECUTE A PACK FILE THAT HAS NOT HASH-VERIFIED AGAINST `MANIFEST.sha256`.** All 25 pack
files hash-verified before anything was executed this run. Nothing in items 1–4 executed a pack
file; the work here is provider reads plus locally-written scripts, which are not pack files and
make no claim to pack provenance.

---

## 1 — Hash construction, defined before capture

`ezbr_sha256` is recorded in every output row **for reference only and is relied on for nothing**:
its preimage is undocumented, so it cannot support a MATCH/DIFFER judgment. Two constructions of my
own are defined instead, both in `WS-HASH-v1_SPEC.md`, both with exact file list, sort order,
separator bytes and encoding stated so an auditor can reproduce them:

- **WS-HASH-v1** — bundle identity. Files sorted by name; per file
  `name || 0x00 || len(utf8 content) as ASCII || 0x00 || utf8 content || 0x0A`; concatenated;
  SHA-256. **Includes file names.**
- **WS-CONTENT-v1** — path-insensitive companion. SHA-256 over the sorted multiset of per-file
  `sha256(utf8 content)` digests, each followed by `0x0A`.

**A defect in my own instrument, found by using it and disclosed rather than absorbed.** The spec as
first written claimed that the same bundle on both lanes would produce the same WS-HASH-v1. That was
too strong and it was wrong: WS-HASH-v1 hashes names, and the two lanes serve identical code under
different path prefixes (`submit-judge-tag/index.ts` vs `functions/submit-judge-tag/index.ts`).
Seven shared slugs showed **identical total byte counts with different WS-HASH-v1** — the exact
F-15 pattern. Rather than note it, I localised it: in all seven the per-file content multiset was
identical and only the prefixes differed. WS-CONTENT-v1 was added so "the code differs" and "the
code moved" can never be reported as the same thing. The spec addendum records the error in full.

## 2 — Capture, and the controls run on it

| | Production `jtdtehuqtinjxropkkcn` | Staging `ztzutckwdhetphwghuzj` |
|---|---|---|
| Functions listed | **71** — matches the expected 71 | **74** — matches the expected 74 |
| Fully captured and hashed | 71 / 71 | 74 / 74 |
| Fetch failures left unresolved | 0 | 0 |
| Non-ASCII file names (sort-order risk) | 0 | 0 |

Neither count deviated, so no stop-and-report condition was triggered on counts.

**The captures were not taken on trust.** Both sweeps were run by subagents, so before any of their
numbers were used every hash was **recomputed independently** from the stored raw JSON: all 145
functions, comparing `ws_hash_v1`, `file_count`, `total_content_bytes`, `version` and `ezbr_sha256`.
**0 mismatches, 0 missing, 0 extra, on both lanes.**

**Provenance control — and an honest account of its coverage.** To rule out a lane mix-up:

| Control | Production | Staging |
|---|---|---|
| `entrypoint_path` carries the correct project ref | **71 correct, 0 wrong, 0 absent** (after the F-19 re-fetch; was 21/0/50 before) | 74 correct, 0 wrong, 0 absent |
| `version` matches that lane's own function list | 71 / 71 | 74 / 74 |
| Capture's `ezbr_sha256` also appears on the other lane | 0 | 0 (the two ezbr sets are fully disjoint) |
| Spot-check of `ezbr_sha256` against values I hold from my own direct `list_edge_functions` call | 5 / 5 exact | — |

**Finding against my own sweep — now CLOSED by re-fetch, not left open (F-19).** 50 of 71
production captures had been written as **reduced records**, so `entrypoint_path` was missing and
the strongest provenance control could not run on them. All **50 were re-fetched verbatim**. The
control now runs on the whole population: **71/71 production captures carry the correct project
ref — 0 wrong, 0 absent.** Every re-fetched bundle's WS-HASH-v1, `version` and `ezbr_sha256` match
the original capture exactly (50/50 on each), so the original measurements were correct and the
defect was in what was *stored*, not what was *measured*; no function was redeployed between
captures. Residual limitation, named: the re-fetch is a 2026-08-30 capture and cannot retroactively
prove what the provider returned during the earlier sweep. Detail in
`FINDINGS_F16-F20_RESPONSE.md`.

## 3 — F-5: the lane delta, named in both directions

Full per-slug table in `LANE_DELTA.tsv`.

### Direction 1 — present on production, absent from staging

**None. Zero functions.** Every one of production's 71 slugs also exists on staging.

### Direction 2 — present on staging, absent from production: **3**

| Slug | Staging version | Files | Bytes | Deployment intent |
|---|---|---|---|---|
| `backfill-media-objects` | 3 | 3 | 36,429 | **UNDETERMINED — owner attestation required** |
| `media-verify-upload` | 3 | 3 | 30,148 | **UNDETERMINED — owner attestation required** |
| `g8-storage-lane-probe` | 14 | 1 | 137 | **UNDETERMINED — owner attestation required** |

**Intent is not measurable and I am not going to infer it.** What the evidence shows and what it
does not:

- `g8-storage-lane-probe` — its name matches the G8 storage-lane work, it is 137 bytes and one file
  (far too small to be a feature), and it is the only one of the three whose version has advanced
  beyond the bulk-deploy baseline (v14 against v3). Those facts are consistent with a
  staging-resident test instrument never intended for production. **That is an inference from a
  name and a size, not a measurement of intent**, and it is recorded as INFERRED, not VERIFIED.
- `backfill-media-objects` and `media-verify-upload` — both sit in the media-migration family
  alongside `media-register-upload`, `migrate-post-media` and `measure-post-media`, which **are**
  deployed on production. Whether these two are pending promotion, deliberately staging-only, or
  abandoned is **not decidable from deployment state**, and nothing here should be read as saying
  which.

> ⚠ **WITHDRAWN — this paragraph previously read that staging is a slug-level superset of
> production and therefore "no production function is at risk of being dropped".** That reasoned
> from slug names to content and was wrong. 50 of the 71 shared slugs differ in content, and in
> **three** — `send-gift-credit`, `analyze-gallery-image`, `detect-ai-image` — **production carries
> behaviour staging lacks**, which a deploy of staging over production would remove. Separately,
> merging PR #104 **deploys no functions at all**; "what promotion would add" describes a future
> deploy, not the merge. See F-17 in `FINDINGS_F16-F20_RESPONSE.md`.

### Shared slugs — 71, three-way classification

> **Designation: LANE-COMPARISON-2026-08-30 — a NEW measurement (F-16).** This compares production
> **deployment** against staging **deployment**. It is **not** the B13 15b re-measurement, which
> compared production against **the repository** at staging @ `702e5ce`. Different populations,
> different question. **B13 15b remains BLOCKED pending repository access** and nothing here may be
> cited toward it.

| Classification | Count | Meaning |
|---|---|---|
| `IDENTICAL-BUNDLE` | **14** | same content, same paths — byte-identical deployment |
| `SAME-CONTENT-DIFFERENT-LAYOUT` | **7** | byte-identical code, relocated path prefix only |
| `CONTENT-DIFFERS` | **50** | the code itself differs between lanes |

`SAME-CONTENT-DIFFERENT-LAYOUT`: `judge-session-resume`, `publish-scheduled-posts`,
`send-broadcast-push`, `submit-judge-comment`, `submit-judge-score`, `submit-judge-tag`,
`translate-text`. Reported as relocations, **not** as code changes — the distinction WS-CONTENT-v1
exists to preserve.

### What actually drives the 50 content differences

Exact figures (F-18): of the 50, **22** diverge **only** in shared modules and **28** also differ in
their own entrypoint code (22 + 28 = 50). Byte-delta mass: the sum of per-slug
|staging − production| bundle bytes is **360,715**, of which **317,966 (88.1%)** is attributable to
`secureHeaders.ts`, `s3.ts` and `laneConfig.ts`, leaving **42,749 (11.9%)** to all other causes.
That is a share of byte-delta mass, not a share of functions. `secureHeaders.ts` is present in **27**
production functions, and **21** functions have a whole-bundle delta of exactly +5,456 bytes.

| Shared module | Production | Staging | Effect |
|---|---|---|---|
| `secureHeaders.ts` | **one** variant, 1,507 bytes, in 27 functions | **one** variant, 6,963 bytes, in 28 functions | 6,963 − 1,507 = **5,456** — the modal per-function delta; **21** functions have exactly this whole-bundle delta |
| `s3.ts` | **four different variants** (7,777 / 9,980 / 7,590 / 9,143 bytes) across 4 functions | **one** variant, 15,400 bytes, in 12 functions | production carries divergent copies of one shared module |
| `laneConfig.ts` | **absent entirely** | 4,909 bytes, in 9 functions | staging-only module |

> ⚠ **RAISED OUT OF PROSE (F-20).** The shared-module divergence is not a sentence in a table —
> it is **FINDING C-1 (HIGH): no single deployed source of truth for shared modules in
> production**, with **FINDING C-2 (MEDIUM)** recording that staging shows 0 of 34 shared modules
> divergent against production's 3 of 34. `s3.ts` has **4** mutually-different deployed variants
> and `imageDims.ts` also **4** (not three — see the correction in F-20); in both, no two functions
> agree. Full census, severity reasoning and bounds: `FINDINGS_F16-F20_RESPONSE.md`.

## 4 — F-6 and Row 2

Both are in `ROW2_AND_ROW6A_EVIDENCE.md`, in the pack's own row template. In summary:

**Row 2 (§1.2 staging policies).** Staging returns **9** — expected. **The negative control was
re-run against the staging ref `ztzutckwdhetphwghuzj`, not inherited from Row 1's production run**:
`WHERE tablename = 'zzz_does_not_exist'` returned zero rows — the stated discriminating result, so
Row 2 is not void. The two staging-only policies are **named**, not counted: `Ad comments follow the
ad's visibility` (RESTRICTIVE, SELECT) and `Banned users cannot comment on ads` (RESTRICTIVE,
INSERT). Production-only policies on that table: none. Production returned **7** — the pre-D-10
value, so §1.1's stop-condition did **not** trigger and nothing is recorded under §21.

Per F-13, the cheaply-testable claim was tested rather than asserted: comparing per-table policy
counts across the whole `public` schema on both lanes, the lanes hold the same 139 tables and
**`ad_creative_comments` is the only table whose count differs.** Stated limit: that control
compares counts, so a same-count rename elsewhere would be invisible to it — name-level equivalence
outside that table is **UNTESTED**, not established.

**Row 6a (§1.6a R2 buckets), restated PARTIAL as F-6 required, and now measured.** Existence:
exactly three buckets, `50mm` (2026-03-07, APAC, Standard), `50mm-staging` (2026-08-21), `agentcrm`
(enumerated only, never opened) — no fourth, none missing. Negative control: a request for a
non-existent bucket returned 404/10006 rather than a default page — discriminating. **Sizes:
BLOCKED**, for two independent reasons — the instrument returns no size field, and §1.6a itself
rules size out as evidence since it is GB-rounded and cannot detect a 0-byte object. Also
**BLOCKED**: `50mm`'s Public-Access flag and the account id, neither of which this instrument
returns, so the listing is not bound by evidence to account `a7810011…306785`.

## 5 — Item 4: manifest

`MANIFEST.sha256` regenerated over every file produced by items 1–4, covering all of them and no
others, in `WO2_OUTPUT/`. Its own coverage check is stated inside it.

## 6 — Track R

Unchanged and correctly not started. The 138-file audit report was requested once, in writing, in an
earlier turn. Not requested again. If the owner confirms it cannot be produced, it will be recorded
as **BLOCKED with the owner named** — that confirmation has not been given either way, so it is not
recorded as blocked yet.
