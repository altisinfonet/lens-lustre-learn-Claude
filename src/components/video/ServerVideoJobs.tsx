/**
 * VID-1 · SERVER CONVERSION, AS THE MEMBER SEES IT (CONVERTER-DESIGN.md v2 §3, §8).
 *
 * A small card at the bottom of the app for each video our server is
 * preparing — on every screen, so the member may leave the composer, the
 * page, even the app, and find it again where they left it (the jobs live on
 * the device, uploadJobs.ts):
 *
 *   uploading   "Uploading your video… 42%" — you can close this page at 100%
 *   preparing   "Your video is being prepared on our server" — we'll show it here
 *   ready       "Your video is ready" → Preview → Post (the member publishes, §3.9)
 *   failed      the database's own fixed text for the reason, word for word
 *
 * Cancel asks first (an upload of hundreds of MB is not undone by accident),
 * then POSTs /api/video/source-cancel. Device-prepared videos never appear
 * here: their path is unchanged and says itself in toasts.
 *
 * Mounted by VideoUploadBridge (lazy, signed-in only). Renders nothing until
 * a server job exists.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Server, UploadCloud, X, type LucideIcon } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/core/use-toast";
import { useT } from "@/i18n/I18nContext";
import {
  cancelServerJob, dismissServerJob, jobsFor, subscribeVideoJobs, uploadProgress, type VideoJob,
} from "@/lib/video/uploadJobs";
import { realJobDeps } from "@/lib/video/jobDeps";
import { withoutCode } from "@/lib/video/startOnServer";

const ServerVideoReview = lazy(() => import("./ServerVideoReview"));

type T = (key: string, fallback: string) => string;
type Action = "cancel" | "preview" | "dismiss" | null;
export interface JobView {
  tone: "busy" | "ready" | "error";
  icon: LucideIcon;
  spin?: boolean;
  title: string;
  detail: string;
  /** a percentage, "indeterminate" (a moving bar), or no bar */
  bar: number | "indeterminate" | null;
  action: Action;
}

/** What a failed server job says: the database's own words for a conversion failure, never a code. */
export function failureText(j: VideoJob, t: T): string {
  switch (j.errorCode) {
    case "VID-SRC-FAILED": return j.lastError ?? t("video.srv.failedFallback", "Converting this video failed. Please try again.");
    case "VID-SRC-001": return t("video.srv.switchedOff", "Server conversion was switched off before your video was sent. Please post it again.");
    case "VID-RETRIES": return t("video.srv.retries", "The upload kept failing. Check your connection, then post it again.");
    default: return withoutCode(j.lastError) || t("video.srv.failedFallback", "Converting this video failed. Please try again.");
  }
}

/** One job's card, in words. `pct` is the upload's progress, or undefined when it is not going up right now. */
export function jobView(j: VideoJob, pct: number | undefined, t: T): JobView {
  const ad = j.purpose === "ad";
  switch (j.step) {
    case "source":
      return pct === undefined
        ? { tone: "busy", icon: UploadCloud, title: ad ? t("video.srv.waitAd", "Your ad video is waiting to upload") : t("video.srv.wait", "Your video is waiting to upload"),
            detail: t("video.srv.waitHint", "It starts by itself as soon as it can."), bar: "indeterminate", action: "cancel" }
        : { tone: "busy", icon: UploadCloud, title: `${ad ? t("video.srv.uploadingAd", "Uploading your ad video…") : t("video.srv.uploading", "Uploading your video…")} ${pct}%`,
            detail: t("video.srv.uploadingHint", "You can close this page once it reaches 100%."), bar: pct, action: "cancel" };
    case "converting":
      return { tone: "busy", icon: Server,
        title: ad ? t("video.srv.preparingAd", "Your ad video is being prepared on our server") : t("video.srv.preparing", "Your video is being prepared on our server"),
        detail: t("video.srv.preparingHint", "We'll show it here when it's ready. You can leave this page."), bar: "indeterminate", action: "cancel" };
    case "checking":
      return { tone: "busy", icon: Server, title: t("video.srv.checking", "Almost ready…"),
        detail: t("video.srv.checkingHint", "Running the last checks on your video."), bar: "indeterminate", action: "cancel" };
    case "review":
      return { tone: "ready", icon: CheckCircle2,
        title: ad ? t("video.srv.readyAd", "Your ad video is ready") : t("video.srv.ready", "Your video is ready"),
        detail: ad ? t("video.srv.readyAdHint", "Preview it, then add it to the ad.") : t("video.srv.readyHint", "Preview it, then post it."), bar: null, action: "preview" };
    case "ready":
      return { tone: "busy", icon: Loader2, spin: true,
        title: ad ? t("video.srv.postingAd", "Adding the video to the ad…") : t("video.srv.posting", "Posting your video…"),
        detail: "", bar: "indeterminate", action: null };
    case "music_blocked":
      return { tone: "error", icon: AlertCircle,
        title: ad ? t("video.srv.blockedAd", "This ad video can't be used") : t("video.srv.blocked", "This video can't be posted"),
        detail: t("video.srv.blockedHint", "Copyrighted music was found in it."), bar: null, action: "dismiss" };
    default:
      // Made, then refused at Post (or at the ad's link): the device path's own words for that.
      return { tone: "error", icon: AlertCircle,
        title: j.videoId
          ? (ad ? t("video.srv.notAddedAd", "Your ad video couldn't be added") : t("video.srv.notPosted", "Your video couldn't be posted"))
          : (ad ? t("video.srv.failedAd", "Your ad video couldn't be prepared") : t("video.srv.failed", "Your video couldn't be prepared")),
        detail: failureText(j, t), bar: null, action: "dismiss" };
  }
}

const TONE: Record<JobView["tone"], string> = {
  busy: "bg-primary/10 text-primary",
  ready: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-destructive/10 text-destructive",
};

/** The cards themselves — props only, so the UI harness and the tests draw every state. */
export function ServerJobsTray({ jobs, progress, pendingId, onPreview, onCancel, onDismiss }: {
  jobs: VideoJob[];
  progress: Record<string, number | undefined>;
  pendingId?: string | null;
  onPreview: (j: VideoJob) => void;
  onCancel: (j: VideoJob) => void;
  onDismiss: (j: VideoJob) => void;
}) {
  const t = useT() as T;
  if (jobs.length === 0) return null;
  return (
    <section
      aria-label={t("video.srv.region", "Your videos on our server")}
      className="pointer-events-none fixed inset-x-3 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-[45] mx-auto flex max-w-md flex-col gap-2 lg:inset-x-auto lg:bottom-6 lg:left-6 lg:mx-0 lg:w-[22rem]"
      data-testid="server-video-jobs"
    >
      {jobs.map((j) => {
        const v = jobView(j, progress[j.id], t);
        const Icon = v.icon;
        const pending = pendingId === j.id;
        return (
          <div key={j.id} data-testid="server-job" data-step={j.step}
            className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-card/95 py-1.5 pl-3 pr-1.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE[v.tone]}`}>
              <Icon className={`h-[18px] w-[18px] ${v.spin ? "animate-spin" : ""}`} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1 py-1" role={v.tone === "error" ? "alert" : "status"} aria-live="polite">
              {/* Two lines at most, never cut mid-word: the Owner's sentences are longer than a 360px phone. */}
              <p className="line-clamp-2 text-sm font-medium leading-snug">{v.title}</p>
              {v.detail && <p className="mt-0.5 line-clamp-3 text-xs leading-snug text-muted-foreground">{v.detail}</p>}
              {typeof v.bar === "number" && (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted" role="progressbar"
                  aria-label={t("video.srv.progress", "Upload progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.bar}>
                  <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${v.bar}%` }} />
                </div>
              )}
              {/* Working, length unknown: a moving sliver. Without motion it is left out — a still full bar would read "done". */}
              {v.bar === "indeterminate" && (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted motion-reduce:hidden" aria-hidden="true">
                  <div className="h-full w-1/2 rounded-full bg-primary/70 animate-shimmer" />
                </div>
              )}
            </div>
            {v.action === "preview" && (
              <Button type="button" size="sm" className="min-h-11 shrink-0 px-4" onClick={() => onPreview(j)}>
                {t("video.srv.preview", "Preview")}
              </Button>
            )}
            {(v.action === "cancel" || v.action === "dismiss") && (
              <button type="button" disabled={pending}
                onClick={() => (v.action === "cancel" ? onCancel(j) : onDismiss(j))}
                aria-label={v.action === "cancel" ? t("video.srv.cancel", "Cancel this video") : t("video.srv.dismiss", "Dismiss")}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

export default function ServerVideoJobs({ userId }: { userId: string }) {
  const t = useT() as T;
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [progress, setProgress] = useState<Record<string, number | undefined>>({});
  const [reviewing, setReviewing] = useState<VideoJob | null>(null);
  const [confirming, setConfirming] = useState<VideoJob | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const mine = (await jobsFor(userId)).filter((j) => j.mode === "server");
      if (!live) return;
      setJobs(mine);
      // From where each upload really is — also for a screen opened mid-upload.
      const next: Record<string, number | undefined> = {};
      for (const j of mine) {
        const u = j.step === "source" ? uploadProgress(j.id) : undefined;
        next[j.id] = u ? pctOf(u.sent, u.total) : undefined;
      }
      setProgress(next);
    };
    void load();
    const off = subscribeVideoJobs((e) => {
      if (e.job.userId !== userId || e.job.mode !== "server") return;
      if (e.type === "progress") { setProgress((p) => ({ ...p, [e.job.id]: pctOf(e.sent, e.total) })); return; }
      void load();
    });
    return () => { live = false; off(); };
  }, [userId]);

  async function cancel(j: VideoJob) {
    setConfirming(null);
    setPendingId(j.id);
    const ok = await cancelServerJob(j.id, realJobDeps);
    setPendingId(null);
    if (!ok) toast({ title: t("video.srv.cancelFailed", "Couldn't cancel it just now"), description: t("video.srv.cancelFailedHint", "Check your connection and try again."), variant: "destructive" });
  }

  return (
    <>
      <ServerJobsTray jobs={jobs} progress={progress} pendingId={pendingId}
        onPreview={setReviewing} onCancel={setConfirming} onDismiss={(j) => void dismissServerJob(j.id)} />
      <AlertDialog open={!!confirming} onOpenChange={(o) => { if (!o) setConfirming(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("video.srv.cancelTitle", "Cancel this video?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.step === "source"
                ? t("video.srv.cancelUpload", "The upload stops and nothing is posted.")
                : t("video.srv.cancelPrepare", "Our server stops preparing it and nothing is posted.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t("video.srv.keep", "Keep it")}</AlertDialogCancel>
            <AlertDialogAction className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirming) void cancel(confirming); }}>
              {t("video.srv.cancelConfirm", "Cancel video")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {reviewing && (
        <Suspense fallback={null}>
          <ServerVideoReview job={reviewing} onClose={() => setReviewing(null)} />
        </Suspense>
      )}
    </>
  );
}

function pctOf(sent: number, total: number): number {
  return Math.min(100, Math.max(0, Math.floor((sent / Math.max(1, total)) * 100)));
}
