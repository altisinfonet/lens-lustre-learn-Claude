# WO-2 (revised) item 0, step 3 — root cause found, fixed, re-verified

Nothing in this report closes a §25 row.

## Result up front

`10_verify_pack.sh`: **PASS=30 FAIL=0**. Exact match to your expected number. Not proceeding
on 29/1 — this is the post-fix, re-run number, fresh as of 2026-08-30T02:19:28Z.

## The defect, located and named

Followed your 4-step method in order, against `/home/claude/WS4_PACK/00_README_AND_EVIDENCE_RULES.md`
(the pre-fix, defective reconstruction).

**Step 1 — codepoint census.** Ran your script verbatim. Output matched your authoritative
census on all twelve entries and all four supplementary checks (zero CR, zero tabs, zero
trailing-whitespace lines, file ends with newline) — exactly:

em-dash (—) x49, middle-dot (·) x26, section-sign (§) x24, right-arrow (→) x7, warning (⚠) x4,
checkmark (✅) x3, double-arrow (⇒) x3, cross-mark (❌) x2, red-circle (🔴) x2, greater-eq (≥) x2,
minus-sign (−) x1, ellipsis (…) x1.

This **disproves your own stated prediction** (U+2212 MINUS SIGN or one of the three U+21D2
arrows retyped as a lookalike) — every non-ASCII codepoint count and byte-width matched. The
substitution was plain ASCII, not Unicode. You said the prediction could be wrong; it was.

**Step 2 — block localization.** Ran your 1024-byte block-SHA-256 command. 16 of 17 blocks
matched your authoritative list exactly. One did not:

- Block 01 (bytes 1024–2047): mine `0849cce0f899`, yours `e1ccbe19b296`.

All other blocks (00, 02–16, including the 357-byte final block) matched.

**Step 3 — byte-offset inspection.** Located the discrepancy inside block 01 at offset 1898.
Pulled a fresh, independent `project_read` of `claude/WS4_PACK_SOURCE/00_README_AND_EVIDENCE_RULES.md`
for an unambiguous ground-truth comparison rather than trusting my own prior transcription again.
Direct comparison found:

- Mine (wrong): `...hard stop requiring\n  rotation.** **This has already happened once...`
- Source (correct): `...hard stop requiring\n  rotation**. **This has already happened once...`

A transposition of the closing bold-markdown `**` and the following period — `rotation.**` vs
`rotation**.`. Two ASCII characters swapped, same total byte count. This is exactly the
same-total-width substitution F-15 predicted from the size/hash pattern alone.

**Fix applied.** One `Edit`, swapping the two characters back to the source order.

**Re-verification, post-fix:**

| Check | Result |
|---|---|
| SHA-256 | `bc21ca0f14e7eed6a289072ea59146aded427a7f6c3a981f77d83a650e4cc340` |
| Size | 16741 bytes |
| Match to your independently-measured authoritative values | **exact, both fields** |
| All 17 block hashes | **all match**, including block 01 now `e1ccbe19b296` |
| `10_verify_pack.sh` | **PASS=30 FAIL=0** (fresh run above) |

## F-13 — hypothesis ranking

You're right, and I should have ranked them without being told. I had direct, same-session
evidence — `11_mutation_control.sh`'s earlier 1-byte transcription error — that my own manual
transcription process was a demonstrated source of single-character substitutions. "Manifest
stale" required one line of a 25-line, single-pass, single-command-generated manifest to be
wrong while the other 24 verified: a much less probable failure mode with no supporting evidence
behind it at all. I presented both as open and equally weighted. That was wrong; the evidence
already in hand pointed one way, and I should have said so plainly and led the investigation from
there instead of stopping and asking you to adjudicate between them.

## F-14 — scope, checked this time

Checked directly against the script rather than asserting from category. `10_verify_pack.sh` line
20 is `for md in *.md; do`, followed by a python step that regex-extracts every ``` ```bash ``` ```
fenced block from each `$md` and writes it out for `bash -n`. This loop runs over
`00_README_AND_EVIDENCE_RULES.md` along with every other `.md` file in the pack — confirmed by
running it: the loop iterates the file (silently, since it contributes nothing) and
`grep -c '```bash' 00_README_AND_EVIDENCE_RULES.md` returns 0.

Correct statement, replacing the false one from the last report: **`00_README_AND_EVIDENCE_RULES.md`
is consumed by `10_verify_pack.sh`'s shell-block extraction loop — it is in scope — but it
contains zero ```bash fenced blocks, so it contributes zero assertions to that section.** It is
still checked by the separate manifest-checksum section, which is exactly where its original
defect showed up. "Not executed by anything" was false in the first sense and beside the point in
the second; both prior claims (F-9's category and F-14's scope) were assertions I hadn't verified
against the actual script text. Checking the script before stating what it does, from now on.

## F-15 — the diagnostic principle, confirmed

Equal byte length (16741 = 16741) with a different hash meant insertion and deletion were already
ruled out mathematically before any investigation started — only a same-width substitution could
produce that pattern. The block-hash method localized it to a specific 1024-byte range in one
command, and byte-offset inspection inside that range found the exact swap. Method worked exactly
as the diagnosis predicted it would; adopting block-hash localization as the default first move
for any future same-size/different-hash file discrepancy, not a last resort.

## Standing note, restated (per your instruction, every report)

The hard gate is cleared for **this platform and this run only**: `11_mutation_control.sh`
returned `UNDETECTED=0` with `NO-OP-HERE=1` on Linux. Windows re-verification has **not** been
witnessed by this session — the Windows result in `BLOCKED_ITEMS_revision6.md` (B3) is
AUDITOR-ATTESTED from an earlier round, not this session's evidence. `NO-OP-HERE=1` means M8c has
still never executed anywhere it would be a defect. Recorded as **BLOCKED**, not coverage.

## Proceeding to step 4

Per your instruction, continuing now into WO-2 (revised) items 1–4: defining a deterministic,
documented hash construction, then capturing and hashing all 71 production functions and all 74
staging functions.
