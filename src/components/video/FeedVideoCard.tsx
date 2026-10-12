/**
 * VID-1 part 2 · THE FEED VIDEO CARD — 9:16, filling the post (R-105, MASTER §3u).
 *
 * The card spans the post's full width at 9:16, capped at 85 % of the screen
 * height (Owner, staging 2026-10-12: "card size and video size are not
 * filled" — the card used to shrink to a narrow 9:16 strip with empty space
 * beside it on a computer). The video is fitted WHOLE (object-contain, never
 * cropped); whatever it does not cover — the sides of a capped card, or above
 * and below a landscape clip — shows a blurred, enlarged copy of its poster
 * (src/lib/video/videoFrame.ts). No black bars, nothing cut off.
 *
 * Controls (Owner, same day: "no bar … to fast dragging"): play/pause, a seek
 * bar you can drag, elapsed / total time, and sound. Tapping the picture
 * plays/pauses; the bar never does.
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
 * /api/video/play-token as the viewer and renewed inside its last 90 s — when
 * playback starts, and, for a video longer than the token (no time limit since
 * 2026-10-12), DURING playback: the element's own timeupdate notices the token
 * is due and the stream is re-attached at the same second. A segment refused
 * with 403 (a token that ran out anyway) gets one fresh token before the card
 * gives up. There is no timer.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getNetState, subscribeNetState } from "@/lib/offline/networkQuality";
import { claimPlayback, levelCap, releasePlayback, shouldPlay } from "@/lib/video/playback";
import { PLAY_TOKEN_TTL_S } from "@/lib/video/shared/playToken";
import { VIDEO_FRAME_ASPECT } from "@/lib/video/videoFrame";
import type { FeedVideo } from "@/lib/video/postVideoRead";

/** receivedAt: performance.now() when it arrived — the device's own clock, never Date.now() (review #411 C6). */
interface PlayGrant { master_url: string; poster_url: string; expires_at: number; receivedAt: number }

/**
 * A token is "due" 90 s before its 15 minutes run out, measured on the
 * MONOTONIC clock from when it arrived. Date.now() would follow the phone's
 * wall clock: one set 13½ minutes fast made every token look due, and the
 * card fetched tokens back to back (review #411 C6).
 */
const GRANT_FRESH_MS = (PLAY_TOKEN_TTL_S - 90) * 1000;
const grantDue = (g: PlayGrant | null | undefined) => !g || performance.now() - g.receivedAt > GRANT_FRESH_MS;
/** Never renew more often than this, whatever happens. */
const MIN_RENEW_GAP_MS = 60_000;

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
      ? { master_url: b.master_url, poster_url: b.poster_url, expires_at: b.expires_at, receivedAt: performance.now() }
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

/** 0:07, 7:28, 1:02:05 */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * `fillParent`: fill the parent's box instead of drawing the 9:16 card — for
 * an ad zone, whose own frame (story card, banner …) sets the shape. The video
 * is still fitted whole over its blurred poster.
 */
export default function FeedVideoCard({ video, className = "", fillParent = false }: { video: FeedVideo; className?: string; fillParent?: boolean }) {
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
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(video.durationS || 0);
  const scrubbing = useRef(false);
  /** A seek asked for before the stream is attached: applied once it is. */
  const pendingSeek = useRef<number | null>(null);

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
    if (attached.current && !grantDue(grant.current)) return true;
    const g = await requestGrant(video.id);
    if (!g) { setFailed(true); return false; }
    grant.current = g;
    setPoster(g.poster_url);
    const resumeAt = pendingSeek.current ?? (attached.current ? v.currentTime : 0);
    pendingSeek.current = null;
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = g.master_url; // Safari / iOS: native HLS (no level cap available there)
      if (resumeAt) v.currentTime = resumeAt;
    } else {
      // workerPath: hls.js's demux worker is served from our own /assets/ (hashed,
      // always the same version as the library), so the CSP needs only
      // worker-src 'self' — never blob: (VID-1 CSP review, PR #396).
      const [{ default: Hls }, { default: workerPath }] = await Promise.all([
        import("hls.js"),
        import("hls.js/dist/hls.worker.js?url"),
      ]);
      if (!Hls.isSupported()) { setFailed(true); return false; }
      if (hls.current) { hls.current.destroy(); hls.current = null; }
      const h = new Hls({ startLevel: 0, capLevelToPlayerSize: false, enableWorker: true, workerPath, startPosition: resumeAt || -1 }) as unknown as HlsInstance;
      const applyCap = () => {
        const cap = levelCap(h.levels, getNetState().slow);
        h.autoLevelCapping = Number.isFinite(cap) ? cap : -1;
      };
      h.on("hlsManifestParsed", applyCap);
      h.on("hlsError", (_e: unknown, d: { fatal?: boolean; response?: { code?: number } }) => {
        if (!d?.fatal) return;
        // The token ran out mid-play (a long video): one fresh token, same second.
        if (d.response?.code === 403 && !renewedAfter403.current) {
          renewedAfter403.current = true;
          grant.current = null;
          void renew();
          return;
        }
        setFailed(true); pause();
      });
      // A segment really loaded: the 403 retry is available again (a LASTING 403 —
      // a revoked video — must not loop: review #411 C6).
      h.on("hlsFragLoaded", () => { renewedAfter403.current = false; });
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

  /** A fresh token and the stream re-attached at the same second; playback goes on. */
  const renewing = useRef(false);
  const renewedAfter403 = useRef(false);
  const lastRenewAt = useRef(-Infinity);
  const renew = useCallback(async () => {
    const v = el.current;
    if (!v || renewing.current) return;
    renewing.current = true;
    lastRenewAt.current = performance.now();
    try {
      const wasPlaying = playing.current;
      if (await ensureSource() && wasPlaying) await v.play().catch(() => {});
    } finally {
      renewing.current = false;
    }
  }, [ensureSource]);

  // A video longer than the 15-minute token: renew it shortly before it ends, mid-play.
  useEffect(() => {
    const v = el.current;
    if (!v) return;
    const onTime = () => {
      if (!playing.current || renewing.current || !attached.current) return;
      if (grantDue(grant.current) && performance.now() - lastRenewAt.current >= MIN_RENEW_GAP_MS) void renew();
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [renew]);

  // Time and length, from the element itself (the stream knows its real length).
  useEffect(() => {
    const v = el.current;
    if (!v) return;
    const onTime = () => { if (!scrubbing.current) setTime(v.currentTime); };
    const onDur = () => { if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration); };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("loadedmetadata", onDur);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("loadedmetadata", onDur);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, []);

  const seek = (to: number) => {
    const t = Math.max(0, Math.min(duration || to, to));
    setTime(t);
    const v = el.current;
    if (v && attached.current) { v.currentTime = t; return; }
    // Not streaming yet (only the poster): start, at that point.
    pendingSeek.current = t;
    tapPlay();
  };

  return (
    <div
      ref={box}
      data-testid="feed-video-card"
      data-frame-aspect={VIDEO_FRAME_ASPECT.toFixed(3)}
      data-fill="blurred"
      className={`relative w-full overflow-hidden ${fillParent ? "h-full" : "rounded-lg"} bg-black ${className}`}
      style={fillParent
        ? { width: "100%", height: "100%" }
        : { width: "100%", aspectRatio: String(VIDEO_FRAME_ASPECT), maxHeight: "min(85dvh, 900px)" }}
    >
      {poster && (
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
        <p role="status" className="absolute inset-x-0 bottom-12 bg-black/70 p-2 text-center text-xs text-white">
          This video can't play right now.
        </p>
      )}
      {/* The control bar: never toggles playback itself (taps stop here). */}
      <div
        data-testid="video-controls"
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-8 text-white"
      >
        <button type="button" aria-label={isPlaying ? "Pause" : "Play"} onClick={() => (playing.current ? pause() : tapPlay())}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/15">
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <input
          type="range"
          aria-label="Seek"
          aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
          min={0}
          max={Math.max(0.1, duration)}
          step={0.1}
          value={Math.min(time, Math.max(0.1, duration))}
          onPointerDown={() => { scrubbing.current = true; }}
          onPointerUp={() => { scrubbing.current = false; }}
          onPointerCancel={() => { scrubbing.current = false; }}
          onChange={(e) => seek(Number(e.target.value))}
          className="h-9 min-w-0 flex-1 cursor-pointer accent-white"
        />
        <span className="shrink-0 text-[11px] tabular-nums" data-testid="video-clock">
          {formatClock(time)} / {formatClock(duration)}
        </span>
        {video.hasAudio && (
          <button type="button" aria-label={muted ? "Turn sound on" : "Turn sound off"} aria-pressed={!muted}
            onClick={() => setMuted((m) => !m)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/15">
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
