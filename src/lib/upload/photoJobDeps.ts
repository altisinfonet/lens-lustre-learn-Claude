/**
 * S5-b · the real PhotoJobDeps: presign (s3-presign-upload), the shared PUT,
 * and the publish — the media path first, the legacy insert as its airbag,
 * both under the job's idempotency key. Kept apart from photoJobs.ts so the
 * job logic is tested with fakes (the same split as video/jobDeps.ts).
 */
import { onlineManager } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { presignObjects } from "@/lib/s3Upload";
import { putWithRetry } from "./transport";
import { isNetworkError } from "@/lib/offline/retryPolicy";
import { readSiteSettingState, siteSettingFailure } from "@/lib/siteSettingsCache";
import { lastKnown, rememberKnown } from "@/lib/offline/lastKnown";
import {
  publishViaMedia, reportLegacyOnlyPublish, reportMediaPathFailure,
} from "@/lib/media/postMediaWrite";
import { recoverPostByKey } from "./recoverPost";
import { PhotoRefused, type PhotoJob, type PhotoJobDeps } from "./photoJobs";

/**
 * The switch: site_settings `photo_upload_resume`. Default OFF (row absent or
 * any other value) — the composer then uses today's path. Read through the
 * shared site-settings cache, at most a minute old.
 *
 * Admin → Video Feature → Upload Resume (20261103_0601) writes it from the feature
 * switch, in the same transaction as the audit row:
 *   "on"       All members — exactly what builds 1.2.29+ read, no app update;
 *   "selected" only the members on the list: this build asks the server
 *              (feature_allowed_me) for the signed-in member. Old builds
 *              compare === "on", so they read it as OFF — the safe side;
 *   "off"      Off.
 * Fail-closed: no member, a refusal or any other value is off.
 */
export const PHOTO_RESUME_KEY = "photo_upload_resume";
const memberKey = (userId: string) => `${PHOTO_RESUME_KEY}:${userId}`;

export async function photoResumeOn(userId?: string | null): Promise<boolean> {
  try {
    const st = await readSiteSettingState(PHOTO_RESUME_KEY, { maxAgeMs: 60_000 });
    if (st.known) {
      if (st.value === "selected") return await selectedForMe(userId ?? null);
      const on = st.value === "on";
      rememberKnown(PHOTO_RESUME_KEY, on);
      if (userId) rememberKnown(memberKey(userId), on);
      return on;
    }
    // S7b-5b: could not read because the network is lost — the last answer
    // this phone saw; never seen: off. A post made in flight mode then takes
    // the job path. A refusal with the network up reads off (review #583).
    if (siteSettingFailure(PHOTO_RESUME_KEY) !== "network") return false;
    // The member's own last answer when there is one (it covers "selected");
    // without a member, the phone-wide one as before.
    return (userId ? lastKnown(memberKey(userId)) : lastKnown(PHOTO_RESUME_KEY)) ?? false;
  } catch {
    return false;
  }
}

/** "selected": is the signed-in member on the list? The server's answer, never guessed. */
const SELECTED_TTL_MS = 60_000;
const SELECTED_TIMEOUT_MS = 4_000;
const selectedCache = new Map<string, { on: boolean; at: number }>();
/** Tests only. */
export function clearPhotoResumeMemberCache(): void { selectedCache.clear(); }

async function selectedForMe(userId: string | null): Promise<boolean> {
  // The phone-wide answer is no longer "on" for everyone (review #652).
  rememberKnown(PHOTO_RESUME_KEY, false);
  if (!userId) return false;
  const hit = selectedCache.get(userId);
  if (hit && Date.now() - hit.at < SELECTED_TTL_MS) return hit.on;
  const call = (supabase.rpc as unknown as (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(
    "feature_allowed_me", { _feature: PHOTO_RESUME_KEY },
  );
  // A weak link must not hold the composer: no answer in 4 s counts as a lost network.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ data: unknown; error: unknown }>((res) => {
    timer = setTimeout(() => res({ data: null, error: { name: "TimeoutError", message: "feature_allowed_me timed out" } }), SELECTED_TIMEOUT_MS);
  });
  const { data, error } = await Promise.race([call, timeout]).finally(() => clearTimeout(timer));
  if (error) {
    // Lost network: this member's last answer (S7b-5b); a refusal: off.
    return isNetworkError(error) ? (lastKnown(memberKey(userId)) ?? false) : false;
  }
  const on = data === true;
  rememberKnown(memberKey(userId), on);
  selectedCache.set(userId, { on, at: Date.now() });
  return on;
}

const RETRYABLE_DB_CODES = new Set(["57014", "55P03", "40001", "40P01"]);

async function publish(j: PhotoJob): Promise<string> {
  const photos = j.slots.map((sl) => ({ url: sl.objects[0].url!, thumbnailUrl: sl.objects[1].url!, stored: sl.stored }));
  const via = await publishViaMedia({ photos, ...j.post, idempotencyKey: j.id });
  if (via.postId) return via.postId;
  if (via.failure !== "unmigratable-slides") reportMediaPathFailure(j.id);
  reportLegacyOnlyPublish("resumable photo job: the media path did not complete", j.id);
  const legacy = await supabase.from("posts").insert({
    user_id: j.userId,
    content: j.post.content,
    privacy: j.post.privacy,
    image_url: photos[0].url,
    image_urls: photos.map((p) => p.url),
    thumbnail_urls: photos.map((p) => p.thumbnailUrl),
    indexing_disabled: j.post.indexingDisabled,
    categories: j.post.categories,
    idempotency_key: j.id,
  } as never).select("id").single();
  const settled = await recoverPostByKey(
    { data: legacy.data as { id: string } | null, error: legacy.error }, j.userId, j.id,
  );
  if (settled.data) return settled.data.id;
  // Network, or Postgres saying "try again" (timeout, lock, serialisation, deadlock — the
  // same set as the video runner): back off and retry. Anything else is a refusal.
  if (!settled.error || isNetworkError(settled.error) || RETRYABLE_DB_CODES.has(settled.error.code ?? "")) {
    throw new Error(settled.error?.message ?? "publish: no answer");
  }
  throw new PhotoRefused(settled.error.message);
}

export const realPhotoJobDeps: PhotoJobDeps = {
  presign: (objs) => presignObjects(objs),
  put: (url, data, contentType, represign, onProgress) =>
    putWithRetry(url, data, { label: "Photo", headers: { "Content-Type": contentType }, represign, onProgress: (sent) => onProgress(sent) }),
  publish,
  online: () => onlineManager.isOnline(),
  now: () => Date.now(),
};
