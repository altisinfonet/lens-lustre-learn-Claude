# Which pack revision is current — and the ambiguity, named

Date: 2026-08-31 · **Nothing here closes a §25 row (§25.4).**

---

## 1. THE ANSWER

> **The current revision is `rev18`.** It supersedes rev17, rev16 and everything before it.
> *(rev17 was sealed and then superseded before delivery — see §4. It was never quoted as current.)*
> Its measured identity is in §4. **Quote no earlier revision as current.**

## 2. The ambiguity was a units collision, not two revisions in circulation

Your report and the auditor's are **both correct** and describe **different quantities**:

| revision | files on disk | manifest entries | round-trip verified | archive sha256 |
|---|---|---|---|---|
| **rev15** | **152** | **151** | 151/151 | `3cde5c96a30a9826f212d1f045cd406bb2998094394929b2126b42ccc434cb8a` |
| **rev16** | **153** | **152** | **152/152** | `a3563e9826f34e00510e7bab1e8de8c43491fd58475a9217d5ec075924affd86` |

- **"rev15 — 152 files, manifest 151"** — my report. Files **on disk**.
- **"rev16's own manifest (152/152)"** — the auditor. Manifest **entries verified**.

**The number 152 means "files on disk" in the first and "manifest entries" in the second, one
revision apart.** Nothing was wrong in either statement, and no two revisions were circulating under
one description. **The lesson is the reporting format, not the packs:** a bare count is ambiguous
across two quantities that differ by exactly one, forever, by construction — because the manifest
always covers every file except itself.

**Fixed from here:** every revision is now stated as **`<files on disk> / <manifest entries> /
<round-trip verified>`**, three numbers, never one.

## 3. The near-miss I have to report, because it is the real version of the risk you named

**Within revision 16 I built two distinct archives.**

| build | bytes | sha256 | fate |
|---|---|---|---|
| rev16, first build | 1,426,205 | `86bddf705e443b7006fcbf8735b27ebce8422120095bf140e7ccfc7a1e26c348` | **superseded before delivery** |
| rev16, second build | 1,426,352 | `a3563e9826f34e00510e7bab1e8de8c43491fd58475a9217d5ec075924affd86` | **the one delivered and reported** |

The second build exists because I wrote the real close stamp into the negatives register after the
first. **Only the second was ever delivered or quoted**, and the first no longer exists on disk — so
nothing false circulated. **But that was luck of ordering, not a control.** Two byte-sequences held
the same revision number for about four minutes.

> **F-42 — a revision number must identify exactly one byte-sequence, permanently.** If a pack needs
> a change after its manifest is sealed, it gets the **next** number. Rebuilding under the same
> number is the same defect class as F-39 (one correction, two stores) with the stores collapsed
> into one name. **This is why the current build is not rev16 again — and why the §4 correction produced rev18 rather than a second rev17.**

## 4. Where the current archive's identity lives — and why it cannot live here

**An archive cannot contain its own sha256.** Writing it into a file inside the pack changes the
pack, which changes the hash, which invalidates what was written. So the archive's measured identity
is reported **outside** the pack, in exactly two places, and both are quoted together every time:

1. **the delivery message** that accompanies the archive, and
2. **the project document** `claude/REVISION_STATEMENT_2026-08-31.md`.

**What lives inside the pack is everything that *can*:** the manifest header carries the revision
number, the three counts (`files on disk / manifest entries / round-trip`), and the build timestamp.
The archive hash and byte size are the delivery's job.

> **This section is itself an F-42 demonstration.** Its first draft promised the archive's identity
> "in §5 of this file", which is self-referentially impossible. Correcting it changed a sealed pack —
> so under the rule I had just written, the corrected pack took the **next** number rather than
> rebuilding under the old one. **rev17 was built, sealed, and never delivered or quoted; rev18 is
> what ships.** The rule cost one rebuild and caught one wrong sentence, which is what it is for.

## 5. What changed between rev16 and rev18

| added | |
|---|---|
| `22_RULINGS_EXPORT/` | **24 ruling and record documents exported from the claude.ai project as files**, so the auditor can audit the reasoning and not only the conclusions. Verbatim copies; per-file sha256 in that folder's `EXPORT_MANIFEST.md` |
| `23_TESTSUITE_RERUN/` | **The independent test-suite re-run**, bound to head `9384ba9`: full transcript (587,432 B), credential-scrub proof, `npm ci` output, per-test output, exit code **0** |
| `24_A15_CLAIMS/` | **The 138-file claims document** — asked for by the auditor, built as claims not an index |
| `25_REVISION_STATEMENT/` | this file |

**rev17 → rev18** changed **only** §4 of this file, plus `MANIFEST.sha256` by construction.

**Nothing was removed. No earlier file changed content** except `00_INDEX.md`, `RESUME_HERE.md` and
`MANIFEST.sha256`, which every revision changes by construction.
