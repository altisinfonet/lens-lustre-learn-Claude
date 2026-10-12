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
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Film, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import CategoryChips, { canPublishCategories } from "@/components/post/CategoryChips";
import { useFeatureAllowed } from "@/hooks/core/useFeatureAllowed";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { readVideoFacts, videoLimitProblems, memoryProblem, formatDuration, type VideoFacts } from "@/lib/video/limits";
import { createJob, runVideoJobs } from "@/lib/video/uploadJobs";
import { realJobDeps } from "@/lib/video/jobDeps";
import { invalidateAdCreatives } from "@/lib/ads/adCreatives";

type Phase = { kind: "pick" } | { kind: "reading" } | { kind: "ready"; facts: VideoFacts } | { kind: "encoding"; progress: number } | { kind: "error"; message: string };

export interface AdVideoButtonProps {
  creativeId: string;
  /** "ready" = the ad has a playable video; "pending" = one is linked but not ready; null = none */
  videoState: "ready" | "pending" | null;
  onChanged?: () => void;
}

export default function AdVideoButton({ creativeId, videoState, onChanged }: AdVideoButtonProps) {
  const allowed = useFeatureAllowed("video_ads");
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [categories, setCategories] = useState<string[]>([]);
  const [mute, setMute] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    if (!open) { setFile(null); setUrl(null); setPhase({ kind: "pick" }); setCategories([]); setMute(false); }
  }, [open]);

  const facts = phase.kind === "ready" ? phase.facts : null;
  const problems = useMemo(() => {
    if (!facts) return [];
    const p = videoLimitProblems(facts, "ad");
    const mem = memoryProblem(facts, mute);
    return mem ? [...p, mem] : p;
  }, [facts, mute]);
  const canUpload = phase.kind === "ready" && problems.length === 0 && canPublishCategories(categories) && !!user;

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
      setPhase({ kind: "error", message: (e as Error).message.replace(/^VID-[A-Z]+-\d+: /, "") });
    }
  }

  async function upload() {
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
    const { error } = await (supabase.from("ad_videos" as never) as unknown as {
      delete(): { eq(c: string, v: string): PromiseLike<{ error: { message: string } | null }> };
    }).delete().eq("ad_creative_id", creativeId);
    if (error) { toast({ title: "Couldn't remove the video", description: error.message, variant: "destructive" }); return; }
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
      {videoState === "pending" && <span className="text-[10px] text-muted-foreground">Video being checked…</span>}
      {videoState && (
        <button type="button" onClick={() => void removeVideo()} title="Remove the video (the picture shows again)"
          aria-label="Remove the video" className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3 w-3" />
        </button>
      )}

      <Dialog open={open} onOpenChange={(o) => { if (phase.kind !== "encoding") setOpen(o); }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" data-testid="ad-video-dialog">
          <div className="flex min-w-0 flex-col gap-3">
            <DialogTitle>Video for this ad</DialogTitle>
            <DialogDescription>Up to 500 MB, any length. The ad keeps its picture until the video is ready.</DialogDescription>
            <input ref={inputRef} type="file" accept="video/*" className="hidden" aria-label="Choose a video for this ad"
              onChange={(e) => void pick(e.target.files?.[0])} />
            {!url && (
              <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => inputRef.current?.click()}>
                Choose a video
              </Button>
            )}
            {url && (
              <video src={url} muted playsInline controls aria-label="Preview of the ad video"
                className="max-h-[50dvh] w-full rounded-lg bg-black object-contain" />
            )}
            {phase.kind === "reading" && <p className="text-sm text-muted-foreground">Reading the video…</p>}
            {facts && <p className="text-sm text-muted-foreground">{formatDuration(facts.durationSeconds)} · {Math.max(1, Math.round(facts.bytes / 1_048_576))} MB</p>}
            {problems.length > 0 && (
              <ul className="space-y-1 text-sm text-destructive" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
            {phase.kind === "error" && <p className="text-sm text-destructive" role="alert">{phase.message}</p>}
            {url && phase.kind !== "encoding" && (
              <>
                <CategoryChips value={categories} onChange={setCategories} />
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} className="h-4 w-4" />
                  Remove sound
                </label>
              </>
            )}
            {phase.kind === "encoding" && (
              <div className="space-y-1" aria-live="polite">
                <div className="h-2 w-full overflow-hidden rounded bg-muted">
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">Preparing the video on this device… {Math.round(phase.progress * 100)}%</p>
              </div>
            )}
            <div className="flex gap-2">
              {url && phase.kind !== "encoding" && (
                <Button type="button" variant="ghost" className="min-h-11" onClick={() => inputRef.current?.click()}>Change video</Button>
              )}
              <Button type="button" className="min-h-11 flex-1" disabled={!canUpload} onClick={() => void upload()}>
                Upload video
              </Button>
            </div>
            {url && !canPublishCategories(categories) && phase.kind !== "encoding" && (
              <p className="text-xs text-muted-foreground">Choose 1 to 5 categories.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
