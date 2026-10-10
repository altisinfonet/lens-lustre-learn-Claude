/**
 * POST /api/video/complete {video_id, version_no}   (VID-1 §3 step 4 + SEC-VID-1)
 *
 * As the member. Reads every manifest file from the UPLOAD prefix, verifies it,
 * and only then writes it to the SERVED prefix itself — a server-side copy of
 * the exact bytes it just verified. The client never had a URL for the served
 * key, so nothing it PUTs after this moment (its URLs live for an hour) can
 * change what viewers get, and the audio hash handed to the database is the
 * hash of the served audio bytes (SEC-VID-1, F-D3-17).
 *
 * Checks, in order — any failure → 409 with the reasons, nothing marked:
 *   1. every manifest file is present in upload/ (missing → 409 + the list,
 *      so the client re-asks /upload-urls for just those);
 *   2. each file's size and sha256 equal the manifest (a mismatch deletes that
 *      upload object, so the retry uploads it again);
 *   3. poster.jpg starts FF D8 FF;
 *   4. playlists: relative URIs in the manifest only, no key/session/define
 *      tags, TARGETDURATION ≤ 6, segments add up to the declared length ±2 s;
 *   5. init segments: every video rendition exactly one `vide` and no `soun`;
 *      the audio rendition exactly one `soun`; none when has_audio = false;
 *      the master's CODECS carry an audio codec exactly when there is audio.
 * Then it copies, and calls video_mark_uploaded(video, version, audio_sha256,
 * issued_at, attest) as the member, where audio_sha256 = sha256(audio.mp4 ‖
 * audio_*.m4s in playlist order) — VID-1 §6.1's definition — and attest is the
 * lane's HMAC over the stored version (F-D1-4, 0007; ./attest.ts). Only this
 * Function holds the key, so a member calling the RPC directly cannot reach
 * `ready` (the hole 0007 closes).
 *
 * The lane's attest configuration is checked FIRST, before any read or copy:
 * a lane without its key (or with the play-token key reused, SEC-VID-10)
 * answers 503 VID-ENV-003 and writes nothing. The database's own attestation
 * refusals (VID-MU-004/005/006) are the lane's configuration or clock, not the
 * member's video, so they answer 503 too and the upload job retries.
 */
import {
  canonicalManifest, contentTypeFor, manifestKey, servedKey, sha256Hex, uploadKey, type VideoManifest,
} from "../../../src/lib/video/shared/rules";
import { playlistUris } from "../../../src/lib/video/shared/playlist";
import { judgeUploadContent } from "../../../src/lib/video/shared/judge";
import { HttpError, requirePrivateDelivery, asMember, handleError, json, loadUploadingVersion, member, needEnv, readJson, type VideoEnv } from "./_lib";
import { ATTEST_DB_CODES, attestMessage, checkAttestEnv, signAttest, type AttestEnv } from "./attest";

const dec = new TextDecoder();

export async function handleComplete(
  request: Request, env: VideoEnv & AttestEnv, fetchImpl: typeof fetch = fetch, nowMs: () => number = Date.now,
): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "VID-REQ-000", "POST only");
    requirePrivateDelivery(env);
    const attest = checkAttestEnv(env);
    const who = await member(request, env, fetchImpl);
    const body = await readJson<{ video_id?: string; version_no?: number }>(request);
    const row = await loadUploadingVersion(env, who, String(body.video_id ?? ""), Number(body.version_no), fetchImpl);
    if (row.state !== "uploading") {
      // An outbox retry after a success: answer, change nothing.
      return json(200, { video_id: row.video_id, version_no: row.current_version, state: row.state, replayed: true });
    }
    const bucket = needEnv(env, "MEDIA");
    const owner = row.owner_id, vid = row.video_id, ver = row.current_version;

    const mObj = await bucket.get(manifestKey(owner, vid, ver));
    if (!mObj) throw new HttpError(409, "VID-CMP-001", "ask for upload URLs first (no manifest on the server)");
    const mText = dec.decode(await mObj.arrayBuffer());
    if ((await sha256Hex(mText)) !== row.manifest_sha256) throw new HttpError(409, "VID-CMP-002", "the stored manifest is not this version's");
    const manifest = JSON.parse(mText) as VideoManifest;
    if (canonicalManifest(manifest) !== mText) throw new HttpError(409, "VID-CMP-002", "the stored manifest is not canonical");
    // 0007 signs the STORED audio flag; a manifest that disagrees would only be refused later, after the copy.
    if (manifest.has_audio !== row.has_audio) throw new HttpError(409, "VID-CMP-002", "the manifest's audio flag is not this version's");

    // 1. presence
    const missing: string[] = [];
    for (const f of manifest.files) if (!(await bucket.head(uploadKey(owner, vid, ver, f.name)))) missing.push(f.name);
    if (missing.length) throw new HttpError(409, "VID-CMP-003", `${missing.length} file(s) not uploaded yet`, { missing });

    // 2–5, one file at a time (a 500 MB video never sits in memory at once)
    const problems: string[] = [];
    const mismatched: string[] = [];
    const small = new Map<string, Uint8Array>(); // playlists, init segments, poster: kept for the checks
    for (const f of manifest.files) {
      const key = uploadKey(owner, vid, ver, f.name);
      const obj = await bucket.get(key);
      if (!obj) { missing.push(f.name); continue; }
      const bytes = new Uint8Array(await obj.arrayBuffer());
      if (bytes.length !== f.bytes || (await sha256Hex(bytes)) !== f.sha256) {
        mismatched.push(f.name);
        await bucket.delete(key);
        continue;
      }
      if (f.name.endsWith(".m3u8") || f.name.endsWith(".mp4") || f.name === "poster.jpg") small.set(f.name, bytes);
    }
    if (missing.length) throw new HttpError(409, "VID-CMP-003", `${missing.length} file(s) not uploaded yet`, { missing });
    if (mismatched.length) throw new HttpError(409, "VID-CMP-004", "these files do not match the manifest and were removed", { mismatched });

    problems.push(...judgeUploadContent(manifest, small));
    if (problems.length) throw new HttpError(409, "VID-CMP-005", "the upload breaks the video rules", { problems });

    // Copy the verified bytes to the served prefix (SEC-VID-1), audio hash on the way.
    let audioSha: string | null = null;
    const audioParts: Uint8Array[] = [];
    if (manifest.has_audio) {
      const segs = playlistUris(dec.decode(small.get("audio.m3u8")!)).filter((u) => u.endsWith(".m4s"));
      for (const n of ["audio.mp4", ...segs]) {
        const o = await bucket.get(uploadKey(owner, vid, ver, n));
        if (!o) throw new HttpError(409, "VID-CMP-003", "a file vanished during complete", { missing: [n] });
        const part = new Uint8Array(await o.arrayBuffer());
        const want = manifest.files.find((f) => f.name === n);
        if (!want || (await sha256Hex(part)) !== want.sha256) {
          throw new HttpError(409, "VID-CMP-004", "an audio file changed during complete", { mismatched: [n] });
        }
        audioParts.push(part);
      }
    }
    for (const f of manifest.files) {
      const o = await bucket.get(uploadKey(owner, vid, ver, f.name));
      if (!o) throw new HttpError(409, "VID-CMP-003", "a file vanished during complete", { missing: [f.name] });
      const bytes = new Uint8Array(await o.arrayBuffer());
      // Re-verify what is copied: the upload object could have been re-PUT since step 2.
      if ((await sha256Hex(bytes)) !== f.sha256) {
        await bucket.delete(uploadKey(owner, vid, ver, f.name));
        throw new HttpError(409, "VID-CMP-004", "a file changed during complete and was removed", { mismatched: [f.name] });
      }
      await bucket.put(servedKey(owner, vid, ver, f.name), bytes, { httpMetadata: { contentType: contentTypeFor(f.name)! } });
    }
    if (manifest.has_audio) {
      const total = audioParts.reduce((a, p) => a + p.length, 0);
      const all = new Uint8Array(total);
      let o = 0;
      for (const p of audioParts) { all.set(p, o); o += p.length; }
      // Every part was verified against the manifest when read, and the copy
      // wrote bytes with the same hashes, so this is the hash of the served audio.
      audioSha = await sha256Hex(all);
    }

    // F-D1-4: signed only now, after every check and the SEC-VID-1 copy succeeded.
    // The manifest hash is the stored one complete verified the manifest against.
    const issuedAt = Math.floor(nowMs() / 1000);
    const signature = await signAttest(attest.key, attestMessage({
      lane: attest.lane, videoId: vid, versionNo: ver, manifestSha256: row.manifest_sha256,
      hasAudio: row.has_audio, audioSha256: audioSha, issuedAt,
    }));
    let marked: { state?: string } | null;
    try {
      marked = await asMember<{ state?: string }>(env, who.jwt, "rpc/video_mark_uploaded", {
        method: "POST",
        body: JSON.stringify({ _video_id: vid, _version_no: ver, _audio_sha256: audioSha, _issued_at: issuedAt, _attest: signature }),
      }, fetchImpl);
    } catch (e) {
      const refusal = e instanceof HttpError ? ATTEST_DB_CODES.find((c) => e.message.includes(c)) : undefined;
      if (refusal) {
        throw new HttpError(503, "VID-ENV-003", `video uploads are not configured on this lane yet: the database refused the attestation (${refusal}) — check VIDEO_COMPLETE_ATTEST_KEY, VIDEO_ATTEST_LANE and the clock`);
      }
      throw e;
    }
    return json(200, { video_id: vid, version_no: ver, state: marked?.state ?? "checking", audio_sha256: audioSha });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: VideoEnv & AttestEnv }) => handleComplete(context.request, context.env);
