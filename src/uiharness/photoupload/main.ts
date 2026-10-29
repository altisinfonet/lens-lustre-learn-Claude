/**
 * S5-d · the 8-point kill harness page. Development only (served by the Vite
 * dev server at /photouploadharness.html; vite builds only index.html).
 *
 * The REAL upload code runs here — the encoder, the shared PUT (real XHR), the
 * IndexedDB job store, presign/publish through the real supabase client —
 * against a server that lives in the NODE process (tools/uishot/photo-kill-
 * harness.mjs), so its state survives the page being killed. Supabase calls
 * the upload makes are sent to the same-origin path /__s5api/<path>; the PUTs
 * go to /__s5r2/<key> (what the fake presign hands out). Everything else is the
 * usual harness fake backend (signed-in session).
 *
 *   ?impl=job     the S5-b resumable photo job (the subject)
 *   ?impl=legacy  the pre-S5 composer pipeline: upload with fresh random keys,
 *                 publish with a fresh idempotency key, nothing kept on the
 *                 device — after a kill the member can only post again (the
 *                 control that must FAIL)
 *   &phase=start  begin a 2-photo post   ·   &phase=resume  relaunch
 * Writes `window.__s5 = { phase, done, error }` for the Node side.
 */
import { installFakeBackend, HARNESS_USER_ID } from "../fakeBackend";

if (!import.meta.env.DEV) throw new Error("photo upload harness is development-only");

const params = new URLSearchParams(window.location.search);
const impl = params.get("impl") ?? "job";
const phase = params.get("phase") ?? "start";
const FORWARD = [
  "/functions/v1/s3-presign-upload", "/functions/v1/media-register-upload",
  "/rest/v1/rpc/media_begin_upload", "/rest/v1/rpc/post_publish_with_media",
  "/rest/v1/rpc/is_s3_storage_enabled", "/rest/v1/posts",
];
const net = window.fetch.bind(window);
installFakeBackend({ routes: [], signedIn: true });
const fake = window.fetch;
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const m = /^https:\/\/[^/]+\.supabase\.co(\/[^?]*)(\?.*)?$/.exec(url);
  if (m && FORWARD.some((p) => m[1] === p)) return net(`/__s5api${m[1]}${m[2] ?? ""}`, init);
  return fake(input, init);
};

const state = { impl, phase, done: false, error: null as string | null };
(window as unknown as { __s5: typeof state }).__s5 = state;

/** Two deterministic photos (2000×1500 and 1500×2000), drawn — no fixture files. */
async function photos(): Promise<File[]> {
  const out: File[] = [];
  for (const [w, h, c] of [[2000, 1500, "#3a6"], [1500, 2000, "#a63"]] as const) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d")!;
    g.fillStyle = c; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `hsl(${i * 9},60%,${30 + i}%)`; g.fillRect((i * 97) % w, (i * 53) % h, 180, 120); }
    const blob = await new Promise<Blob>((r) => cv.toBlob((b) => r(b!), "image/png"));
    out.push(new File([blob], `p${w}.png`, { type: "image/png" }));
  }
  return out;
}
const post = { content: "S5 kill harness", privacy: "public", categories: ["street"], indexingDisabled: false };

async function runJob() {
  const { createPhotoJob, runPhotoJob, runPhotoJobs, photoJobsFor } = await import("@/lib/upload/photoJobs");
  const { realPhotoJobDeps } = await import("@/lib/upload/photoJobDeps");
  if (phase === "start") {
    const id = crypto.randomUUID();
    await createPhotoJob({ id, userId: HARNESS_USER_ID, files: await photos(), post });
    await runPhotoJob(id, realPhotoJobDeps);
  } else {
    // A relaunch: the bridge's job — run until nothing is left on the device.
    for (let i = 0; i < 20 && (await photoJobsFor(HARNESS_USER_ID)).length > 0; i++) {
      await runPhotoJobs(HARNESS_USER_ID, { ...realPhotoJobDeps, now: () => Date.now() + 10 ** 9 });
    }
    const left = await photoJobsFor(HARNESS_USER_ID);
    if (left.length) throw new Error(`job not finished: ${left.map((j) => `${j.step}:${j.lastError ?? ""}`).join(",")}`);
  }
}

async function runLegacy() {
  // Pre-S5: nothing on the device, so start and resume are the same thing —
  // the member picks the photos again and taps Post again.
  const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
  const { publishViaMedia } = await import("@/lib/media/postMediaWrite");
  const up = [];
  for (const file of await photos()) up.push(await uploadImageWithThumbnail({ bucket: "post-images", file, type: "post", userId: HARNESS_USER_ID }));
  const r = await publishViaMedia({
    photos: up.map((u) => ({ url: u.url, thumbnailUrl: u.thumbnailUrl, stored: u.stored ?? null })),
    ...post, idempotencyKey: crypto.randomUUID(),
  });
  if (!r.postId) throw new Error(`publish failed: ${r.failure}`);
}

(impl === "legacy" ? runLegacy() : runJob())
  .then(() => { state.done = true; })
  .catch((e) => { state.error = e instanceof Error ? e.message : String(e); });
