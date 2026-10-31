/**
 * VID-1 · THE MEMBER WATCHES IT, THEN POSTS IT (CONVERTER-DESIGN.md v2 §3.9).
 *
 * A server-made video is never published by the server. When it is READY,
 * the member opens it here, watches it in the same 9:16 card the feed uses
 * (FeedVideoCard: the real stream, through a play token as its owner), and
 * taps Post — then the job publishes it exactly as a device-made video is
 * published: video_publish_post with the caption, categories and audience
 * they chose in the composer (kept with the job). An ad video goes on its
 * ad instead (linkAdVideo). That look-then-post step is also the check
 * against a converter that hands back something else.
 *
 * Discard asks once more, then deletes the made video (video_delete) —
 * nothing else would ever post it.
 */
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PRIVACY_OPTIONS, privacyIcon } from "@/components/post/PostAudienceChooser";
import { categoryLabelKey } from "@/lib/categories";
import { useCategories } from "@/hooks/useCategories";
import { useT } from "@/i18n/I18nContext";
import { approveServerJob, cancelServerJob, type VideoJob } from "@/lib/video/uploadJobs";
import { realJobDeps } from "@/lib/video/jobDeps";
import { fetchOwnVideo, type FeedVideo } from "@/lib/video/postVideoRead";
import { adMedia, NO_MEDIA, postMedia } from "@/lib/posts/subjectMedia";
import { videoFrameAspect } from "@/lib/video/videoFrame";

const FeedVideoCard = lazy(() => import("./FeedVideoCard"));

export interface ServerVideoReviewProps {
  job: VideoJob;
  onClose: () => void;
  /** UI harness: the video's facts, instead of reading them. */
  video?: FeedVideo;
  /** UI harness: what stands in for the player (it would ask for a play token). */
  renderPlayer?: (v: FeedVideo) => ReactNode;
}

export default function ServerVideoReview({ job, onClose, video: given, renderPlayer }: ServerVideoReviewProps) {
  const t = useT();
  const ad = job.purpose === "ad";
  /** undefined = reading; null = not playable (any more) */
  const [video, setVideo] = useState<FeedVideo | null | undefined>(given);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: allCategories = [] } = useCategories();
  const frame = videoFrameAspect();

  useEffect(() => {
    if (given || !job.videoId) return;
    let live = true;
    fetchOwnVideo(job.videoId).then((v) => { if (live) setVideo(v); }).catch(() => { if (live) setVideo(null); });
    return () => { live = false; };
  }, [given, job.videoId]);

  async function post() {
    setBusy(true);
    onClose(); // the card at the bottom shows "Posting your video…", then the toast says it is posted
    await approveServerJob(job.id, realJobDeps);
  }

  async function discard() {
    if (!confirmDiscard) { setConfirmDiscard(true); return; }
    setBusy(true);
    setError(null);
    const ok = await cancelServerJob(job.id, realJobDeps);
    setBusy(false);
    if (ok) onClose();
    else setError(t("video.srv.discardFailed", "Couldn't discard it just now. Check your connection and try again."));
  }

  // What the post (or ad) WILL show — the one decision every screen draws (subjectMedia, #415).
  const media = video ? (ad ? adMedia({ video }) : postMedia({ video })) : NO_MEDIA;
  const audience = PRIVACY_OPTIONS.find((o) => o.value === job.post.privacy) ?? PRIVACY_OPTIONS[0];
  // Named exactly as the category chips name them (the same cached list).
  const names = new Map(allCategories.map((c) => [c.slug, c.name]));
  const categories = job.post.categories.map((c) => t(categoryLabelKey(c), names.get(c) ?? c));

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" data-testid="server-video-review">
        <div className="flex min-w-0 flex-col gap-3">
          <DialogTitle>{ad ? t("video.srv.readyAd", "Your ad video is ready") : t("video.srv.ready", "Your video is ready")}</DialogTitle>
          <DialogDescription>
            {ad ? t("video.srv.reviewAd", "Watch it, then add it to the ad.") : t("video.srv.review", "This is how it will look. Post it when you're happy.")}
          </DialogDescription>

          <div className="relative w-full shrink-0 overflow-hidden rounded-lg bg-black"
            style={{ width: "100%", aspectRatio: String(frame), maxHeight: "62dvh" }} data-testid="server-video-review-frame">
            {media.video ? (
              renderPlayer ? renderPlayer(media.video) : (
                <Suspense fallback={null}><FeedVideoCard video={media.video} fillParent /></Suspense>
              )
            ) : (
              <div className="flex h-full w-full items-center justify-center px-6 text-center text-xs text-white/70">
                {video === undefined
                  ? <Loader2 className="h-6 w-6 animate-spin" aria-label={t("video.srv.loading", "Loading your video…")} />
                  : t("video.srv.unavailable", "This video can't be played right now. Try again in a moment.")}
              </div>
            )}
          </div>

          {/* pre-line, not pre-wrap: the member's line breaks stay, and no space hangs past the edge at a wrap. */}
          {!ad && job.post.content && <p className="line-clamp-4 whitespace-pre-line break-words text-sm">{job.post.content}</p>}
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            {!ad && <><span className="inline-flex items-center gap-1">{privacyIcon(audience.value)}{audience.label}</span><span aria-hidden="true">·</span></>}
            <span className="min-w-0">{categories.join(", ")}</span>
          </p>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {confirmDiscard && !error && (
            <p className="text-xs text-muted-foreground">
              {t("video.srv.discardHint", "Tap Discard again to delete this video. It won't be posted.")}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="ghost" className={`min-h-11 ${confirmDiscard ? "text-destructive hover:text-destructive" : ""}`}
              disabled={busy} onClick={() => void discard()}>
              {t("video.srv.discard", "Discard")}
            </Button>
            <Button type="button" className="min-h-11 flex-1" disabled={busy || !media.video} onClick={() => void post()}>
              {ad ? t("video.srv.addToAd", "Add to the ad") : t("video.post", "Post video")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
