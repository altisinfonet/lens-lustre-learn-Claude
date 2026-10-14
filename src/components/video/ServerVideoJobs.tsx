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
 * then stops the upload and tells the server (POST /api/video/source-cancel,
 * or the member's own RPC when Pages cannot answer). Dismiss, on a failed
 * card, does the same: whatever the server still holds for that job is
 * stopped or deleted, so a put-away card never keeps one of the member's two
 * places in the queue. Device-prepared videos never appear here: their path
 * is unchanged and says itself in toasts.
 *
 * ONE SLIM LINE ON A PHONE (Owner, 2026-10-13: on a first visit the cookie
 * banner, this panel and "Ask anything" covered about three quarters of the
 * screen). Below 1024px the panel folds to a single 44px line — "2 videos ·
 * 1 ready to post" — whenever there is more than one job, or a banner (cookie
 * consent, app update) is up. A tap opens the list; "Show less" folds it
 * again. One job with nothing else on the screen keeps its full card; a
 * computer always shows the list (it has the room, in the bottom-left corner).
 * The open list scrolls inside the room that is really left, so the stack can
 * never grow off a short screen.
 *
 * It lives in the BOTTOM DOCK (src/lib/ui/bottomDock.ts): above the bottom bar,
 * the cookie banner and the update prompt, and the round buttons (Ask
 * anything, Back to top) rise above it while it shows — nothing overlaps.
 *
 * It is drawn at the END of the document (a portal): it sits at the bottom of
 * the screen, so its buttons come after the page's in Tab order — mounted
 * where VideoUploadBridge is (before the routes) they were the first stops on
 * every page.
 *
 * Mounted by VideoUploadBridge (lazy, signed-in only). Renders nothing until
 * a server job exists.
 */
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Loader2, Server, UploadCloud, X, type LucideIcon } from "lucide-react";
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
import { useDockLayer, useDockShowing, type DockLayer } from "@/lib/ui/bottomDock";

const ServerVideoReview = lazy(() => import("./ServerVideoReview"));

type T = (key: string, fallback: string) => string;
type Action = "cancel" | "preview" | "dismiss" | null;
export interface JobView {
  tone: "busy" | "ready" | "error";
  icon: LucideIcon;
  spin?: boolean;
  /** What is SHOWN — with the upload's percentage. */
  title: string;
  /** What is SAID to a screen reader: the same, without the percentage (it changes a hundred times an upload). */
  spoken: string;
  detail: string;
  /** a percentage, "indeterminate" (a moving bar), or no bar */
  bar: number | "indeterminate" | null;
  action: Action;
}

/**
 * What a failed server job says — always a plain sentence, never a code, a
 * raw state ("the video is taken_down") or a Pages Function's own short
 * answer ("no such video of yours", "sign in first"). A conversion failure is
 * the database's own fixed, member-safe text, word for word.
 */
export function failureText(j: VideoJob, t: T): string {
  const code = j.errorCode ?? "";
  const fallback = t("video.srv.failedFallback", "Converting this video failed. Please try again.");
  if (code === "VID-SRC-FAILED") return j.lastError ?? fallback;
  if (code === "VID-SRC-001") return t("video.srv.switchedOff", "Server conversion was switched off before your video was sent. Please post it again.");
  if (code === "VID-RETRIES") return t("video.srv.retries", "The upload kept failing. Check your connection, then post it again.");
  // The server no longer has it (uploadJobs.ts VIDEO_REMOVED_TEXT — the same words).
  if (code === "VID-SRC-GONE" || code === "VID-SRC-004" || code === "VID-GONE") {
    return t("video.srv.gone", "This video was removed because it was not posted within 30 days. Please post it again.");
  }
  if (code.startsWith("VID-AUTH")) return t("video.srv.signIn", "Please sign in again, then post the video again.");
  if (code === "VID-STATE") {
    const state = /the video is (\w+)/.exec(j.lastError ?? "")?.[1];
    if (state === "taken_down") return t("video.srv.takenDown", "This video was taken down, so it can't be posted.");
    if (state === "deleted") return t("video.srv.deleted", "This video was deleted before it was posted.");
    return t("video.srv.checksFailed", "Our checks couldn't finish this video. Please post it again.");
  }
  // A request our own app got wrong, or a server not set up: nothing the member can act on but trying again.
  if (/^VID-(REQ|ENV)-/.test(code) || code === "VID-SRC-009" || code === "VID-SRC-011" || code === "VID-LOCAL-002") {
    return t("video.srv.technical", "Something went wrong sending this video. Please post it again.");
  }
  return withoutCode(j.lastError) || fallback;
}

/** One job's card, in words. `pct` is the upload's progress, or undefined when it is not going up right now. */
export function jobView(j: VideoJob, pct: number | undefined, t: T): JobView {
  const ad = j.purpose === "ad";
  const said = (v: Omit<JobView, "spoken">): JobView => ({ ...v, spoken: v.title });
  switch (j.step) {
    case "source": {
      if (pct === undefined) {
        return said({ tone: "busy", icon: UploadCloud, title: ad ? t("video.srv.waitAd", "Your ad video is waiting to upload") : t("video.srv.wait", "Your video is waiting to upload"),
          detail: t("video.srv.waitHint", "It starts by itself as soon as it can."), bar: "indeterminate", action: "cancel" });
      }
      const words = ad ? t("video.srv.uploadingAd", "Uploading your ad video…") : t("video.srv.uploading", "Uploading your video…");
      return { tone: "busy", icon: UploadCloud, title: `${words} ${pct}%`, spoken: words,
        detail: t("video.srv.uploadingHint", "You can close this page once it reaches 100%."), bar: pct, action: "cancel" };
    }
    case "converting":
      return said({ tone: "busy", icon: Server,
        title: ad ? t("video.srv.preparingAd", "Your ad video is being prepared on our server") : t("video.srv.preparing", "Your video is being prepared on our server"),
        detail: t("video.srv.preparingHint", "We'll show it here when it's ready. You can leave this page."), bar: "indeterminate", action: "cancel" });
    case "checking":
      return said({ tone: "busy", icon: Server, title: t("video.srv.checking", "Almost ready…"),
        detail: t("video.srv.checkingHint", "Running the last checks on your video."), bar: "indeterminate", action: "cancel" });
    case "review":
      return said({ tone: "ready", icon: CheckCircle2,
        title: ad ? t("video.srv.readyAd", "Your ad video is ready") : t("video.srv.ready", "Your video is ready"),
        detail: ad ? t("video.srv.readyAdHint", "Preview it, then add it to the ad.") : t("video.srv.readyHint", "Preview it, then post it."), bar: null, action: "preview" });
    case "ready":
      return said({ tone: "busy", icon: Loader2, spin: true,
        title: ad ? t("video.srv.postingAd", "Adding the video to the ad…") : t("video.srv.posting", "Posting your video…"),
        detail: "", bar: "indeterminate", action: null });
    case "music_blocked":
      return said({ tone: "error", icon: AlertCircle,
        title: ad ? t("video.srv.blockedAd", "This ad video can't be used") : t("video.srv.blocked", "This video can't be posted"),
        detail: t("video.srv.blockedHint", "Copyrighted music was found in it."), bar: null, action: "dismiss" });
    default:
      // Made, then refused at Post (or at the ad's link): the device path's own words for that.
      return said({ tone: "error", icon: AlertCircle,
        title: j.videoId
          ? (ad ? t("video.srv.notAddedAd", "Your ad video couldn't be added") : t("video.srv.notPosted", "Your video couldn't be posted"))
          : (ad ? t("video.srv.failedAd", "Your ad video couldn't be prepared") : t("video.srv.failed", "Your video couldn't be prepared")),
        detail: failureText(j, t), bar: null, action: "dismiss" });
  }
}

export interface TrayLine {
  tone: JobView["tone"];
  icon: LucideIcon;
  spin?: boolean;
  /** The one line: how many, then the most urgent thing among them. */
  text: string;
  /** The same without the percentage — what is said when the state changes. */
  spoken: string;
  /** The upload's progress, when an upload is what the line is about. */
  pct?: number;
}

/**
 * The folded panel's single line. One job: what it is doing. More: the count,
 * then the most urgent state — something needs attention › something is ready
 * to post › uploading › posting › being prepared.
 */
export function trayLine(jobs: VideoJob[], progress: Record<string, number | undefined>, t: T): TrayLine {
  const up = jobs.find((j) => j.step === "source" && progress[j.id] !== undefined);
  const pct = up ? progress[up.id] : undefined;
  if (jobs.length === 1) {
    const j = jobs[0];
    const ad = j.purpose === "ad";
    const v = jobView(j, progress[j.id], t);
    const as = (text: string, spoken = text): TrayLine => ({ tone: v.tone, icon: v.icon, spin: v.spin, text, spoken });
    if (j.step === "source" && pct !== undefined) {
      const words = ad ? t("video.srv.lineUploadingAd", "Uploading your ad video") : t("video.srv.lineUploading", "Uploading your video");
      return { ...as(`${words} · ${pct}%`, words), pct };
    }
    if (j.step === "converting" || j.step === "checking") return as(ad ? t("video.srv.linePreparingAd", "Preparing your ad video") : t("video.srv.linePreparing", "Preparing your video"));
    if (j.step === "review") return as(ad ? v.title : t("video.srv.lineReady", "Your video is ready to post"));
    return as(v.title);
  }
  const count = t("video.srv.lineCount", "{n} videos").replace("{n}", String(jobs.length));
  const many = (tone: JobView["tone"], icon: LucideIcon, state: string, extra = ""): TrayLine =>
    ({ tone, icon, text: `${count} · ${state}${extra}`, spoken: `${count} · ${state}` });
  const failed = jobs.filter((j) => j.step === "failed" || j.step === "music_blocked").length;
  if (failed > 0) {
    return many("error", AlertCircle, (failed === 1 ? t("video.srv.lineNeedsOne", "{n} needs attention") : t("video.srv.lineNeedsMany", "{n} need attention")).replace("{n}", String(failed)));
  }
  const ready = jobs.filter((j) => j.step === "review").length;
  if (ready > 0) return many("ready", CheckCircle2, t("video.srv.lineReadyMany", "{n} ready to post").replace("{n}", String(ready)));
  if (pct !== undefined) return { ...many("busy", UploadCloud, t("video.srv.lineUploadingMany", "uploading"), ` ${pct}%`), pct };
  if (jobs.some((j) => j.step === "ready")) return many("busy", Loader2, t("video.srv.linePostingMany", "posting"));
  if (jobs.every((j) => j.step === "source")) return many("busy", UploadCloud, t("video.srv.lineWaitingMany", "waiting to upload"));
  return many("busy", Server, t("video.srv.linePreparingMany", "being prepared"));
}

const TONE: Record<JobView["tone"], string> = {
  busy: "bg-primary/10 text-primary",
  ready: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-destructive/10 text-destructive",
};

/** The card's own breakpoint (its `lg:` classes): from here up it sits in the bottom-left corner and never folds. */
const WIDE = "(min-width: 1024px)";
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** The banners that share a phone's screen with the panel: while one is up, the panel is one line. */
const BANNERS: readonly DockLayer[] = ["consent", "update"];

/** The cards themselves — props only, so the UI harness and the tests draw every state. */
export function ServerJobsTray({ jobs, progress, pendingId, onPreview, onCancel, onDismiss, defaultOpen = false }: {
  jobs: VideoJob[];
  progress: Record<string, number | undefined>;
  pendingId?: string | null;
  onPreview: (j: VideoJob) => void;
  onCancel: (j: VideoJob) => void;
  onDismiss: (j: VideoJob) => void;
  /** The folded panel already opened — for the harness, which cannot tap. */
  defaultOpen?: boolean;
}) {
  const t = useT() as T;
  const uid = useId();
  const dock = useRef<HTMLElement>(null);
  const wide = useWide();
  const bannerUp = useDockShowing(BANNERS);
  const [open, setOpen] = useState(defaultOpen);
  /** A phone with more than one job, or a banner up: one slim line, the list a tap away. */
  const folds = !wide && (jobs.length > 1 || bannerUp);
  const listed = !folds || open;
  // In the bottom dock (src/lib/ui/bottomDock.ts): above the bottom bar and any
  // banner, with the round buttons (Ask anything, Back to top) lifted above it.
  // The last argument names every change of its height this component makes.
  useDockLayer("videos", dock, jobs.length > 0, `${jobs.length}:${listed ? "list" : "line"}`);
  if (jobs.length === 0) return null;
  const line = folds ? trayLine(jobs, progress, t) : null;
  const LineIcon = line?.icon;
  const listId = `${uid}list`;
  return createPortal(
    <section
      ref={dock}
      aria-label={t("video.srv.region", "Your videos on our server")}
      className="dock-videos pointer-events-none fixed inset-x-3 z-[45] mx-auto max-w-md lg:inset-x-auto lg:left-4 lg:mx-0 lg:w-[22rem]"
      data-testid="server-video-jobs"
    >
      {/* One opaque panel, a hairline between jobs: no gap, and no page text showing through (Firefox draws no blur behind a translucent card). */}
      <div className="pointer-events-auto divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-lg">
      {listed && (
        /* Capped to the room that is really left (--dock-videos-room, index.css) and scrolled inside it: the stack never outgrows a short screen. */
        <div id={listId} data-testid="server-job-list"
          className="max-h-[var(--dock-videos-room,40dvh)] divide-y divide-border overflow-y-auto overscroll-contain">
      {jobs.map((j) => {
        const v = jobView(j, progress[j.id], t);
        const Icon = v.icon;
        const pending = pendingId === j.id;
        const titleId = `${uid}${j.id}`;
        return (
          <div key={j.id} data-testid="server-job" data-step={j.step}
            className="flex items-center gap-3 py-1.5 pl-3 pr-1.5">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE[v.tone]}`}>
              <Icon className={`h-[18px] w-[18px] ${v.spin ? "animate-spin" : ""}`} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1 py-1" role={v.tone === "error" ? "alert" : "status"} aria-live="polite">
              {/* Two lines at most, never cut mid-word: the Owner's sentences are longer than a 360px phone. */}
              {v.title === v.spoken ? (
                <p id={titleId} className="line-clamp-2 text-sm font-medium leading-snug">{v.title}</p>
              ) : (
                <>
                  {/* The percentage is for the eye. Inside a live region it was read out at every step — up to a
                      hundred times an upload; the progress bar below carries the number (aria-valuenow), and what
                      is SAID changes only when the step does. */}
                  <p aria-hidden="true" className="line-clamp-2 text-sm font-medium leading-snug">{v.title}</p>
                  <span id={titleId} className="sr-only">{v.spoken}</span>
                </>
              )}
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
              <Button type="button" size="sm" className="min-h-11 shrink-0 px-4" aria-describedby={titleId} onClick={() => onPreview(j)}>
                {t("video.srv.preview", "Preview")}
              </Button>
            )}
            {(v.action === "cancel" || v.action === "dismiss") && (
              /* Named by what it does, described by ITS row's title — with two jobs, two buttons called "Cancel this video" said nothing apart. */
              <button type="button" disabled={pending} aria-describedby={titleId}
                onClick={() => (v.action === "cancel" ? onCancel(j) : onDismiss(j))}
                aria-label={v.action === "cancel" ? t("video.srv.cancel", "Cancel this video") : t("video.srv.dismiss", "Dismiss")}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
              </button>
            )}
          </div>
        );
      })}
        </div>
      )}
      {line && LineIcon && (
        <div>
          {/* Folded, the cards (and their live regions) are not drawn: the change of state is said here, once, without the percentage. */}
          {!listed && <p className="sr-only" role="status" aria-live="polite">{line.spoken}</p>}
          {/* The whole line is the button: full width, 44px tall (min-h-11). */}
          <button type="button" aria-expanded={listed} aria-controls={listed ? listId : undefined}
            onClick={() => setOpen((o) => !o)} data-testid="server-jobs-line"
            className="relative flex min-h-11 w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            {listed ? (
              <span className="min-w-0 flex-1 text-sm font-medium text-muted-foreground">{t("video.srv.showLess", "Show less")}</span>
            ) : (
              <>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${TONE[line.tone]}`}>
                  <LineIcon className={`h-4 w-4 ${line.spin ? "animate-spin" : ""}`} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{line.text}</span>
              </>
            )}
            {listed
              ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              : <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            {!listed && line.pct !== undefined && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-muted" aria-hidden="true">
                <span className="block h-full bg-primary transition-[width] duration-300" style={{ width: `${line.pct}%` }} />
              </span>
            )}
          </button>
        </div>
      )}
      </div>
    </section>,
    document.body,
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

  // Only THIS member's jobs are ever drawn — checked here, at the moment of
  // drawing, not only when the list was read. If another member signs in on
  // the same device, nothing of the last one's (a caption, a file name, a
  // preview) is on the screen even for the instant before the new list
  // arrives. (Sign-out itself unmounts this and wipes the store — OFF-5 G6.)
  const own = (j: VideoJob | null) => (j && j.userId === userId ? j : null);
  const mine = jobs.filter((j) => j.userId === userId);
  const confirmingMine = own(confirming);
  const reviewingMine = own(reviewing);

  async function cancel(j: VideoJob) {
    setConfirming(null);
    setPendingId(j.id);
    const ok = await cancelServerJob(j.id, realJobDeps);
    setPendingId(null);
    if (!ok) toast({ title: t("video.srv.cancelFailed", "Couldn't cancel it just now"), description: t("video.srv.cancelFailedHint", "Check your connection and try again."), variant: "destructive" });
  }

  /**
   * Dismiss also takes the job off the server (dismissServerJob). When the
   * server cannot be told, the card STAYS and says so: put away regardless, it
   * would go on holding one of the member's two places with nothing on the
   * screen to explain why the next video is refused.
   */
  async function dismiss(j: VideoJob) {
    setPendingId(j.id);
    const ok = await dismissServerJob(j.id, realJobDeps);
    setPendingId(null);
    if (!ok) toast({ title: t("video.srv.dismissFailed", "Couldn't remove it just now"), description: t("video.srv.cancelFailedHint", "Check your connection and try again."), variant: "destructive" });
  }

  return (
    <>
      <ServerJobsTray jobs={mine} progress={progress} pendingId={pendingId}
        onPreview={setReviewing} onCancel={setConfirming} onDismiss={(j) => void dismiss(j)} />
      <AlertDialog open={!!confirmingMine} onOpenChange={(o) => { if (!o) setConfirming(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("video.srv.cancelTitle", "Cancel this video?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmingMine?.step === "source"
                ? t("video.srv.cancelUpload", "The upload stops and nothing is posted.")
                : t("video.srv.cancelPrepare", "Our server stops preparing it and nothing is posted.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t("video.srv.keep", "Keep it")}</AlertDialogCancel>
            <AlertDialogAction className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirmingMine) void cancel(confirmingMine); }}>
              {t("video.srv.cancelConfirm", "Cancel video")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {reviewingMine && (
        <Suspense fallback={null}>
          <ServerVideoReview job={reviewingMine} onClose={() => setReviewing(null)} />
        </Suspense>
      )}
    </>
  );
}

function pctOf(sent: number, total: number): number {
  return Math.min(100, Math.max(0, Math.floor((sent / Math.max(1, total)) * 100)));
}
