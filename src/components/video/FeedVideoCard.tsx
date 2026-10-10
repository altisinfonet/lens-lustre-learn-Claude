/**
 * VID-1 part 2 · THE FEED VIDEO CARD — always 9:16 (R-105, MASTER §3u).
 *
 * A 9:16 video fills the card. Any other shape is fitted WHOLE (object-contain,
 * never cropped) with a blurred, enlarged copy of the same video behind it
 * (src/lib/video/videoFrame.ts) — the same picture the member saw in the
 * upload preview.
 *
 * Behaviour (rules live in src/lib/video/playback.ts, tested there):
 *   • muted autoplay while ≥ 60 % of the card is in view; pause when it falls
 *     below 30 % or the tab is hidden; one card plays at a time;
 *   • 240p only on a slow network / Data Saver (hls.js autoLevelCapping), else
 *     start on 240p and let ABR climb;
 *   • the poster shows first and is all a card costs until it nears the screen:
 *     no token, no hls.js, no segment is requested for a card nowhere near view;
 *   • reduced-motion members and offline devices get the poster and a Play
 *     button — nothing starts by itself;
 *   • sound is the viewer's choice: a tap on the speaker button (a user gesture).
 *
 * hls.js is a lazy chunk (P13): it is imported on the first card that needs it.
 * Safari / iOS plays HLS natively. The token (15 min) is fetched from
 * /api/video/play-token as the viewer and renewed only when playback starts
 * inside its last 90 s — there is no timer.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getNetState, subscribeNetState } from "@/lib/offline/networkQuality";
import { claimPlayback, levelCap, releasePlayback, shouldPlay, tokenNeedsRefresh } from "@/lib/video/playback";
import { VIDEO_FRAME_ASPECT, videoNeedsFill } from "@/lib/video/videoFrame";
import type { FeedVideo } from "@/lib/video/postVideoRead";

interface PlayGrant { master_url: string; poster_url: string; expires_at: number }

async function requestGrant(videoId: string): Promise<PlayGrant | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch("/api/video/play-token", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ video_id: videoId }),
    });
    if (!res.ok) return null;
    const b = (await res.json()) as Partial<PlayGrant>;
    return typeof b.master_url === "string" && typeof b.poster_url === "string" && typeof b.expires_at === "number"
      ? { master_url: b.master_url, poster_url: b.poster_url, expires_at: b.expires_at }
      : null;
  } catch {
    return null;
  }
}

type HlsInstance = {
  loadSource(u: string): void; attachMedia(v: HTMLVideoElement): void; destroy(): void;
  on(e: string, f: (...a: any[]) => void): void; startLoad(pos?: number): void;
  levels: Array<{ height?: number; bitrate?: number }>; autoLevelCapping: number; startLevel: number;
};

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export default function FeedVideoCard({ video, className = "" }: { video: FeedVideo; className?: string }) {
  const cardId = useId();
  const box = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLVideoElement>(null);
  const hls = useRef<HlsInstance | null>(null);
  const grant = useRef<PlayGrant | null>(null);
  const attached = useRef(false);
  const playing = useRef(false);
  const [near, setNear] = useState(false);
  const [poster, setPoster] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const aspect = video.width && video.height ? video.width / video.height : null;
  const fill = videoNeedsFill(aspect);

  const pause = useCallback(() => {
    playing.current = false;
    setIsPlaying(false);
    el.current?.pause();
    releasePlayback(cardId);
  }, [cardId]);

  /** token → source. Safe to call again after a pause: it only works when the token is due. */
  const ensureSource = useCallback(async (): Promise<boolean> => {
    const v = el.current;
    if (!v) return false;
    const now = Math.floor(Date.now() / 1000);
    if (attached.current && !tokenNeedsRefresh(grant.current?.expires_at, now)) return true;
    const g = await requestGrant(video.id);
    if (!g) { setFailed(true); return false; }
    grant.current = g;
    setPoster(g.poster_url);
    const resumeAt = attached.current ? v.currentTime : 0;
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = g.master_url; // Safari / iOS: native HLS (no level cap available there)
      if (resumeAt) v.currentTime = resumeAt;
    } else {
      const { default: Hls } = await import("hls.js");
      if (!Hls.isSupported()) { setFailed(true); return false; }
      if (hls.current) { hls.current.destroy(); hls.current = null; }
      const h = new Hls({ startLevel: 0, capLevelToPlayerSize: false, enableWorker: true, startPosition: resumeAt || -1 }) as unknown as HlsInstance;
      const applyCap = () => {
        const cap = levelCap(h.levels, getNetState().slow);
        h.autoLevelCapping = Number.isFinite(cap) ? cap : -1;
      };
      h.on("hlsManifestParsed", applyCap);
      h.on("hlsError", (_e: unknown, d: { fatal?: boolean }) => { if (d?.fatal) { setFailed(true); pause(); } });
      h.loadSource(g.master_url);
      h.attachMedia(v);
      hls.current = h;
    }
    attached.current = true;
    return true;
  }, [video.id, pause]);

  const start = useCallback(async () => {
    const v = el.current;
    if (!v || playing.current) return;
    playing.current = true;
    if (!(await ensureSource())) { playing.current = false; return; }
    claimPlayback(cardId, pause);
    try {
      await v.play();
      setIsPlaying(true);
      setNeedsTap(false);
    } catch {
      playing.current = false; // autoplay refused: leave the poster and a Play button
      releasePlayback(cardId);
      setNeedsTap(true);
    }
  }, [cardId, ensureSource, pause]);

  // Near the screen → fetch the poster. In view → play. Out of view → pause.
  useEffect(() => {
    const node = box.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    let ratio = 0;
    const decide = () => {
      const want = shouldPlay({
        ratio, wasPlaying: playing.current,
        tabVisible: document.visibilityState === "visible",
        online: getNetState().online, reducedMotion: reducedMotion(),
      });
      if (want && !playing.current) void start();
      else if (!want && playing.current) pause();
    };
    const near = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setNear(true); }, { rootMargin: "600px 0px" });
    const view = new IntersectionObserver((es) => { ratio = es[es.length - 1]?.intersectionRatio ?? 0; decide(); }, { threshold: [0, 0.3, 0.6, 1] });
    near.observe(node); view.observe(node);
    document.addEventListener("visibilitychange", decide);
    const off = subscribeNetState(decide);
    return () => { near.disconnect(); view.disconnect(); document.removeEventListener("visibilitychange", decide); off(); };
  }, [start, pause]);

  // Poster only — the cheapest thing a card near the screen can do.
  useEffect(() => {
    if (!near || grant.current) return;
    let live = true;
    void requestGrant(video.id).then((g) => { if (live && g) { grant.current = g; setPoster(g.poster_url); } else if (live && !g) setFailed(true); });
    return () => { live = false; };
  }, [near, video.id]);

  // Leaving the page releases the decoder and the network for good.
  useEffect(() => () => {
    releasePlayback(cardId);
    hls.current?.destroy(); hls.current = null;
    const v = el.current; if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
  }, [cardId]);

  const tapPlay = () => { setNeedsTap(false); void start(); };

  return (
    <div
      ref={box}
      data-testid="feed-video-card"
      data-frame-aspect={VIDEO_FRAME_ASPECT.toFixed(3)}
      data-fill={fill ? "blurred" : "none"}
      className={`relative mx-auto w-full max-w-[min(100%,calc(78dvh*9/16))] overflow-hidden rounded-lg bg-black ${className}`}
      style={{ aspectRatio: String(VIDEO_FRAME_ASPECT) }}
    >
      {fill && poster && (
        <div aria-hidden="true" data-testid="feed-video-fill"
          className="absolute inset-0 scale-110 bg-cover bg-center opacity-60 blur-xl"
          style={{ backgroundImage: `url("${poster}")` }} />
      )}
      <video
        ref={el}
        muted={muted}
        playsInline
        loop
        preload="none"
        poster={poster ?? undefined}
        aria-label="Video post"
        className="relative h-full w-full object-contain"
        onClick={() => (playing.current ? pause() : tapPlay())}
      />
      {(needsTap || (!isPlaying && !failed && poster)) && (
        <button type="button" aria-label="Play video" onClick={tapPlay}
          className="absolute inset-0 m-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white">
          <Play className="h-7 w-7" />
        </button>
      )}
      {failed && (
        <p role="status" className="absolute inset-x-0 bottom-0 bg-black/70 p-2 text-center text-xs text-white">
          This video can't play right now.
        </p>
      )}
      {video.hasAudio && (
        <button type="button" aria-label={muted ? "Turn sound on" : "Turn sound off"} aria-pressed={!muted}
          onClick={() => setMuted((m) => !m)}
          className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white">
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}
