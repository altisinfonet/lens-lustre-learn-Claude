# v3 — the five required fixes, and the tests that prove each one

Every row names the test IDs in `test_ledger_guard.sh`. All 66 assertions passed on this host
(`TRANSCRIPT_selftest_linux.txt`).

## FIX 1 — a 32-hex value in a field typed commit/tree must FAIL

v2 downgraded it to WARN on the theory that it "looks like an md5 or a token id". That reasoning
was backwards: the *field* declares the type, so a value that is not a Git object of that type is
wrong, whatever it resembles. Fields that legitimately hold non-Git identifiers (Cloudflare
account id, token ids) are now declared `opaque` in `CANONICAL_FIELDS` and are not type-checked
at all.

| Test | Assertion |
|---|---|
| `V1-P` | 32-hex in `Merge base` (typed commit) → **LG-03 FAIL = 1** |
| `V1-P2` | the message says "typed commit", i.e. it names the reason |
| `V1-N` | 32-hex in `Cloudflare account id` (typed `opaque`) → **FAIL = 0** |

## FIX 2 — void identity compared across full and abbreviated SHAs; ambiguity is BLOCKED

v2 compared SHA *strings*. A void full SHA reused as an 8-char abbreviation slipped through.
LG-04 now resolves both sides to a full object id before comparing.

| Test | Assertion |
|---|---|
| `V2-P` | full void SHA reused as an abbreviation → **LG-04 FAIL** |
| `V2-P2` | abbreviated void SHA reused in full form → **LG-04 FAIL** |
| `V2-N` | a genuinely different commit → **silent** |
| `V2-A` | an ambiguous abbreviation → **LG-04 FATAL**, never resolved |
| `V2-A2` | the message says "ambiguous abbreviation" |
| `V2-A3` | the run exits **3** (BLOCKED), not 0 and not 1 |

*Scope note:* `V2-A` is exercised through the attested fact source, not a live repo. The guard
only reads 7–40 hex as a SHA, and two real Git objects sharing a 7-hex prefix cannot be
synthesised cheaply (a 2^28 birthday search). The ambiguity *path* is identical for both fact
sources — `GitFacts.resolve()` raises the same `Ambiguous` exception on git's own
"short SHA1 … is ambiguous" — but the live-git branch of that path is **SPECIFIED, NOT EXECUTED**.

## FIX 3 — `ls-remote` failure is not an empty result

v2 returned `[]` both when the remote had no tags and when the command failed. A ledger claiming
"zero tags exist" was therefore *confirmed* by an unreachable origin. `tags_remote()` now returns
`(list, ok)`.

| Test | Assertion |
|---|---|
| `V3-N` | origin reachable → no FATAL |
| `V3-P` | origin URL points at a nonexistent repo → **LG-09 FATAL** |
| `V3-P2` | the text says "BLOCKED, not confirmed" |
| `V3-P3` | exit **3** |
| `V3-P4` | the report does **not** contain "no-tags claim confirmed" |
| `V3-N2` | restoring origin clears the FATAL (proves the test is not stuck) |

## FIX 4 — endpoint and basis inheritance reset at every Markdown table boundary

v2 inherited within a *section*. Two tables in one section could therefore hand a scope endpoint,
or a measurement basis, to a table that never declared one. Rows now carry a `table` id; any
non-table line closes the table.

| Test | Assertion |
|---|---|
| `V4-N` | one table: the second row inherits the endpoint → no "declares no endpoint pair" |
| `V4-N2` | one table: a row whose basis cell says `same` inherits → **LG-07 FAIL = 0** |
| `V4-P` | a sentence between the tables → the endpoint is **not** inherited → WARN raised |
| `V4-P2` | same split → the basis is **not** inherited → **LG-07 FAIL = 1** |

The `joined`/`split` fixtures differ by exactly one line — a sentence between the two tables —
so the pair isolates the boundary and nothing else.

## FIX 5 — attested SHA matching

A short input is accepted only as an **unambiguous prefix of a known full SHA**. A longer value is
never accepted merely because a known short entry prefixes it. `facts_rev16.json` now keeps full
SHAs in `known_commits` / `known_trees`; the 38 commit and 1 tree abbreviations whose full form
was not read are attested separately in `*_abbrev_only` and produce a **WARN**
("attested only as an abbreviation, typed check not possible") — never a pass, never a FAIL.

| Test | Assertion |
|---|---|
| `V5-N` | unambiguous 8-char prefix of a known full SHA → accepted |
| `V5-N2` | the full SHA itself → accepted |
| `V5-P` | `deadbeef1234` where only `deadbee` is attested → **FAIL** |
| `V5-W` | `deadbee` (short-only attestation) → **WARN** |
| `V5-W2` | …and not a FAIL |
| `V5-A` | 7-char prefix shared by two known full SHAs → **FATAL** |
| `V5-A2` | the ambiguous case is not also counted as FAIL |
| `V5-A3`/`V5-A4` | an 8-char prefix that resolves to exactly one of them → accepted |

## Two defects found *during* v3 and fixed here

1. **`| tee report.txt || true`** — I wrote this into the workflow to stop `set -e` aborting the
   step. `|| true` overwrites `PIPESTATUS`, so every failure would have read as 0 — the exact
   v1 defect, reintroduced. The step now drops `set -e` instead. Test `C10` proves the bug;
   `C11`–`C14` prove the v3 shape, including that exit **3** survives the pipe.
2. **`FATAL=` in the summary line** broke the self-test's own `^FAIL=` extractor, so the
   baseline assertion `N0` was silently failing. Fixed, and the extractor no longer anchors.
