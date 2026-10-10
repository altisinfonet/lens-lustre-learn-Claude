/**
 * POST /api/video/upload-urls {video_id, version_no, manifest}   (VID-1 §3 step 2)
 *
 * As the member. Returns one presigned PUT URL per manifest file not yet
 * uploaded, each valid for 1 h, each for a key under **upload/video/** only
 * (SEC-VID-1): the served key `video/…` is never handed to a client. Each URL
 * signs Content-Type (fixed by extension), Content-Length (the manifest size)
 * and x-amz-checksum-sha256 (the manifest hash), so a different type, size or
 * body is refused by R2 itself where it enforces the checksum, and by
 * /api/video/complete in every case.
 *
 * Refuses (no URL at all): not signed in (401) · not the owner (404) · not
 * uploading (409) · a manifest whose sha256 is not the one the database holds
 * for this version, or whose shape breaks the VID-1 rules (400/409).
 */
import {
  canonicalManifest, contentTypeFor, manifestKey, manifestProblems, sha256Hex, totalBytes, uploadKey, uploadOrder,
  type VideoManifest,
} from "../../../src/lib/video/shared/rules";
import {
  HttpError, requirePrivateDelivery, amzDateOf, handleError, hexToBase64, json, loadUploadingVersion, member, needEnv, presign, readJson,
  type VideoEnv,
} from "./_lib";

export const UPLOAD_URL_TTL_S = 3600;

export interface UploadUrl {
  name: string;
  key: string;
  url: string;
  /** headers the PUT must carry exactly (Content-Length is set by the browser from the body) */
  headers: Record<string, string>;
}

export async function handleUploadUrls(request: Request, env: VideoEnv, now: Date = new Date(), fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "VID-REQ-000", "POST only");
    requirePrivateDelivery(env);
    const who = await member(request, env, fetchImpl);
    const body = await readJson<{ video_id?: string; version_no?: number; manifest?: VideoManifest }>(request);
    const row = await loadUploadingVersion(env, who, String(body.video_id ?? ""), Number(body.version_no), fetchImpl);
    if (row.state !== "uploading") throw new HttpError(409, "VID-REQ-004", `the video is ${row.state}, not uploading`);

    const manifest = body.manifest as VideoManifest;
    const problems = manifestProblems(manifest, row.purpose);
    if (problems.length) throw new HttpError(400, "VID-MAN-001", "the manifest breaks the upload rules", { problems });
    const canonical = canonicalManifest(manifest);
    const sum = await sha256Hex(canonical);
    if (sum !== row.manifest_sha256) throw new HttpError(409, "VID-MAN-002", "this manifest is not the one declared for this version");
    if (totalBytes(manifest) !== row.total_bytes || manifest.has_audio !== row.has_audio
        || Math.abs(manifest.duration_s - row.declared_duration_s) > 0.01) {
      throw new HttpError(409, "VID-MAN-002", "the manifest does not match the declared version");
    }

    const bucket = needEnv(env, "MEDIA");
    const account = needEnv(env, "R2_ACCOUNT_ID");
    const bucketName = needEnv(env, "R2_BUCKET");
    const keyId = needEnv(env, "R2_UPLOAD_KEY_ID");
    const secret = needEnv(env, "R2_UPLOAD_KEY_SECRET");

    // The server's copy of the manifest is what /complete verifies against.
    await bucket.put(manifestKey(row.owner_id, row.video_id, row.current_version), canonical, {
      httpMetadata: { contentType: "application/json" },
    });

    const host = `${account}.r2.cloudflarestorage.com`;
    const amzDate = amzDateOf(now);
    const byName = new Map(manifest.files.map((f) => [f.name, f]));
    const urls: UploadUrl[] = [];
    const done: string[] = [];
    for (const name of uploadOrder(manifest.files.map((f) => f.name))) {
      const f = byName.get(name)!;
      const key = uploadKey(row.owner_id, row.video_id, row.current_version, name);
      const head = await bucket.head(key);
      if (head && head.size === f.bytes) { done.push(name); continue; }
      const headers = {
        "content-type": contentTypeFor(name)!,
        "x-amz-checksum-sha256": hexToBase64(f.sha256),
      };
      const url = await presign({
        method: "PUT", host, path: `/${bucketName}/${key}`, region: "auto", service: "s3",
        accessKeyId: keyId, secretAccessKey: secret, amzDate, expires: UPLOAD_URL_TTL_S,
        headers: { ...headers, "content-length": String(f.bytes) },
      });
      urls.push({ name, key, url, headers });
    }
    return json(200, { video_id: row.video_id, version_no: row.current_version, expires_in: UPLOAD_URL_TTL_S, urls, done });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: VideoEnv }) => handleUploadUrls(context.request, context.env);
