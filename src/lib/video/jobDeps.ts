/**
 * VID-1 · the real JobDeps: Supabase (as the member), the Pages Functions, and
 * the PUT to R2. Kept apart from uploadJobs.ts so the job logic is tested with
 * fakes and this file stays a thin, readable adapter.
 */
import { onlineManager } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getNetState } from "@/lib/offline/networkQuality";
import type { JobDeps } from "./uploadJobs";

type Err = { message: string; code?: string } | null;
// The video tables are new (D1 #378–#380); the generated types catch up when
// D1 regenerates them. Until then they are addressed through this narrow,
// honest shape — only the calls this file makes — rather than `any`.
type Res = { data: Record<string, unknown> | null; error: Err };
interface Chain extends PromiseLike<Res> {
  select(columns: string): Chain;
  eq(column: string, value: unknown): Chain;
  insert(row: unknown): Chain;
  maybeSingle(): PromiseLike<Res>;
  single(): PromiseLike<Res>;
}
interface LooseDb {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: Err }>;
  from(table: string): Chain;
}
const db = supabase as unknown as LooseDb;

async function bearer(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export const realJobDeps: JobDeps = {
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    return { data, error: error as Err };
  },
  videoState: async (videoId) => {
    const { data, error } = await db.from("videos").select("state").eq("id", videoId).maybeSingle();
    if (error) throw error;
    return (data?.state as string | undefined) ?? null;
  },
  insertPost: async (row) => {
    const { data, error } = await db.from("posts").insert(row).select("id").single();
    return { id: (data?.id as string | undefined) ?? null, error: error as Err };
  },
  findPostByKey: async (userId, key) => {
    const { data } = await db.from("posts").select("id").eq("user_id", userId).eq("idempotency_key", key).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  },
  insertPostVideo: async (postId, videoId) => {
    const { error } = await db.from("post_videos").insert({ post_id: postId, video_id: videoId });
    return { error: error as Err };
  },
  api: async (path, body) => {
    const token = await bearer();
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    let parsed: Record<string, unknown> = {};
    try { parsed = (await res.json()) as Record<string, unknown>; } catch { /* a non-JSON error page */ }
    return { status: res.status, body: parsed };
  },
  put: async (url, headers, data) => {
    const res = await fetch(url, { method: "PUT", headers, body: data });
    return res.status;
  },
  online: () => onlineManager.isOnline() && getNetState().online,
  now: () => Date.now(),
};
