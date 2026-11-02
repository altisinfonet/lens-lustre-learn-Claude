/**
 * CAMERA DETAILS — READ AND HIDE (photo plan U2; database half U1a,
 * supabase/migrations/20261110_0100_photo_camera_info.sql).
 *
 * READ, BATCHED. post_photo_camera_for(p_post_ids uuid[]) answers for at most 50
 * posts (PHOTO-CAM-008) and follows can_view_post, like post_media_for. Each
 * card asks for its own post (so a hide/show refreshes one card), but every ask
 * made in the same tick is collected and sent together: a feed page renders
 * its cards in one commit, so a page costs ONE call (two above 50 posts) —
 * never one per post. Nothing here runs unless the caller's switch is on.
 *
 * HIDE. set_post_photo_camera_hidden(p_post_id, p_hidden) — author only, not
 * switch-gated on the server. Throws on refusal so the caller can say so.
 */
import { supabase } from "@/integrations/supabase/client";
import type { CameraInfo } from "@/lib/photoCamera";
import type { PhotoCameraRow } from "@/lib/photoCameraDisplay";

export const CAMERA_BATCH_MAX = 50;

type Rpc = (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, a) => (supabase.rpc as unknown as Rpc)(fn, a);

interface Waiter { resolve: (rows: PhotoCameraRow[]) => void; reject: (e: unknown) => void }
let pending = new Map<string, Waiter[]>();
let scheduled = false;

function parse(data: unknown): Map<string, PhotoCameraRow[]> {
  const out = new Map<string, PhotoCameraRow[]>();
  if (!Array.isArray(data)) return out;
  for (const r of data as Record<string, unknown>[]) {
    if (!r || typeof r.post_id !== "string" || typeof r.ord !== "number" || !Number.isInteger(r.ord)) continue;
    if (!r.info || typeof r.info !== "object" || Array.isArray(r.info)) continue;
    const list = out.get(r.post_id) ?? [];
    list.push({ ord: r.ord, info: r.info as CameraInfo, hidden: r.hidden === true });
    out.set(r.post_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.ord - b.ord);
  return out;
}

async function flush(): Promise<void> {
  const batch = pending;
  pending = new Map();
  scheduled = false;
  const ids = [...batch.keys()];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CAMERA_BATCH_MAX) chunks.push(ids.slice(i, i + CAMERA_BATCH_MAX));
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const { data, error } = await rpc("post_photo_camera_for", { p_post_ids: chunk });
        if (error) throw new Error(error.message || "post_photo_camera_for refused");
        const map = parse(data);
        for (const id of chunk) for (const w of batch.get(id) ?? []) w.resolve(map.get(id) ?? []);
      } catch (e) {
        for (const id of chunk) for (const w of batch.get(id) ?? []) w.reject(e);
      }
    }),
  );
}

/** The camera rows of one post, sent together with every other post asked for in the same tick. */
export function loadPostPhotoCamera(postId: string): Promise<PhotoCameraRow[]> {
  return new Promise((resolve, reject) => {
    const list = pending.get(postId) ?? [];
    list.push({ resolve, reject });
    pending.set(postId, list);
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => { void flush(); }, 0);
    }
  });
}

/** The author hides (true) or shows (false) the post's camera details. Throws on refusal. */
export async function setPostPhotoCameraHidden(postId: string, hidden: boolean): Promise<boolean> {
  const { data, error } = await rpc("set_post_photo_camera_hidden", { p_post_id: postId, p_hidden: hidden });
  if (error) throw new Error(error.message || "set_post_photo_camera_hidden refused");
  return data === true;
}
