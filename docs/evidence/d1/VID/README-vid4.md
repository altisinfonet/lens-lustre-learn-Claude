# VID-4 · copyright music check — built complete, shipped OFF (D1, T1) · `20261005_0006`

**Plan:** `docs/evidence/d2/phase5/VID-1/DECISION.md` §6–§7 (signed, #376), as amended by the Owner:
- **R-102:** built complete but OFF. OFF → videos publish with any audio, and the audio hash is stored anyway;
- **R-102 / R-103:** the check sits behind the `copyright_music_check` switch (Off / Selected members / All members, VID-7). This supersedes DECISION §8's "never for the music check".

Needs `20261005_0004` (switches) and `20261005_0005` (videos, gate).

## How it works
| Step | Rule |
|---|---|
| `video_mark_uploaded(video, version[, audio_sha256])` | Called by the owner, from D2's `/api/video/complete` (DECISION §3.4). It moves the video to `checking` and **fixes the mode for this version** from `feature_allowed('copyright_music_check', owner)`. It refuses another member (MU-001), a version that is not current (MU-002) and a bad hash (MU-003). A retry is replayed. An Off `video_posts` / `video_ads` switch stops it (VID-UP-003) |
| **Off** | A `not_required` check (mode `off`) carries the audio hash, which the version stores. The video is **ready in the same call**. A silent video → `not_required` with no hash. With audio but no hash handed in → queued: the worker hashes the served bytes and closes the check as `not_required`. **No provider call** |
| **On** | A pending check (mode `on`) is queued. **A hash from the client is not stored**: only the worker's hash of the served bytes binds an on check |
| `music_check_record_result` (service_role only) | **On:** `clean` / `clean_no_audio` / `clean_library` → ready (the 0005 gate re-validates); `match` → `music_blocked`, nothing published; `error` → stays `checking`, `next_retry_at` = **1 → 2 → 5 → 15 → 30 min, then every 30 min**. **An on check can never close as `not_required`** (MC-002); an off check can never be judged. Other refusals: stale or older attempts (MC-001); a hash that does not fit the version (MC-003); a match with no matches listed (MC-004); `clean_library` with any match that is not an active library fingerprint (MC-005) |
| `music_check_due(n)` / `music_check_overdue(6 h)` (service_role) | The worker's queue (pending checks, plus errors whose retry time has come) and the 6-hour alert list (VID-6 channel; the member sees "Still checking — this is on our side") |
| `video_new_version(...)` (owner, blocked videos only) | The blocked-screen remedies: **mute** (no audio), **library track** (an active track), **trim** (1–20 cut ranges, ≥ 3 s left). The same size rules apply (`video_validate_version`). It creates v n+1 — **not a new upload** — and the new version is checked again |
| Library | `music_library_add` (admin, https licence URL; **added inactive**) → `music_library_set_fingerprints` (worker) → `music_library_set_active` (admin; LIB-003 before fingerprints). Every change goes to `music_library_audit` (append-only) |
| Key missing | The switch cannot go on without the key (VID-7 FEATURE-003). If the key disappears while the switch is on, a checked member's video waits in `checking`: the worker can only record errors. **Never published unchecked** |

**Not in this unit (stated):** the `music-check` Edge Function itself — the vendor adapter, its wake (P5-b pattern) and its sweep job. The vendor is not chosen yet (DECISION §7.1, Owner). Until it ships: **Off publishes** (the as-shipped state), and **On waits in `checking`**.

**Rollback:**
- lane-guarded;
- removes the functions only. Videos, versions, the check history and the library audit are kept. A waiting video stays unpublished; after a re-apply the worker finishes it;
- 0005's rollback refuses while 0006 is applied.

## Proof — `vid4-run-tests.sh` → `vid4-transcript.txt` (ALL CASES PASS, **staging shape and production shape**)
| Check | Result |
|---|---|
| Fail-first | Before the apply, the PROBE is red (M1) and an uploaded video can never leave `uploading`. An apply with no lane is refused; a second apply hits PRE-002 |
| Off | Owner / version / hash / anon refusals. Audio + hash → ready in one call, `not_required:off` with the hash stored. Replay. Linked to a post. Silent → ready. No hash → queued; the worker can only hash, not judge. Members and admins cannot act as the worker |
| Switch | Selected / All members refused without the key; with the key → Selected: Neil Basu |
| On (Neil) | Checking and queued; the client's hash is not stored. Riya (not listed) publishes at the same moment. The worker cannot wave it through; service_role cannot force ready (GATE-001). A match → `music_blocked`; the post link is refused. Neil reads title and range; Riya sees nothing |
| Remedies | Owner and blocked-only rules; `original` and muted-with-audio refused; size rules apply. **Mute** → v2 (no new upload) → checked → `clean_no_audio` → ready → linked. **Library:** member / http URL / unfingerprinted activation refused, three audit rows; unknown track refused; library + leftover music → MC-005; library only → `clean_library` → ready. **Trim:** a bad cut and under 3 s refused; leftover music blocks again |
| API down | Errors 1–3 → still `checking`, retry 1 / 2 / 5 min, not due early. The gate refuses an error row. Due again at the retry time, then clean → ready (4 errors kept). Late or older results refused. 7 h → on the overdue list |
| Key missing while on | Neil's new video waits in `checking`; the worker can only record an error. The PROBE still holds |
| R-82 scale | 20 000 checking among 220 000: `music_check_due(50)` ≈ 150 ms; `music_check_overdue()` ≈ 130 ms |
| PROBE mutants (each red, each undone) | Worker RPC granted to members; library audit editable; an on check closed `not_required` (live row); an error with no retry time; an active track with no fingerprint |
| Rollback | Rollback order enforced; lane-guarded; counts kept; the waiting video stays unpublished; PROBE red; re-apply; PROBE green; the worker finishes the waiting video |

Fixture note: the shared fixture carries staging's default privileges (read 2026-10-05: new functions get authenticated + service_role EXECUTE, new tables anon/authenticated/service_role ALL). Every REVOKE above is therefore proved against what a new object really gets, and service_role is shown bound by the gate.
