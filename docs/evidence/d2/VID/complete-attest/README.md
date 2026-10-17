# F-D1-4 client half + SEC-VID-10 · `complete` sends 0007's 5-argument call (D2, T1)

Contract: `docs/evidence/d1/VID/README-vid2-attest.md` (D1, #384, SEC T1 ACCEPT 2026-10-10 06:20 UTC).
Condition SEC-VID-10 (SEC handoff 06:20): refuse to sign when `VIDEO_COMPLETE_ATTEST_KEY == MEDIA_TOKEN_KEY`, with a test.

## What changed
- `functions/api/video/attest.ts` (new): `attestMessage` builds `v1|lane|video|version|manifest_sha256|has_audio|audio_sha256|issued_at`
  (lane WORD, lowercase uuid, unpadded version, 64 lowercase hex, `none` without audio, Unix seconds) and throws on anything
  0007 would read differently; `signAttest` = lowercase hex HMAC-SHA256 (WebCrypto); `checkAttestEnv` refuses a key
  < 32 chars, a key equal to MEDIA_TOKEN_KEY (trimmed), and a lane that is not exactly `staging`/`production`.
- `functions/api/video/complete.ts`: attest env checked FIRST (503 VID-ENV-003, nothing read/copied/marked);
  manifest audio flag must equal the stored one (409 VID-CMP-002, before the copy — 0007 signs the STORED flag);
  signs only after every check and the SEC-VID-1 copy; sends `_audio_sha256` (null for none), `_issued_at`, `_attest`;
  0007's VID-MU-004/005/006 → 503 VID-ENV-003 (lane config/clock, so the job retries; never a member-facing "refused").
  Any other database refusal keeps 409 VID-DB-001. `_lib.ts` untouched (no overlap with #385's VideoEnv lines).
- New Pages variables per lane (Owner): `VIDEO_COMPLETE_ATTEST_KEY` (= vault `video_complete_attest_key`), `VIDEO_ATTEST_LANE`.

## Proof (2026-10-10 UTC)
- D1's two vectors reproduced byte for byte (e142ca53…, 5ba22d20…).
- `before.txt`: the final test set against staging's `complete` → 10 failed / 34 passed.
- `after.txt`: 52/52 (attest + complete + upload-job tests). Full vitest 3122 pass / 0 fail / 1 skipped; tsc -b 0.
- `mutants.txt`: 13/13 killed (equality check, trim, lane word, ms clock, `none`, field order, hex case, key floor,
  check after copy, refusal mapping, stored audio flag, attestation not sent, lane hard-coded).
