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
import { getSiteSetting } from "@/lib/siteSettingsCache";
import {
  publishViaMedia, reportLegacyOnlyPublish, reportMediaPathFailure,
} from "@/lib/media/postMediaWrite";
import { recoverPostByKey } from "./recoverPost";
import { PhotoRefused, type PhotoJob, type PhotoJobDeps } from "./photoJobs";

/**
 * The switch: site_settings `photo_upload_resume` = "on". Default OFF (row
 * absent or any other value) — the composer then uses today's path. Read
 * through the shared site-settings cache, at most a minute old.
 */
export const PHOTO_RESUME_KEY = "photo_upload_resume";
export async function photoResumeOn(): Promise<boolean> {
  try {
    return (await getSiteSetting(PHOTO_RESUME_KEY, { maxAgeMs: 60_000 })) === "on";
  } catch {
    return false;
  }
}

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
  if (!settled.error || isNetworkError(settled.error)) throw new Error(settled.error?.message ?? "publish: no answer");
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
