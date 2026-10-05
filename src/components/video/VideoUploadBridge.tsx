/**
 * VID-1 · keeps the member's video uploads moving. Renders nothing.
 *
 * Runs every due job: on sign-in, when the network returns, and every 15 s
 * while any job is still on its way (uploading, or waiting for the server's
 * check). Lazy-loaded from App.tsx, so none of this is in the entry bundle.
 * A published video refreshes the feed and the wall; a refused one is said
 * out loud once.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { jobsFor, runVideoJobs, subscribeVideoJobs } from "@/lib/video/uploadJobs";
import { realJobDeps } from "@/lib/video/jobDeps";
import { useVisibilityInterval } from "@/lib/timers/visibilityInterval";

/** P10: 15 s while a job is still on its way; stops while the app is hidden. */
export const VIDEO_TICK_MS = 15000;

export default function VideoUploadBridge() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    const kick = () => { void runVideoJobs(userId, realJobDeps); };
    const off = subscribeVideoJobs((e) => {
      if (e.job.userId !== userId) return;
      if (e.type === "published") {
        void qc.invalidateQueries({ queryKey: ["feed"] });
        void qc.invalidateQueries({ queryKey: ["user-wall-posts"] });
        toast({ title: "Your video is posted" });
      } else if (e.type === "failed") {
        toast({ title: "Your video couldn't be posted", description: e.job.lastError, variant: "destructive" });
      }
    });
    window.addEventListener("online", kick);
    kick();
    return () => { off(); window.removeEventListener("online", kick); };
  }, [qc, userId]);

  // P10: through the visibility-aware timer — a hidden app does not wake every
  // 15 s; on return it ticks at once and carries on.
  useVisibilityInterval(async () => {
    if (!userId) return;
    const live = (await jobsFor(userId)).some((j) => !["failed", "music_blocked", "published"].includes(j.step));
    if (live) void runVideoJobs(userId, realJobDeps);
  }, userId ? VIDEO_TICK_MS : null, { runOnResume: true });

  return null;
}
