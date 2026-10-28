/**
 * VID-1 · keeps the member's video uploads moving.
 *
 * Runs every due job: on sign-in, when the network returns, and every 15 s
 * while any job is still on its way (uploading, or waiting for the server's
 * check). Lazy-loaded from App.tsx, so none of this is in the entry bundle.
 * A published video refreshes the feed and the wall; a refused one is said
 * out loud once.
 *
 * Server conversion: a server job reads its row at most every 30 s
 * (SOURCE_POLL_MS) on the same tick, and its state is shown by the small card
 * at the bottom of the app (ServerVideoJobs) — that card, not a toast, says
 * when it fails. Device jobs render nothing, as before.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { invalidateAdCreatives } from "@/lib/ads/adCreatives";
import { jobsFor, runVideoJobs, subscribeVideoJobs } from "@/lib/video/uploadJobs";
import { realJobDeps } from "@/lib/video/jobDeps";
import { useVisibilityInterval } from "@/lib/timers/visibilityInterval";
import ServerVideoJobs from "./ServerVideoJobs";

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
      const isAd = e.job.purpose === "ad"; // VID-5: an ad video goes on its ad, not into a post
      if (e.type === "published") {
        if (isAd) {
          invalidateAdCreatives();
          toast({ title: "Your ad video is live on the ad" });
        } else {
          void qc.invalidateQueries({ queryKey: ["feed"] });
          void qc.invalidateQueries({ queryKey: ["user-wall-posts"] });
          void qc.invalidateQueries({ queryKey: ["user-own-posts"] }); // S4-a
          toast({ title: "Your video is posted" });
        }
      } else if (e.type === "failed" && e.job.mode !== "server") {
        toast({ title: isAd ? "Your ad video couldn't be added" : "Your video couldn't be posted", description: e.job.lastError, variant: "destructive" });
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
    // "review" waits for the member's tap — nothing to tick for.
    const live = (await jobsFor(userId)).some((j) => !["failed", "music_blocked", "published", "review"].includes(j.step));
    if (live) void runVideoJobs(userId, realJobDeps);
  }, userId ? VIDEO_TICK_MS : null, { runOnResume: true });

  return userId ? <ServerVideoJobs userId={userId} /> : null;
}
