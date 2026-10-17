/**
 * POST /api/video/complete {video_id, version_no}   (VID-1 §3 step 4 + SEC-VID-1)
 *
 * As the member. Reads each manifest file from the UPLOAD prefix, verifies it,
 * and only then writes it to the SERVED prefix itself — a server-side copy of
 * the exact bytes it just verified, stored with their sha256 in the object's
 * metadata. The client never had a URL for the served key, so nothing it PUTs
 * after this (its URLs live for an hour) can change what viewers get.
 *
 * IN ROUNDS (2026-10-12, no time limit): Cloudflare allows 1,000 storage calls
 * per request (measured on this account: 900 ok, 1,100 refused) and each call
 * takes ~50 ms. A long video has thousands of files, so each request copies as
 * many as fit in ~800 calls / ~20 s and answers
 *   202 {state:"uploading", copied, total}  → the client calls again at once;
 * a file already served with the right size and sha256 (from an earlier round)
 * is not copied again. When every file is served:
 *   1. the playlists, init segments and poster are read back from the SERVED
 *      prefix (hash re-checked) and judged — poster FF D8 FF; relative URIs in
 *      the manifest only; no key/session/define tags; TARGETDURATION ≤ 6 and
 *      every EXTINF ≤ it; each segment once, in its own rendition, its bytes
 *      within twice the rendition's bytes/s ceiling for its own EXTINF
 *      (review C1, #410); segments add up to the declared length ±2 s; every
 *      video init one `vide` and no `soun`, the audio init one `soun`;
 *   2. audio_sha256 = the audio fingerprint (shared/rules.ts audioFingerprint,
 *      VID-1 §6.1 as amended A4): sha256 over "name:sha256" of audio.mp4 and
 *      every audio segment in playlist order — the hashes of the served bytes;
 *   3. video_mark_uploaded(video, version, audio_sha256, issued_at, attest) as
 *      the member; attest is the lane's HMAC over the stored version (F-D1-4,
 *      0007; ./attest.ts). Only this Function holds the key.
 * Any failure → 409 with the reasons, nothing marked: missing upload files
 * (409 + list, so the client re-asks /upload-urls for just those) and files
 * whose bytes differ from the manifest (deleted from upload/, 409 + list).
 * Files verified in the same round stay served; nothing is viewable until the
 * video is ready (a play token needs state = ready).
 *
 * CONVERTER PATH (20261012_0002): a body with `claim_token` is the converter
 * VM; the video is read through video_converter_version (its claimed job's
 * video only) and video_mark_uploaded accepts it only while that claim is
 * live (video_converter_acting). Verify, copy, judge and attest are the same.
 *
 * The lane's attest configuration is checked FIRST, before any read or copy:
 * a lane without its key (or with the play-token key reused, SEC-VID-10)
 * answers 503 VID-ENV-003 and writes nothing. The database's own attestation
 * refusals (VID-MU-004/005/006) are the lane's configuration or clock, not the
 * member's video, so they answer 503 too and the upload job retries.
 */
import {
  audioFingerprint, canonicalManifest, contentTypeFor, manifestKey, servedKey, sha256Hex, uploadKey, type VideoManifest,
} from "../../../src/lib/video/shared/rules";
import { playlistUris } from "../../../src/lib/video/shared/playlist";
import { judgeUploadContent } from "../../../src/lib/video/shared/judge";
import {
  HttpError, requirePrivateDelivery, asMember, handleError, json, loadConverterVersion, loadUploadingVersion, member, needEnv, readJson,
  type VideoEnv,
} from "./_lib";
import { ATTEST_DB_CODES, attestMessage, checkAttestEnv, signAttest, type AttestEnv } from "./attest";

const dec = new TextDecoder();

/** Storage calls one request may spend (Cloudflare: 1,000; headroom for the manifest, list pages and the final reads). */
export const COMPLETE_CALL_BUDGET = 800;
/** Wall time one request may spend copying before it answers 202. */
export const COMPLETE_TIME_BUDGET_MS = 20_000;
/** Files copied in parallel within a round. */
const COPY_PARALLEL = 6;
const isSmall = (name: string) => name.endsWith(".m3u8") || name.endsWith(".mp4") || name === "poster.jpg";

export async function handleComplete(
  request: Request, env: VideoEnv & AttestEnv, fetchImpl: typeof fetch = fetch, nowMs: () => number = Date.now,
  budget: { calls: number; ms: number } = { calls: COMPLETE_CALL_BUDGET, ms: COMPLETE_TIME_BUDGET_MS },
): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "VID-REQ-000", "POST only");
    requirePrivateDelivery(env);
    const attest = checkAttestEnv(env);
    const who = await member(request, env, fetchImpl);
    const body = await readJson<{ video_id?: string; version_no?: number; claim_token?: string }>(request);
    const row = body.claim_token !== undefined
      ? await loadConverterVersion(env, who, String(body.video_id ?? ""), Number(body.version_no), String(body.claim_token), fetchImpl)
      : await loadUploadingVersion(env, who, String(body.video_id ?? ""), Number(body.version_no), fetchImpl);
    if (row.state !== "uploading") {
      // An outbox retry after a success: answer, change nothing.
      return json(200, { video_id: row.video_id, version_no: row.current_version, state: row.state, replayed: true });
    }
    const raw = needEnv(env, "MEDIA");
    const owner = row.owner_id, vid = row.video_id, ver = row.current_version;
    const started = nowMs();
    let calls = 0;
    // Every storage call goes through here, so the budget is counted, not guessed.
    const bucket = {
      get: (k: string) => { calls++; return raw.get(k); },
      put: (k: string, v: Uint8Array, o: Parameters<typeof raw.put>[2]) => { calls++; return raw.put(k, v, o); },
      delete: (k: string) => { calls++; return raw.delete(k); },
      list: (o: Parameters<typeof raw.list>[0]) => { calls++; return raw.list(o); },
    };

    const mObj = await bucket.get(manifestKey(owner, vid, ver));
    if (!mObj) throw new HttpError(409, "VID-CMP-001", "ask for upload URLs first (no manifest on the server)");
    const mText = dec.decode(await mObj.arrayBuffer());
    if ((await sha256Hex(mText)) !== row.manifest_sha256) throw new HttpError(409, "VID-CMP-002", "the stored manifest is not this version's");
    const manifest = JSON.parse(mText) as VideoManifest;
    if (canonicalManifest(manifest) !== mText) throw new HttpError(409, "VID-CMP-002", "the stored manifest is not canonical");
    // 0007 signs the STORED audio flag; a manifest that disagrees would only be refused later, after the copy.
    if (manifest.has_audio !== row.has_audio) throw new HttpError(409, "VID-CMP-002", "the manifest's audio flag is not this version's");

    // What earlier rounds already served: the served objects carry the sha256 of
    // the verified bytes they were written from. One list call per 1,000 files.
    const servedPrefix = servedKey(owner, vid, ver, "poster.jpg").replace(/poster\.jpg$/, "");
    const served = new Map<string, { size: number; sha256?: string }>();
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: servedPrefix, cursor, include: ["customMetadata"] });
      for (const o of page.objects) served.set(o.key.slice(servedPrefix.length), { size: o.size, sha256: o.customMetadata?.sha256 });
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    const isServed = (f: { name: string; bytes: number; sha256: string }) => {
      const s = served.get(f.name);
      return !!s && s.size === f.bytes && s.sha256 === f.sha256;
    };
    const pending = manifest.files.filter((f) => !isServed(f));

    // Copy this round's share: verify each upload object, write the verified bytes to the served prefix.
    const missing: string[] = [];
    const mismatched: string[] = [];
    let copiedNow = 0;
    const copyOne = async (f: { name: string; bytes: number; sha256: string }) => {
      const key = uploadKey(owner, vid, ver, f.name);
      const obj = await bucket.get(key);
      if (!obj) { missing.push(f.name); return; }
      const bytes = new Uint8Array(await obj.arrayBuffer());
      if (bytes.length !== f.bytes || (await sha256Hex(bytes)) !== f.sha256) {
        mismatched.push(f.name);
        await bucket.delete(key);
        return;
      }
      await bucket.put(servedKey(owner, vid, ver, f.name), bytes, {
        httpMetadata: { contentType: contentTypeFor(f.name)! },
        customMetadata: { sha256: f.sha256 },
      });
      copiedNow++;
    };
    for (let i = 0; i < pending.length; i += COPY_PARALLEL) {
      const batch = pending.slice(i, i + COPY_PARALLEL);
      // Up to 3 calls per file (get, put or delete) — never start what the budget cannot finish.
      if (calls + batch.length * 3 > budget.calls || nowMs() - started > budget.ms) break;
      await Promise.all(batch.map(copyOne));
    }
    if (missing.length) throw new HttpError(409, "VID-CMP-003", `${missing.length} file(s) not uploaded yet`, { missing });
    if (mismatched.length) throw new HttpError(409, "VID-CMP-004", "these files do not match the manifest and were removed", { mismatched });
    const copied = manifest.files.length - pending.length + copiedNow;
    if (copied < manifest.files.length) {
      return json(202, { video_id: vid, version_no: ver, state: "uploading", copied, total: manifest.files.length });
    }

    // Every file is served and verified. Judge the content from the SERVED copies.
    const small = new Map<string, Uint8Array>();
    for (const f of manifest.files) {
      if (!isSmall(f.name)) continue;
      const o = await bucket.get(servedKey(owner, vid, ver, f.name));
      if (!o) throw new HttpError(409, "VID-CMP-003", "a served file vanished; it will be copied again", { missing: [f.name] });
      const bytes = new Uint8Array(await o.arrayBuffer());
      if (bytes.length !== f.bytes || (await sha256Hex(bytes)) !== f.sha256) {
        await raw.delete(servedKey(owner, vid, ver, f.name));
        throw new HttpError(409, "VID-CMP-004", "a served file did not match; it will be copied again", { mismatched: [f.name] });
      }
      small.set(f.name, bytes);
    }
    const problems = judgeUploadContent(manifest, small);
    if (problems.length) throw new HttpError(409, "VID-CMP-005", "the upload breaks the video rules", { problems });

    // The audio fingerprint: the per-file hashes of the served audio, in playlist order.
    const audioSha = manifest.has_audio
      ? await audioFingerprint(manifest, playlistUris(dec.decode(small.get("audio.m3u8")!)).filter((u) => u.endsWith(".m4s")))
      : null;

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
