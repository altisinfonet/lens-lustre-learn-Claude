/**
 * S5-b · keeps the member's photo posts moving (the photo twin of
 * VideoUploadBridge, on the same shared upload layer).
 *
 * A photo post that was still going up when the app was closed, killed or
 * lost its link resumes here: on sign-in, when the network returns, and every
 * 15 s while one is still on its way. Same keys, same bytes, so it becomes
 * exactly one post. Renders nothing; a published post refreshes the feed and
 * the wall, a refused one is said out loud once. Does nothing at all while the
 * `photo_upload_resume` switch is off (no job is ever made then).
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { photoJobsFor, runPhotoJobs, subscribePhotoJobs } from "@/lib/upload/photoJobs";
import { realPhotoJobDeps } from "@/lib/upload/photoJobDeps";
import { useVisibilityInterval } from "@/lib/timers/visibilityInterval";

export const PHOTO_TICK_MS = 15000;

export default function PhotoUploadBridge() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    const kick = () => { void runPhotoJobs(userId, realPhotoJobDeps); };
    const off = subscribePhotoJobs((e) => {
      if (e.job.userId !== userId) return;
      if (e.type === "published") {
        void qc.invalidateQueries({ queryKey: ["feed"] });
        void qc.invalidateQueries({ queryKey: ["user-wall-posts"] });
        void qc.invalidateQueries({ queryKey: ["user-own-posts"] });
      } else if (e.type === "failed") {
        toast({ title: "Your post couldn't be published", description: e.job.lastError, variant: "destructive" });
      }
    });
    window.addEventListener("online", kick);
    kick();
    return () => { off(); window.removeEventListener("online", kick); };
  }, [qc, userId]);

  useVisibilityInterval(async () => {
    if (!userId) return;
    if ((await photoJobsFor(userId)).some((j) => j.step !== "failed")) void runPhotoJobs(userId, realPhotoJobDeps);
  }, userId ? PHOTO_TICK_MS : null, { runOnResume: true });

  return null;
}
