/**
 * VID-1 / R-104 · the video upload screen.
 *
 * What the member sees, in order:
 *   1. pick a video (one file);
 *   2. the PREVIEW, in the 9:16 VIDEO card (src/lib/video/videoFrame.ts —
 *      Owner 2026-10-05: every video is shown 9:16; any other shape is fitted
 *      whole, never cropped, with a blurred copy of the video filling the
 *      rest, as Instagram does), so what they see is what the post will be;
 *   3. the limits, said before anything is encoded (3 min / 500 MB; the server
 *      re-checks and also counts 10 a day);
 *   4. a caption, the audience and 1–5 categories (CategoryChips, required —
 *      the same rule as photos; the database backstops it: VID-CAT-001);
 *   5. Post → encode on the device (progress shown) → the upload job takes over,
 *      survives a dropped link or a closed app, and posts when the server says
 *      the video is ready.
 * Lazy-loaded; the encoder and its muxer load only when Post is pressed.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import CategoryChips, { canPublishCategories } from "@/components/post/CategoryChips";
import { PostAudienceChooser, type Privacy } from "@/components/post/PostAudienceChooser";
import { videoFrameAspect, videoNeedsFill } from "@/lib/video/videoFrame";
import { readVideoFacts, videoLimitProblems, formatDuration, type VideoFacts } from "@/lib/video/limits";
import { createJob, runVideoJobs } from "@/lib/video/uploadJobs";
import { realJobDeps } from "@/lib/video/jobDeps";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { useT } from "@/i18n/I18nContext";

export interface VideoPostComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** UI harness: open with this file already picked. */
  initialFile?: File;
  /** Test seam (the UI harness): skip the device encoder. */
  encode?: (file: File, opts: { mute: boolean; onProgress: (f: number) => void }) => Promise<{
    files: Map<string, Uint8Array>; manifest: import("@/lib/video/shared/rules").VideoManifest; manifestSha256: string;
  }>;
}

type Phase = { kind: "pick" } | { kind: "reading" } | { kind: "ready"; facts: VideoFacts } | { kind: "encoding"; facts: VideoFacts; progress: number } | { kind: "error"; message: string };

export default function VideoPostComposer({ open, onOpenChange, encode, initialFile }: VideoPostComposerProps) {
  const t = useT();
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [caption, setCaption] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [privacy, setPrivacy] = useState<Privacy>("public");
  const [mute, setMute] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    if (!open) { setFile(null); setUrl(null); setPhase({ kind: "pick" }); setCaption(""); setCategories([]); setMute(false); }
  }, [open]);

  useEffect(() => {
    if (open && initialFile) void pick(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);

  const facts = phase.kind === "ready" || phase.kind === "encoding" ? phase.facts : null;
  const problems = useMemo(() => (facts ? videoLimitProblems(facts, "post") : []), [facts]);
  const aspect = facts ? facts.width / facts.height : null;
  const frame = videoFrameAspect();
  const padded = videoNeedsFill(aspect);
  const canPost = phase.kind === "ready" && problems.length === 0 && canPublishCategories(categories) && !!user;

  async function pick(f: File | undefined) {
    if (!f) return;
    if (url) URL.revokeObjectURL(url);
    setFile(f);
    setUrl(URL.createObjectURL(f));
    setPhase({ kind: "reading" });
    try {
      setPhase({ kind: "ready", facts: await readVideoFacts(f) });
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message.replace(/^VID-[A-Z]+-\d+: /, "") });
    }
  }

  async function post() {
    if (!canPost || !file || !user || phase.kind !== "ready") return;
    const f = phase.facts;
    setPhase({ kind: "encoding", facts: f, progress: 0 });
    try {
      const onProgress = (p: number) => setPhase({ kind: "encoding", facts: f, progress: p });
      const pkg = encode
        ? await encode(file, { mute, onProgress })
        : await (await import("@/lib/video/webEncoder")).encodeVideoToHls(file, { mute, onProgress });
      await createJob({
        userId: user.id, purpose: "post", manifest: pkg.manifest, manifestSha256: pkg.manifestSha256, files: pkg.files,
        post: { content: caption.trim(), categories, privacy },
      });
      void runVideoJobs(user.id, realJobDeps);
      toast({ title: t("video.queued", "Your video is uploading"), description: t("video.queuedHint", "It will appear on your wall when it's ready. You can leave this screen.") });
      onOpenChange(false);
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (phase.kind !== "encoding") onOpenChange(o); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" data-testid="video-composer">
        {/* A plain column, not the dialog's grid: grid rows shrink under max-h and
            the aspect-ratio frame then paints over the rows below it. */}
        <div className="flex min-w-0 flex-col gap-3">
        <DialogTitle>{t("video.newTitle", "New video post")}</DialogTitle>
        <DialogDescription>{t("video.limits", "Up to 3 minutes and 500 MB.")}</DialogDescription>

        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          aria-label={t("video.choose", "Choose a video")}
          onChange={(e) => void pick(e.target.files?.[0])}
        />

        {!url && (
          <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => inputRef.current?.click()}>
            {t("video.choose", "Choose a video")}
          </Button>
        )}

        {url && (
          <div
            className="relative mx-auto w-full max-w-[min(100%,calc(62dvh*9/16))] shrink-0 overflow-hidden rounded-lg bg-black"
            style={{ aspectRatio: String(frame) }}
            data-testid="video-preview-frame"
            data-frame-aspect={frame.toFixed(3)}
          >
            {padded && (
              <video src={url} muted playsInline aria-hidden="true" tabIndex={-1}
                className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl" />
            )}
            <video src={url} muted playsInline controls className="relative h-full w-full object-contain"
              aria-label={t("video.preview", "Preview of your video")} />
          </div>
        )}

        {phase.kind === "reading" && <p className="text-sm text-muted-foreground">{t("video.reading", "Reading the video…")}</p>}
        {facts && (
          <p className="text-sm text-muted-foreground">
            {formatDuration(facts.durationSeconds)} · {Math.max(1, Math.round(facts.bytes / 1_048_576))} MB
          </p>
        )}
        {problems.length > 0 && (
          <ul className="space-y-1 text-sm text-destructive" role="alert">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        {phase.kind === "error" && <p className="text-sm text-destructive" role="alert">{phase.message}</p>}

        {url && (
          <>
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={t("video.caption", "Say something about this video…")}
              aria-label={t("video.caption", "Say something about this video…")}
              maxLength={2200}
            />
            <PostAudienceChooser value={privacy} onChange={setPrivacy} variant="row" rowLabel={t("composer.audience", "Post audience")} />
            <CategoryChips value={categories} onChange={setCategories} />
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} className="h-4 w-4" />
              {t("video.removeSound", "Remove sound")}
            </label>
          </>
        )}

        {phase.kind === "encoding" && (
          <div className="space-y-1" aria-live="polite">
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("video.preparing", "Preparing your video on this device…")} {Math.round(phase.progress * 100)}%
            </p>
          </div>
        )}

        <div className="flex gap-2">
          {url && phase.kind !== "encoding" && (
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => inputRef.current?.click()}>
              {t("video.change", "Change video")}
            </Button>
          )}
          <Button type="button" className="min-h-11 flex-1" disabled={!canPost} onClick={() => void post()}>
            {t("video.post", "Post video")}
          </Button>
        </div>
        {url && !canPublishCategories(categories) && (
          <p className="text-xs text-muted-foreground">{t("video.needsCategory", "Choose 1 to 5 categories to post.")}</p>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
