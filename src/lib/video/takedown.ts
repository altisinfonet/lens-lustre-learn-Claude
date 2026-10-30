/**
 * S7-b · VID-4: an admin takes a reported video down (POST /api/video/takedown).
 * The database decides (admin only, ready videos only, idempotent); the route
 * also puts the video on the media-authz Worker's revoked list when the lane
 * has that list bound. Copyright reports (reason "copyright_music") come from
 * the post menu while the `video_report_copyright` switch is on.
 */
import { supabase } from "@/integrations/supabase/client";
import { getSiteSetting } from "@/lib/siteSettingsCache";
import { SITE_API, siteFetch } from "@/lib/net/siteApi";

/** The reason a member's copyright report is stored with (VID-1 DECISION §10). */
export const COPYRIGHT_REASON = "copyright_music";
/** Member-visible "Copyright (music)" report reason. Default OFF: absent row or anything but "on". */
export const VIDEO_REPORT_COPYRIGHT_KEY = "video_report_copyright";

export async function videoCopyrightReportOn(): Promise<boolean> {
  try {
    return (await getSiteSetting(VIDEO_REPORT_COPYRIGHT_KEY, { maxAgeMs: 60_000 })) === "on";
  } catch {
    return false;
  }
}

export interface TakedownResult { status: "taken_down" | "already"; revokedList: boolean }

export async function takedownVideo(
  videoId: string, reportId: string | null, reason: string | null,
  deps: { fetch?: typeof siteFetch; token?: () => Promise<string | null> } = {},
): Promise<TakedownResult> {
  const token = await (deps.token ?? (async () => (await supabase.auth.getSession()).data.session?.access_token ?? null))();
  const res = await (deps.fetch ?? siteFetch)(SITE_API.videoTakedown, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ video_id: videoId, report_id: reportId, reason }),
  });
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* a non-JSON error page */ }
  if (!res.ok) throw new Error(typeof body.message === "string" ? body.message : `Takedown failed (HTTP ${res.status})`);
  return { status: body.status === "already" ? "already" : "taken_down", revokedList: body.revoked_list === true };
}
