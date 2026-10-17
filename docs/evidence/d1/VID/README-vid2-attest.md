# F-D1-4 · upload attestation + SEC-VID-4 · `20261005_0007` (D1, T1)

**Why:** before 0007 a member could call `video_mark_uploaded` directly with a made-up audio hash and reach `ready` with no files in R2 and without `complete` — and so also skip the only step that proves the renditions carry no `soun` track (F-D3-17). SEC confirmed and tightened the fix (claude/handoff/SEC.md, 2026-10-05 15:19 UTC). 0007 implements that ruling as written.

## The contract D2's `complete` signs

| Part | Value |
|---|---|
| Call | `video_mark_uploaded(_video_id, _version_no, _audio_sha256, _issued_at, _attest)` as the member. **The 3-argument form no longer exists** after 0007. |
| `_attest` | lowercase hex of **HMAC-SHA256(key, message)** |
| message | `v1\|<lane>\|<video_id>\|<version_no>\|<manifest_sha256>\|<has_audio>\|<audio_sha256>\|<issued_at>` (UTF-8, no trailing newline) |
| lane | `staging` or `production` — the word, not the project ref. Fixed into the database at apply time from `p32.lane` |
| video_id | uuid, lowercase, hyphenated |
| version_no | decimal integer, no padding |
| manifest_sha256 | 64 lowercase hex, the version's stored manifest hash (the one `complete` already checks the manifest against) |
| has_audio | `true` / `false` (the manifest's flag; the DB uses its stored copy) |
| audio_sha256 | 64 lowercase hex = the hash `complete` computed over the served audio bytes; the word `none` when there is no audio. **Pass the same value as `_audio_sha256`** (or SQL NULL for `none`) |
| issued_at | Unix seconds (integer), when `complete` signed. Pass the same value as `_issued_at` |
| key | Pages secret `VIDEO_COMPLETE_ATTEST_KEY` on each lane = vault secret `video_complete_attest_key` on that lane's database. ≥ 32 characters, different per lane, **different from `MEDIA_TOKEN_KEY`** (D2: refuse to sign if they are equal) |
| When | only after every R2 check AND the SEC-VID-1 copy to `video/…` have succeeded |

**Test vectors** (key `0123456789abcdef0123456789abcdef`; openssl and pgcrypto agree):
- `v1|staging|00000000-0000-0000-0000-000000000001|1|aaaa…a(64)|true|dddd…d(64)|1760000000` → `e142ca5324bd64b081c95b688345fa37c0e47bb03695583fd8f13e10c33fd21b`
- `v1|production|00000000-0000-0000-0000-000000000002|2|bbbb…b(64)|false|none|1760000000` → `5ba22d2092f0351382e8c24dc9698a000cc957925993c1d4a2a59ed37935c58d`

## What the database does

| Check | Result |
|---|---|
| not the caller's video / not the current version | VID-MU-001 / VID-MU-002 (as before; checked first, so another member replaying a valid attestation gets MU-001) |
| no key on the lane (or < 32 chars) | **VID-MU-004 — fails closed, nothing completes** |
| attestation missing, malformed, or not matching (other key, lane, video, version, manifest, audio flag, audio hash) | VID-MU-005 |
| `issued_at` older than 15 min or more than 60 s ahead | VID-MU-006 |
| all good | 0006's behaviour, unchanged (diffed in the harness) |

Checked **before the replay answer and before any write**. Remedy versions (`video_new_version` → `uploading`) leave `uploading` only through this call, so they are covered. **Rotation:** `video_complete_attest_key_previous` is accepted as well; a previous key under 32 characters or equal to the current one is ignored. The check (`video_attest_verify`) and the lane (`video_attest_lane`) are internal: no API role, service_role included, can call them.

## SEC-VID-4

`ad_videos_admin_write` (FOR ALL) → `ad_videos_admin_insert` / `_update` / `_delete`, same predicates. Authenticated now has **one** permissive SELECT path (`ad_videos_read`). Admin reads are unchanged (admins see every `ad_creatives` row, so `ad_videos_read` covers them — proved with an inactive creative).

## PROBE_vid2_upload_attest (read-only)

A1 no unattested form; the check comes before the replay answer and every write · A2 the check is internal, verify is not DEFINER, the fixed lane = the dispatch lane · A3 any switch not Off ⇒ key present · A4 the key is not the value of any other vault secret · A5 ad_videos: one SELECT path + the three admin policies.

## Proof

`vid2-attest-run-tests.sh` → `vid2-attest-transcript.txt`: **ALL CASES PASS on both lane shapes (157 checks)**, PostgreSQL 17.11 + pg_cron 1.6, pgcrypto in schema `extensions` (as on staging, read 2026-10-10). Fail-first: before 0007 Neil publishes on a made-up hash, and ad_videos has 2 SELECT paths. SEC's set refused: none, tampered, other lane, other key, other version, other video, other manifest, audio flag, audio hash swapped/dropped, expired, future, replay by another member; previous key OK. Seven PROBE mutants each go red (mutant 1 also re-opens the hole, so the tests can fail). Rollback restores 0006 byte for byte (reopens F-D1-4, says so); re-apply passes. vid7 110/110 · vid2 212/212 · vid4 146/146 re-run green on the updated fixture.

## Order on a lane

0007 → `PROBE_vid2_upload_attest` (passes with switches Off and no key) → the Owner sets the vault key + the Pages secret → D2's `complete` sends the 5-argument call → only then any switch beyond the Owner's own account. Roll back 0007 before 0006 (F-D1-7).
