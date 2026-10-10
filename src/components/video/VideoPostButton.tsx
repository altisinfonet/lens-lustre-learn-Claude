/**
 * VID-7 · the "Add video" button next to "Add photo" — shown ONLY when
 * `video_posts` is switched on for this member (Off / Selected members /
 * All members, Admin → Features). Hidden is the default: with the switch Off
 * the composer is exactly what it was before video existed.
 *
 * The composer (and the encoder behind it) is lazy-loaded on the first tap,
 * so members without the feature never download any of it (P13).
 */
import { Suspense, lazy, useState } from "react";
import { Video } from "lucide-react";
import { useFeatureAllowed } from "@/hooks/core/useFeatureAllowed";
import { useT } from "@/i18n/I18nContext";

const VideoPostComposer = lazy(() => import("./VideoPostComposer"));

export default function VideoPostButton() {
  const allowed = useFeatureAllowed("video_posts");
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("video.add", "Add video")}
        title={t("video.add", "Add video")}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors hover:bg-muted/50"
        data-testid="video-post-button"
      >
        <Video className="h-5 w-5 text-primary" />
      </button>
      {open && (
        <Suspense fallback={null}>
          <VideoPostComposer open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  );
}
