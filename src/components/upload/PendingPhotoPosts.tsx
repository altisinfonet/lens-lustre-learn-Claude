/**
 * S7b-5b · the member's posts with photos that are kept on the phone and not
 * published yet (made with no network, or still uploading), shown at once with
 * "Will post when online". The job publishes each exactly once (its id is the
 * post's idempotency key, S5); the card goes when it is published, and a
 * refusal is announced by PhotoUploadBridge.
 */
import { useEffect, useState } from "react";
import { Clock, ImageIcon } from "lucide-react";
import { useAuth } from "@/hooks/core/useAuth";
import { photoJobsFor, subscribePhotoJobs, type PhotoJob } from "@/lib/upload/photoJobs";

export default function PendingPhotoPosts() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [jobs, setJobs] = useState<PhotoJob[]>([]);
  useEffect(() => {
    if (!userId) { setJobs([]); return; }
    let live = true;
    // Only the newest read may answer: an older one that finishes last would
    // bring back a post already published (review #583).
    let latest = 0;
    const read = () => {
      const mine = ++latest;
      void photoJobsFor(userId).then((all) => {
        if (live && mine === latest) setJobs(all.filter((j) => j.step !== "published" && j.step !== "failed"));
      });
    };
    read();
    const stop = subscribePhotoJobs((e) => { if (e.type !== "progress") read(); });
    return () => { live = false; stop(); };
  }, [userId]);
  if (jobs.length === 0) return null;
  return (
    <div className="space-y-2 mb-3" data-testid="pending-photo-posts">
      {jobs.map((j) => (
        <div key={j.id} className="border border-dashed border-border rounded-xl p-3 text-sm">
          {j.post.content && <p className="text-foreground line-clamp-2">{j.post.content}</p>}
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {j.slots.length === 1 ? "1 photo" : `${j.slots.length} photos`}
            <Clock className="h-3.5 w-3.5 ml-2" aria-hidden="true" />
            Will post when online
          </p>
        </div>
      ))}
    </div>
  );
}
