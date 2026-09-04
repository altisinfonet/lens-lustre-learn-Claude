# Phase 0 · 0-D1-01 · the committed staging baseline

**`baseline-2026-09-04T17-01-39-224Z.json`** — the file this gate has been open for.

| | |
|---|---|
| Lane | staging, `ztzutckwdhetphwghuzj` |
| Cluster fingerprint | `7666007964130682852` (matched) |
| Workflow run | **33898280809**, job 101106046473 |
| Repository SHA | `612c868` (staging) |
| Measurement window | **2026-09-04T17:01:11.313Z → 17:01:39.224Z** |
| Bytes | **939,588** |
| **sha256 of the committed file** | **`98db5934f1914efbb07671f2280a43a7258068063b5dc8678412d016ca3cee5f`** |
| sha256 as printed by the run | **`98db5934f1914efbb07671f2280a43a7258068063b5dc8678412d016ca3cee5f`** — identical |
| Probes | 21 measured, 0 blocked |

Taken **after** the 100,000-row seed, so it describes the database the later
phases will measure against, not the empty one.

## How it got here, and why that matters

Both delivery routes for this artefact failed before it could be committed, and
each failure is recorded rather than smoothed over.

1. **The artifact route is blocked by network policy.** `productionresultssa16.blob.core.windows.net`
   and `results-receiver.actions.githubusercontent.com` both answer **403** to
   this environment's egress proxy (`connect_rejected`). Not transient, no
   per-tool remedy. Three attempts across the afternoon.
2. **The log route was mis-sized.** It emitted the file as raw base64, and at
   939,588 bytes that is ~12,500 log lines. I had proved that route on a
   **37,437-byte** stand-in — 25× smaller than the artefact it had to carry.
   Recorded as 0-D1-01b: a recovery mechanism proved at an unrepresentative
   scale, in a project whose seeder exists because "green at 17 rows, unknown at
   a million" is not evidence.

The emitter now gzips first. On this real artefact:

| | |
|---|---|
| raw | 939,588 bytes → ~12,528 base64 lines |
| gzipped | **61,366 bytes → 819 base64 lines** (15.3:1) |
| whole job log | 13,557 lines → **1,854 lines** |

## The recovery is verified, not asserted

The file was reconstructed from the run log by `base64 -d | gunzip` and its
sha256 compared with the `SHA256(json)` line the run printed **either side** of
the block. They match exactly, and the file parses as JSON.

**The checksum is over the original JSON, never over the gzip.** A checksum of
the compressed form would prove only that the compression survived; this proves
the committed bytes are the bytes the instrument wrote.

## Its own controls fired

Recorded inside the artefact, not claimed here:

- **`read_only_session`** — a real `CREATE TABLE public.__d1_readonly_negative_control__`
  was attempted and refused with SQLSTATE **25006**. This is F-78's wrapper
  (`BEGIN READ ONLY; …; COMMIT;`) holding on the **real transport**, through the
  session pooler, not on a fixture.
- **`cluster_fingerprint`** — expected `7666007964130682852`, observed the same.

The artefact's `instrument.read_only` field states the wrapper as the operative
mechanism and records that PGOPTIONS does not survive the pooler — corrected
under Standing Rule 21, because that string ships inside the evidence.

## Re-running this will produce a different sha256, and that is correct

The database is unchanged since 16:41, so the *readings* reproduce. The *file*
will not: `run.started_utc`, `run.finished_utc` and a `measured_at_utc` on every
probe row differ per run. A matching sha256 across two runs would mean the
timestamps were not being written — which is the thing the gate asks for on
every line.
