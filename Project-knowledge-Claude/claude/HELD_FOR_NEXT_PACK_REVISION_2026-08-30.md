# HELD FOR THE NEXT PACK REVISION — not applied to rev6

**Written 2026-08-30 by the auditor session, to close a continuity gap the executing session
flagged rather than assumed.** These three items exist only in conversation; `RESUME_HERE.md`
inside the pack predates them, so a fresh session re-activated after that container is reclaimed
would not inherit them. That is the C-9 class appearing in the file written to prevent it.

**Nothing here is applied to the pack. rev6 remains final. No pack bytes change, and the archive
hash is unaffected — none of this touches anything under `handover/`.**

---

## 1 · Archive reproducibility — corrected wording, to be carried wherever the old caveat appears

The auditor's instruction said the archive hash "is not expected to reproduce on rebuild." **That
was wrong in this environment**, and the executing session proved it: two rebuilds seconds apart
produced bit-identical output, because `tar -czf` pipes through gzip via **stdin**, and gzip
compressing a *stream* writes `MTIME = 0` rather than a file timestamp (verified in the header
bytes `1f8b0800 00000000 0003`).

"It reproduces" is equally unsafe. The correct statement, agreed by both sessions:

> **Reproducible only under the stated construction** — GNU tar 1.35, gzip 1.12, fixed file set,
> unchanged member mtimes, stable walk order — **recorded beside the hash**, because it breaks
> under a different tar, a different walk, or any mtime change. **The manifest hash remains the
> identity that survives all three.**

## 2 · Nested-archive entry counts, for the manifest header

Checkable **without trusting the manifest**, which is the point — this is the completeness
assertion the 20-byte empty tarball would have failed.

| Nested archive | Entries |
|---|---|
| `01_WO1/WO1_evidence_pack_20260829.tar.gz` | 57 |
| `06_RAW/prod_captures/prod_raw_full_71.tar.gz` | 123 |
| `06_RAW/staging_captures/staging_raw_74.tar.gz` | 75 |
| `06_RAW/ws4_harness_pack.tar.gz` | 35 |

None empty.

## 3 · Replace the old reproducibility caveat wherever it was carried

Any location repeating "not expected to reproduce" takes the §1 wording instead.

---

## ✅ RESOLVED 2026-08-30T09:55:30Z — the archive hash. Prior state preserved below (§14).

**Re-measured, twice, by two independent implementations** (`sha256sum` and a streaming Python
`hashlib` read):

```
1378f5da5917fe1cf252616b51f38e4579009d816670dd211bb5f718fdb8f716  rev6 archive   1,188,069 bytes
```

Corroborated by unchanged size (1,188,069), unchanged mtime (09:12:32 UTC, the rev6 build), and the
pack still verifying **83/83** against `MANIFEST.sha256`. **The archive did not change. The tail is
`…f716`. The abbreviation was wrong.**

**Probable cause, recorded as INFERRED, not measured:** `83ac` appears to be the tail of the *rev5*
archive hash (`fcb19a1a…4683ac`), spliced onto rev6's prefix — an abbreviation assembled from two
different measurements. It cannot be proven: the rev5 archive was deleted when rev6 was built, so
the claim rests on recall of an earlier transcript value. What **is** measured is that rev6 is
`…f716` and always was.

### The rule this yields — a fourth, distinct from the three below

> **An abbreviated hash is not a hash.** It is a display convenience with no verification value,
> and it is uniquely prone to splicing: two different hashes can share a prefix in a summary and be
> joined without either being wrong on its own. **Anywhere a hash is to be recorded rather than
> read, it goes in full.**

In this engagement the full form was correct every time it was measured. **Every error was in a
shortened restatement.**

### The values to store, in full

```
1378f5da5917fe1cf252616b51f38e4579009d816670dd211bb5f718fdb8f716  HANDOVER_PACK_2026-08-30_rev6.tar.gz   1,188,069 bytes
78cc948b597bead086d2779b65d8fc3024617470f98288254d8ae7473dfc384e  MANIFEST.sha256                            16,722 bytes
618b7e1f66d8054d609574af38d2f2ce9308929612281e066d8f07182f0faf48  05_INSTRUMENTS/MANIFEST.sha256              1,524 bytes
```

---

## ~~⚠ OPEN DISCREPANCY — the archive hash, unresolved at time of writing~~ — SUPERSEDED, preserved

Two values for the rev6 archive appear in the record:

| Source | Value |
|---|---|
| Attestation, full | `1378f5da5917fe1cf252616b51f38e4579009d816670dd211bb5f718fdb8f716` |
| Later message, abbreviated | `1378f5da…83ac` |

**The full hash ends `…f716`, not `83ac`.** No revision was cut between the two statements, so the
archive cannot have changed; one is a transcription error. **The abbreviated form is the one that
appeared beside the instruction to record the hash at a durable destination**, which is where an
error of this kind does the most damage.

**Not resolved by either session. The holder of the file must re-measure and record the measured
value, not either quoted one.** Size is 1,188,069 bytes.

---

## Pack persistence — BLOCKED, owner-only

`HANDOVER_PACK_2026-08-30_rev6.tar.gz` (1,188,069 B) exists in the executing session's **ephemeral**
container and in conversation file cards. It is nowhere durable. The Claude project cannot hold it:
766,858 bytes free against 1,188,069 — short by roughly 421 KB, so the project is not a poor store
but an impossible one. **Closable only by the owner**, by downloading the archive to a durable
destination that is not a release system (**not R2** — that is a provider write the standing
constraints forbid) and recording the hash measured *at that destination*.

## The shape all three faults share

The executing session's generalisation, recorded because it is the most transferable thing this
engagement produced:

> A correct general rule, misapplied to a construction where its precondition failed.

Three instances, one shape — **scope, not correctness**:
1. **LG-05-DEF-1** — a row's endpoint taken from anywhere in the row, including the instrument cell.
2. **The guard manifest's coverage clause** applied to a 16-file folder it was written for at 12.
3. **The gzip reproducibility caveat** applied to a stream construction where its precondition fails.

Alongside the two rules already in the index, which this completes:
*a suite never shown to detect a planted defect is not evidence about that class*, and
*a check sharing its exclusion rule with the thing it checks is not a check*.

---

**Standing state:** rev6 final. Track R not started. Re-activation on exactly one of — the Track R
sixteen with author and per-item evidence class; independent auditor findings against the pack; or
owner authorisation of a replacement RC. **Nothing here closes a §25 row.**
