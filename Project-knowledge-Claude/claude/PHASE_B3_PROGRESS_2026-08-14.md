# B3 progress — a, b, c ALL DEPLOYED (2026-08-14)

## Deployed to production this run
| Cycle | What | Where |
|---|---|---|
| B3a | Orphan reference-set repair (the 263-file landmine defused) | detect-orphan-files v21→v22 |
| B3b | Deletion Protocol enforcement + R2-aware detection + shared S3 client | purge-s3-orphans **v20**, detect-orphan-files **v22** |
| B3c | Scheduled posts carry thumbnails end to end | migration **20260814165300** + publish-scheduled-posts **v22** (verify_jwt=true preserved, read not assumed) |

Ninth filename drift: B3c drafted `20260814180000`, recorded `20260814165300`.

## Self-caught this run (all in evidence)
- purge's live-id reads ignored errors AND were un-paginated — in the DELETING file (same classes as the near-miss).
- My B3c chain test failed its first run against a CORRECT publisher (anchored on the duplicate-check query, not the insert). Re-anchored.
- EXIF plan assumption corrected: the main upload path already strips (canvas re-encode); competition EXIF is a deliberate GPS-excluding feature (B8). Real exposure = FILE-5004 encode-failure fallback (`fullResFile = file`, the HEIC case) + a shortlist of raw `storageUpload` callers (CompetitionSubmit re-encodes; avatar path only uses storageRemove).

## Owner steps (one sitting, when convenient)
1. Admin session → run detect-orphan-files (read-only; first real R2 report).
2. Admin session → purge-s3-orphans DRY RUN; review before any execute.
3. Admin session → backfill-thumbnails (repairs the 9 heavy posts).

## Next
`PHASE_EXIF_BUILD`: fallback GPS guard (exifr check → JPEG APP1 splice → refuse
undecodable-with-GPS), audit remaining raw callers (FileUploadDropZone,
HelpSupport, admin uploaders), lock with a test. Then B3d derivative worker.

State: DEPLOYED · db 20260814165300 · unpushed ~40 commits (transport still
blocked — owner must attach repo with push access).
