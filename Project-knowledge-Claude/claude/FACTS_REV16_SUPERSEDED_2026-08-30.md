# `facts_rev16.json` — **SUPERSEDED**, 2026-08-30

**Status: SUPERSEDED by the live `--repo` run of 2026-08-30.** Do not use this file as a fact
source for any new finding. The original is preserved **byte-identical** alongside this notice as
`facts_rev16.json.ORIGINAL`, sha256 `b343a7d1bd024300dde09013c11bd1bdc1b92abcda7aa5b87d1029336337dd0a`,
3,381 bytes — matching the v3 pack MANIFEST. **No number inside it has been corrected.** Correcting
it would destroy the evidence of *how* it failed, which is the point of this notice.

## Why it existed

The guard had **no git access** to `altisinfonet/lens-lustre-learn-Claude` when v3 was built. Its
own `_provenance` block says so:

> `"class": "ATTESTED (not measured by the guard)"` ·
> `"measured_by": "compiler (Claude), read-only GitHub compare/blob reads, 2026-08-29T12:02Z"` ·
> `"caveat": "the guard has NO git access to this private repository; every git-derived finding produced from this file is labelled [ATTESTED] in the report and is only as good as this file"`

That caveat was correct and honestly stated. What it did not say is the structural problem below.

## The structural defect: the fact source was transcribed from the document it was used to audit

`facts_rev16.json`'s `ranges` were populated by reading figures that originate in, or were
cross-read against, `docs/PROMOTION_LEDGER.md` itself. **A checker cannot detect an error in a
document by comparing that document against numbers copied out of it.** Where the ledger and the
fact file shared a value, the guard reported agreement — which is not evidence of correctness, only
of consistency. This is **circular attestation**, and no amount of care in transcription fixes it;
the defect is in the topology, not the typing.

## The instance that proves it

`facts_rev16.json` records, for the range `b671e1fb0c5b…..a42b209e4f70…`:

```json
"b671e1fb0c5bcf145d442076c229eca888afd674..a42b209e4f70a6efed4f3dcdb654e0f994416594": {
  "files": 138,
  "added": 9060,
  "deleted": 1293,
  "commits": 45,
  "commits_no_merges": 43
}
```
*(Quoted verbatim from the preserved original and re-read programmatically to confirm.)*

| Field | Attested here | **Measured live, 2026-08-30** | |
|---|---|---|---|
| `files` | 138 | 138 | correct |
| `added` | 9060 | 9060 | correct |
| `deleted` | 1293 | 1293 | correct |
| **`commits`** | **45** | **39** | **WRONG** |
| **`commits_no_merges`** | **43** | **37** | **WRONG** |

**45 / 43 is the true count for `main…fe63e944`** — REV-12's head — not for `main…a42b209e`. The
pair was carried over from the ledger's §3.2(b), which states it correctly against its own
endpoint, and was attached here to a different endpoint.

## Why NEITHER form of the guard could catch it

- **`--facts`**: the guard compared the ledger against a file whose figures came from that ledger.
  A shared error is invisible by construction. This is the circularity.
- **`--repo`**: the guard computes ranges from live git — but **no line in the ledger claims a
  commit count for `main…a42b209e`** (§3.2(a) records files and lines only, no commit row). LG-05
  therefore has nothing to compare against and correctly stays silent.

**The error was undetectable by both forms.** It surfaced only because WO-3 step 1 asked for the
figure to be measured directly, against no prior claim. That is the argument for measuring
independently rather than reconciling documents against each other.

## What supersedes it, and what does not change

**Supersedes:** the live run of 2026-08-30 —
`python3 ledger_guard.py --repo <checkout> --ledger docs/PROMOTION_LEDGER.md --base origin/main`
from a detached checkout at `origin/staging` (`9ac4524d…3bc9`). Every finding in that run is tagged
**`[MEASURED]`**; none rests on this file. Result: **FATAL=0 FAIL=8 WARN=1 INFO=4**, exit 1.

**Does not change:** this file's `main…staging` range (`49` / `47`, `+10,159 / −1,293`) **is
correct**, having been read from a live GitHub compare rather than from the ledger. That is why the
six LG-05 findings are byte-identical under `--facts` and `--repo`. The two abbreviation WARNs
present under `--facts` (LG-03, `9faf5a17` and `fe4505aa` attested only as abbreviations) vanish
under `--repo`, where the full objects are resolvable — the difference between WARN=3 and WARN=1.

**Class of every finding produced from this file: ATTESTED. Never VERIFIED. Never MEASURED.**
Superseded 2026-08-30. Retained as evidence, not as an instrument.
