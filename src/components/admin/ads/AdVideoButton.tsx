/**
 * VID-5 · a VIDEO on an ad creative (Admin → Advertisements → the picture library).
 *
 * Shown only when the "Video ads" switch is on for this admin (Admin →
 * Features, VID-7). That only decides whether the button is SHOWN: the server
 * decides whether it is allowed — video_begin_upload refuses purpose 'ad'
 * unless the caller is an admin with video_ads on, and ad_videos' policy and
 * link guard refuse anything else (20261005_0005).
 *
 * The same pipeline as a video post — encoded on this device, uploaded in the
 * background, checked by the server — and when the video is READY the upload
 * job puts it on this creative (ad_videos) instead of making a post. The ad's
 * picture stays: it is what shows until the video is ready, and if it is ever
 * removed. No time limit; 500 MB (Owner A3.2).
 *
 * Server conversion (Admin → Video Conversion = "On our server"): the
 * original is uploaded instead of encoded here, exactly as a video post's
 * (VideoPostComposer.tsx, src/lib/video/startOnServer.ts); when the
 * converter is done, the admin previews it at the bottom of the app and puts
 * it on the ad. "Remove sound" is device-only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Film, Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import CategoryChips, { canPublishCategories } from "@/components/post/CategoryChips";
import { useFeatureAllowed } from "@/hooks/core/useFeatureAllowed";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { readVideoFacts, videoLimitProblems, memoryProblem, serverLimitProblems, formatDuration, type VideoFacts } from "@/lib/video/limits";
import { createJob, runVideoJobs } from "@/lib/video/uploadJobs";
import { realJobDeps } from "@/lib/video/jobDeps";
import { useConversionMode } from "@/lib/video/conversionMode";
import { startOnServer } from "@/lib/video/startOnServer";
import { invalidateAdCreatives } from "@/lib/ads/adCreatives";

type Phase = { kind: "pick" } | { kind: "reading" } | { kind: "ready"; facts: VideoFacts } | { kind: "encoding"; progress: number }
  | { kind: "error"; message: string; unplayable?: boolean }
  /** Server conversion: video_source_begin in flight (facts null = a video this browser can't play). */
  | { kind: "starting"; facts: VideoFacts | null };

export interface AdVideoButtonProps {
  creativeId: string;
  /** "ready" = the ad has a playable video; "pending" = one is linked but no longer playable (taken down / deleted); null = none */
  videoState: "ready" | "pending" | null;
  onChanged?: () => void;
  /**
   * S7-c · "Add a video ad" (the library's own button): the video the admin
   * already picked. The dialog opens with it, once; the admin then chooses
   * categories and starts the upload exactly as with "Add video".
   */
  initialFile?: File | null;
}

export default function AdVideoButton({ creativeId, videoState, onChanged, initialFile }: AdVideoButtonProps) {
  const allowed = useFeatureAllowed("video_ads");
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [categories, setCategories] = useState<string[]>([]);
  const [mute, setMute] = useState(false);
  /** VID-SRC-001 came back: this dialog prepares the video on the device after all. */
  const [deviceAfterAll, setDeviceAfterAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const server = useConversionMode(open && allowed) === "server" && !deviceAfterAll;

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    if (!open) { setFile(null); setUrl(null); setPhase({ kind: "pick" }); setCategories([]); setMute(false); setDeviceAfterAll(false); }
  }, [open]);

  // S7-c: open once with the video picked in the library (after the reset above has run).
  const handedOver = useRef<File | null>(null);
  useEffect(() => {
    if (!allowed || !initialFile || handedOver.current === initialFile) return;
    handedOver.current = initialFile;
    setOpen(true);
    void pick(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pick is stable enough: it only sets state
  }, [allowed, initialFile]);

  const facts = phase.kind === "ready" || phase.kind === "starting" ? phase.facts : null;
  /** Server mode: a video this browser can't read is still the converter's to try. */
  const unplayable = server && ((phase.kind === "error" && phase.unplayable === true) || (phase.kind === "starting" && !phase.facts));
  const problems = useMemo(() => {
    if (server) return file && (facts || unplayable) ? serverLimitProblems(file.size, "ad") : [];
    if (!facts) return [];
    const p = videoLimitProblems(facts, "ad");
    const mem = memoryProblem(facts, mute);
    return mem ? [...p, mem] : p;
  }, [facts, mute, server, file, unplayable]);
  const canUpload = (phase.kind === "ready" || (unplayable && phase.kind === "error")) && problems.length === 0 && canPublishCategories(categories) && !!user;
  const busy = phase.kind === "encoding" || phase.kind === "starting";

  if (!allowed) return null;

  async function pick(f: File | undefined) {
    if (!f) return;
    if (url) URL.revokeObjectURL(url);
    setFile(f);
    setUrl(URL.createObjectURL(f));
    setPhase({ kind: "reading" });
    try {
      setPhase({ kind: "ready", facts: await readVideoFacts(f) });
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message.replace(/^VID-[A-Z]+-\d+: /, ""), unplayable: true });
    }
  }

  /** Server conversion: begin while this dialog is open, then the upload runs on its own (bottom of the app). */
  async function uploadOnServer() {
    if (!canUpload || !file || !user) return;
    const before = phase;
    setPhase({ kind: "starting", facts: phase.kind === "ready" ? phase.facts : null });
    try {
      const r = await startOnServer({
        userId: user.id, purpose: "ad", file, name: file.name,
        post: { content: "", categories, privacy: "public" }, ad: { creativeId },
      }, realJobDeps);
      if (r.kind === "started") { setOpen(false); return; }
      if (r.kind === "switched_off") { setDeviceAfterAll(true); setPhase(before); return; }
      setPhase({ kind: "error", message: r.message });
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message });
    }
  }

  async function upload() {
    if (server) { await uploadOnServer(); return; }
    if (!canUpload || !file || !user) return;
    setPhase({ kind: "encoding", progress: 0 });
    try {
      const pkg = await (await import("@/lib/video/webEncoder")).encodeVideoToHls(file, {
        mute, onProgress: (p) => setPhase({ kind: "encoding", progress: p }),
      });
      await createJob({
        userId: user.id, purpose: "ad", manifest: pkg.manifest, manifestSha256: pkg.manifestSha256, files: pkg.files,
        post: { content: "", categories, privacy: "public" }, ad: { creativeId },
      });
      void runVideoJobs(user.id, realJobDeps);
      toast({ title: "Your ad video is uploading", description: "It replaces the picture on this ad as soon as it is ready." });
      setOpen(false);
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message.replace(/^VID-[A-Z]+-\d+: /, "") });
    }
  }

  async function removeVideo() {
    const t = supabase.from("ad_videos" as never) as unknown as {
      select(c: string): { eq(c: string, v: string): { maybeSingle(): PromiseLike<{ data: { video_id?: string } | null }> } };
      delete(): { eq(c: string, v: string): PromiseLike<{ error: { message: string } | null }> };
    };
    const prev = await t.select("video_id").eq("ad_creative_id", creativeId).maybeSingle();
    const { error } = await t.delete().eq("ad_creative_id", creativeId);
    if (error) { toast({ title: "Couldn't remove the video", description: error.message, variant: "destructive" }); return; }
    // No longer on the ad: mark it deleted so housekeeping purges it (review #412).
    const old = prev.data?.video_id;
    if (old) await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => PromiseLike<unknown>)("video_delete", { _video_id: old });
    invalidateAdCreatives();
    toast({ title: "Video removed — the ad shows its picture again" });
    onChanged?.();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="ad-video-controls">
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted/40">
        <Film className="h-3 w-3" /> {videoState ? "Replace video" : "Add video"}
      </button>
      {videoState === "ready" && <span className="text-[10px] text-primary">Video live</span>}
      {videoState === "pending" && <span className="text-[10px] text-destructive">Video not available — upload a new one</span>}
      {videoState && (
        <button type="button" onClick={() => void removeVideo()} title="Remove the video (the picture shows again)"
          aria-label="Remove the video" className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3 w-3" />
        </button>
      )}

      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" data-testid="ad-video-dialog" data-conversion={server ? "server" : "device"}>
          <div className="flex min-w-0 flex-col gap-3">
            <DialogTitle>Video for this ad</DialogTitle>
            <DialogDescription>Up to 500 MB, any length. The ad keeps its picture until the video is ready.</DialogDescription>
            {deviceAfterAll && (
              <p role="status" data-testid="ad-video-server-off" className="rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
                Server conversion was just switched off, so this video will be prepared on this device. Check it below, then tap Upload video.
              </p>
            )}
            <input ref={inputRef} type="file" accept="video/*" className="hidden" aria-label="Choose a video for this ad"
              onChange={(e) => void pick(e.target.files?.[0])} />
            {!url && (
              <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => inputRef.current?.click()}>
                Choose a video
              </Button>
            )}
            {url && !unplayable && (
              <video src={url} muted playsInline controls aria-label="Preview of the ad video"
                className="max-h-[50dvh] w-full rounded-lg bg-black object-contain" />
            )}
            {/* Server mode, a format this browser can't play: the file itself, not an empty frame. */}
            {url && unplayable && file && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3" data-testid="ad-video-no-preview">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-black text-white/70">
                  <Film className="h-6 w-6" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{Math.max(1, Math.round(file.size / 1_048_576))} MB · this browser can&apos;t show a preview</p>
                </div>
              </div>
            )}
            {phase.kind === "reading" && <p className="text-sm text-muted-foreground">Reading the video…</p>}
            {facts && <p className="text-sm text-muted-foreground">{formatDuration(facts.durationSeconds)} · {Math.max(1, Math.round(facts.bytes / 1_048_576))} MB</p>}
            {server && (facts || unplayable) && problems.length === 0 && (
              <p className="text-xs text-muted-foreground" data-testid="ad-video-server-note">
                Prepared on our server: once the upload reaches 100% you can close this page.
              </p>
            )}
            {problems.length > 0 && (
              <ul className="space-y-1 text-sm text-destructive" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
            {phase.kind === "error" && !unplayable && <p className="text-sm text-destructive" role="alert">{phase.message}</p>}
            {url && !busy && (
              <>
                <CategoryChips value={categories} onChange={setCategories} />
                {!server && (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} className="h-4 w-4" />
                    Remove sound
                  </label>
                )}
              </>
            )}
            {phase.kind === "starting" && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Starting the upload…
              </p>
            )}
            {phase.kind === "encoding" && (
              <div className="space-y-1" aria-live="polite">
                <div className="h-2 w-full overflow-hidden rounded bg-muted">
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">Preparing the video on this device… {Math.round(phase.progress * 100)}%</p>
                <p className="text-xs text-muted-foreground">Keep this tab open and in front: preparing pauses while you are in another tab, and carries on when you come back.</p>
              </div>
            )}
            <div className="flex gap-2">
              {url && !busy && (
                <Button type="button" variant="ghost" className="min-h-11" onClick={() => inputRef.current?.click()}>Change video</Button>
              )}
              <Button type="button" className="min-h-11 flex-1" disabled={!canUpload} onClick={() => void upload()}>
                Upload video
              </Button>
            </div>
            {url && !canPublishCategories(categories) && !busy && (
              <p className="text-xs text-muted-foreground">Choose 1 to 5 categories.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
