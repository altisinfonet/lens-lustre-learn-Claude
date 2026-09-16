# Pack supersession record — as ordered, in writing

Date: 2026-08-31 · **Deliberately NOT a member of any pack.** A statement about which revision is
current cannot live inside a revision — the same self-reference that stops an archive containing its
own sha256. **Nothing here closes a §25 row (§25.4).**

---

## 1. Confirmed, in writing

> **rev16 supersedes rev15. rev15 is withdrawn from reference and I will not cite it again.**

| revision | files / manifest / round-trip | archive sha256 | standing |
|---|---|---|---|
| ~~rev15~~ | ~~152 / 151 / 151~~ | ~~`3cde5c96…cb8a`~~ | **WITHDRAWN FROM REFERENCE** |
| **rev16** | **153 / 152 / 152** | **`a3563e9826f34e00510e7bab1e8de8c43491fd58475a9217d5ec075924affd86`** | **held and byte-verified by the auditor** |
| **rev18** | **186 / 184 / 184** | **`890a3dc77c0e294ca4a9528abf6336f3041d58f599bd88741a8d8def222b532a`** · 1,629,319 B | **CURRENT** |

*(rev17 was sealed, needed one corrected sentence, and under F-42 took the next number. It was never
delivered or quoted as current.)*

## 2. The operational fact that matters more than the numbering — **MEASURED, not assumed**

**The auditor holds rev16. rev16 does NOT contain either deliverable.** Extracted and checked:

```
rev16 contains 24_A15_CLAIMS          : NO
rev16 contains 23_TESTSUITE_RERUN     : NO
rev16 contains 22_RULINGS_EXPORT      : NO
rev16 contains 25_REVISION_STATEMENT  : NO
rev16 file count: 153      rev18 file count: 186
```

**So "the auditor has verified rev16 byte-identical" is true and does not help with these two
deliverables — they are not in it.** They must reach the auditor either as **rev18**, or as the six
standalone files hashed in §3. **Do not assume the pack they hold now carries them.**

**Nothing in rev16 changed.** rev18 is rev16 **plus four folders**; no earlier file's content was
altered except `00_INDEX.md`, `RESUME_HERE.md` and `MANIFEST.sha256`, which every revision changes by
construction. **The auditor's verification of rev16 remains valid for everything it covers.**

## 3. The two deliverables — standalone, hashed, so pack transport is not a dependency

### Deliverable 1 — the 138-file claims document

| file | sha256 | bytes |
|---|---|---|
| `A15_CLAIMS_DOCUMENT.md` | `3e8868f9e54b146f0a212b4272ee53c14a3a55330e3f7c741ff74f0cc00ec0c5` | 12,255 |
| `A15_CLAIMS_138.tsv` | `a2defa868f6561fa8f7dcca492009fd6b27f1fe2da079061d9d0f1cab47c4bc0` | 138 rows + header |
| `A15_CLAIMS_138.json` | `e6665a698628308bcfc8491403e211705887c0ad4c5467b9038a926ea7d12103` | |
| `build_claims.py` | `9071e97e29dfd144cbf11a7f4b7b8205bf77d78597a4a766dd5a88de7de014f9` | the generator, shipped with its output (F-30) |

Scope `main b671e1fb…674 → RC a42b209e…594`: **138 files, 31 added / 107 modified / 0 deleted,
+9,060 / −1,293.** Every row asserts something checkable against source and names the command.
**16 HIGH · 61 MED · 59 LOW · 2 N/A.**

### Deliverable 2 — the independent test-suite re-run

| file | sha256 | bytes |
|---|---|---|
| `TESTSUITE_RERUN_FULL_TRANSCRIPT.txt` | `07aab9fe7087de792da8d9df6ab22963d3e730c809cb25674b5b295db029854a` | **587,432** |
| `TESTSUITE_RERUN_REPORT.md` | `6536c191f88632138f3f6f9e60319a66ae5b7313de1f05161140eb954d2acc80` | 5,065 |

**Bound to head `9384ba9aeef585f615148b208f13d68fdbe169f5`** — re-confirmed current and clean at the
time of writing (`git status --porcelain` → 0 lines).

```
Test Files  178 passed | 1 skipped (179)
     Tests  2475 passed | 1 skipped (2476)
  Duration  183.13s
vitest exit code: 0
npm ci: 1012 packages, exit 0, from the committed lockfile
environment variables visible to the suite: 6 — none a credential
BLOCKED: src/test/judging-invariants.test.ts (needs a live service-role client)
```

**The binding, stated so it cannot be misread:** `9384ba9` is the replacement RC head and is **NOT
adopted** — not pushed, not merged, not tagged, §11 unsigned. **If it is not adopted, this run does
not stand for `a42b209e`**; the two differ by `functions/_seo.ts`. The `a42b209e` run is
`03_WO3/A5_CREDENTIAL_SCRUB_FULL_TRANSCRIPT.txt`.

## 4. Standing

Both required deliverables exist, are hashed, and are delivered standalone as well as inside rev18.
**Nothing else is in progress.** The remaining work on blocker 9 is the auditor's review of the 138
files and their acceptance of the test run — neither of which this session can perform or shorten.
