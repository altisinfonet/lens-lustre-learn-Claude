/**
 * VID-1 part 2 · THE VIDEO PLAYER — the ONE player for every surface: feed,
 * post page, hashtag feed, ad zones, ad page, comments box, owner review
 * (R-105, MASTER §3u). Do not make a second one.
 *
 * The card spans the post's full width at 9:16, capped at 85 % of the screen
 * height (Owner, staging 2026-10-12: "card size and video size are not
 * filled" — the card used to shrink to a narrow 9:16 strip with empty space
 * beside it on a computer). The video is fitted WHOLE (object-contain, never
 * cropped); whatever it does not cover — the sides of a capped card, or above
 * and below a landscape clip — shows a blurred, enlarged copy of its poster
 * (src/lib/video/videoFrame.ts). No black bars, nothing cut off.
 *
 * Controls, Meta-style (Owner 2026-10-18, replacing the always-on bar of
 * 2026-10-12): HIDDEN by default. A tap on the picture shows them — a thin
 * (3 px), translucent progress bar you can drag (its touch area is 44 px
 * tall), play/pause, elapsed / total time and sound — and they fade out again
 * CONTROLS_HIDE_MS later while the video plays. A tap on the sound button
 * changes the sound only; a tap on the bar never toggles playback. Keyboard
 * focus shows them too.
 *
 * Behaviour (rules live in src/lib/video/playback.ts, tested there):
 *   • autoplay while ≥ 60 % of the card is in view; pause when it falls below
 *     30 % or the tab / app is hidden; one card plays at a time;
 *   • sound (autoplayWithSound): in the APP with sound by default; on the WEB
 *     muted (the browser rule) until the member unmutes once, then with sound
 *     for the rest of the session; a start with sound that is refused starts
 *     muted instead (startPlayback) — never a broken or paused card for it;
 *   • hls.js wherever the browser has MSE, the Android app included; the
 *     platform's own HLS player only on Apple WebKit (pickHlsEngine says why);
 *   • 240p only on a slow network / Data Saver (hls.js autoLevelCapping), else
 *     start on 240p and let ABR climb;
 *   • the poster shows first and is all a card costs until it nears the screen:
 *     no token, no hls.js, no segment is requested for a card nowhere near view;
 *   • reduced-motion members and offline devices get the poster and a Play
 *     button — nothing starts by itself.
 *
 * hls.js is a lazy chunk (P13): it is imported on the first card that needs it.
 * The token (15 min) is fetched from /api/video/play-token as the viewer and
 * renewed inside its last 90 s — when playback starts, and, for a video longer
 * than the token (no time limit since 2026-10-12), DURING playback: the
 * element's own timeupdate notices the token is due and the stream is
 * re-attached at the same second. A segment refused with 403 (a token that ran
 * out anyway) gets one fresh token before the card gives up. There is no
 * repeating timer (the controls' hide is one short one-shot, cleared on hide).
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { getNetState, subscribeNetState } from "@/lib/offline/networkQuality";
import { supabase } from "@/integrations/supabase/client";
import { hasSavedPreview, maybeSaveVideoPreview, offlineLoaderFor, savedPreviewInfo, savedPreviewUrl } from "@/lib/video/offlineVideo";
import {
  CONTROLS_HIDE_MS, autoplayWithSound, claimPlayback, getSoundPref, isAppleWebKit, isNativeApp, leavePlayback, levelCap,
  pickHlsEngine, releasePlayback, setSoundPref, shouldPlay, startPlayback, userActivated,
} from "@/lib/video/playback";
import { grantDue, requestGrant, type PlayGrant } from "@/lib/video/playGrant";
import { VIDEO_FRAME_ASPECT } from "@/lib/video/videoFrame";
import type { FeedVideo } from "@/lib/video/postVideoRead";
import { playedStep, watchPercent } from "@/lib/feed/feedSignals";

// When a token is "due" (90 s before its 15 minutes end, on the device's
// monotonic clock — review #411 C6): grantDue in src/lib/video/playGrant.ts.
/** Never renew more often than this, whatever happens. */
const MIN_RENEW_GAP_MS = 60_000;

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
const capPlatform = (): string | null => {
  try { return (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() ?? null; } catch { return null; }
};
const hasMse = (): boolean => {
  const w = window as unknown as { MediaSource?: unknown; ManagedMediaSource?: unknown };
  return !!(w.MediaSource || w.ManagedMediaSource);
};

/**
 * `fillParent`: fill the parent's box instead of drawing the 9:16 card — for
 * an ad zone, whose own frame (story card, banner …) sets the shape. The video
 * is still fitted whole over its blurred poster.
 */
export default function FeedVideoCard({ video, className = "", fillParent = false, onWatchPct }: {
  video: FeedVideo;
  className?: string;
  fillParent?: boolean;
  /** S12-F1 · the % of the video played so far, called when it grows (the feed records it as a signal). */
  onWatchPct?: (pct: number) => void;
}) {
  const cardId = useId();
  const box = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLVideoElement>(null);
  const hls = useRef<HlsInstance | null>(null);
  const grant = useRef<PlayGrant | null>(null);
  const attached = useRef(false);
  const playing = useRef(false);
  const [near, setNear] = useState(false);
  const [poster, setPoster] = useState<string | null>(null);
  // What the next autoplay will do; the element's own `muted` is set right before play() (startPlayback).
  const [muted, setMuted] = useState(() => !autoplayWithSound({ native: isNativeApp(), pref: getSoundPref(), hasAudio: video.hasAudio, userActivated: false }));
  const [failed, setFailed] = useState(false);
  /** S7b-6: the stream on the element comes from the phone (a saved preview), not the network. */
  const fromPhone = useRef(false);
  const [source, setSource] = useState<"network" | "phone" | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(video.durationS || 0);
  const [controlsShown, setControlsShown] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubbing = useRef(false);
  /** A seek asked for before the stream is attached: applied once it is. */
  const pendingSeek = useRef<number | null>(null);
  /** This card's own play/pause rule, so a card that paused it can hand playback back (leavePlayback). */
  const decideRef = useRef<(() => void) | null>(null);

  const pause = useCallback(() => {
    playing.current = false;
    setIsPlaying(false);
    el.current?.pause();
    releasePlayback(cardId);
  }, [cardId]);

  /* ── the controls: hidden by default, shown by a tap, gone again ─────────── */
  const clearHide = () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
  /** Keyboard / screen-reader focus inside the controls: they stay up (review #449). */
  const focusInside = useRef(false);
  const scheduleHide = useCallback(() => {
    clearHide();
    if (!playing.current || scrubbing.current || focusInside.current) return; // a paused video keeps its controls until the next tap
    hideTimer.current = setTimeout(() => { hideTimer.current = null; if (!focusInside.current) setControlsShown(false); }, CONTROLS_HIDE_MS);
  }, []);
  const reveal = useCallback(() => { setControlsShown(true); scheduleHide(); }, [scheduleHide]);
  const hideNow = () => { clearHide(); setControlsShown(false); };
  // Playback starting with the controls up starts their countdown.
  useEffect(() => { if (isPlaying && controlsShown && !hideTimer.current) scheduleHide(); }, [isPlaying, controlsShown, scheduleHide]);
  useEffect(() => () => clearHide(), []);

  /** token → source. Safe to call again after a pause: it only works when the token is due. `fresh`: never a shared grant (after a 403). */
  const ensureSource = useCallback(async (fresh = false): Promise<boolean> => {
    const v = el.current;
    if (!v) return false;
    // S7b-6: with no network, a video saved on the phone plays from there (no
    // token to ask for). Only with NO network: online, a refused token (a video
    // taken down, a deleted post — review #674) never falls back to the phone.
    const offline = !getNetState().online;
    const saved = offline ? savedPreviewUrl(video.id) : null;
    if (attached.current && !fresh) {
      if (saved && fromPhone.current) return true;
      // Review #674: the network stream attached earlier cannot load its next
      // segment now — switch to the phone copy instead of failing.
      if (!saved && !grantDue(grant.current)) return true;
    }
    const g = saved ? null : await requestGrant(video.id, { fresh });
    if (!g && !saved) { setFailed(true); return false; }
    if (g) { grant.current = g; setPoster(g.poster_url); }
    const src = g ? g.master_url : saved!;
    let resumeAt = pendingSeek.current ?? (attached.current ? v.currentTime : 0);
    // Re-review #674: the phone copy is only the first part — a point past it starts it from its beginning.
    const keptS = saved ? savedPreviewInfo(video.id)?.seconds ?? 0 : Infinity;
    if (resumeAt >= keptS - 0.5) resumeAt = 0;
    pendingSeek.current = null;
    const nativeHls = !!v.canPlayType("application/vnd.apple.mpegurl");
    let engine = pickHlsEngine({ nativeHls, mse: hasMse(), appleWebKit: isAppleWebKit(navigator.userAgent, capPlatform()) });
    let Hls: (typeof import("hls.js"))["default"] | null = null;
    let workerPath = "";
    if (engine === "hlsjs") {
      // workerPath: hls.js's demux worker is served from our own /assets/ (hashed,
      // always the same version as the library), so the CSP needs only
      // worker-src 'self' — never blob: (VID-1 CSP review, PR #396).
      const [lib, worker] = await Promise.all([import("hls.js"), import("hls.js/dist/hls.worker.js?url")]);
      Hls = lib.default; workerPath = worker.default;
      if (!Hls.isSupported()) engine = nativeHls ? "native" : "none";
    }
    if (engine === "none") { setFailed(true); return false; }
    // The phone copy is read by hls.js's loader; a native player cannot read it.
    if (!g && (engine !== "hlsjs" || !Hls)) { setFailed(true); return false; }
    v.dataset.engine = engine;
    fromPhone.current = !g;
    setSource(g ? "network" : "phone");
    setFailed(false);
    if (engine === "native" || !Hls) {
      v.src = src; // Apple WebKit: its own HLS player (no level cap available there)
      if (resumeAt) v.currentTime = resumeAt;
    } else {
      if (hls.current) { hls.current.destroy(); hls.current = null; }
      const h = new Hls({
        startLevel: 0, capLevelToPlayerSize: false, enableWorker: true, workerPath, startPosition: resumeAt || -1,
        ...(g ? {} : { loader: offlineLoaderFor(Hls.DefaultConfig.loader as never) }),
      }) as unknown as HlsInstance;
      const applyCap = () => {
        const cap = levelCap(h.levels, getNetState().slow);
        h.autoLevelCapping = Number.isFinite(cap) ? cap : -1;
      };
      h.on("hlsManifestParsed", applyCap);
      h.on("hlsError", (_e: unknown, d: { fatal?: boolean; response?: { code?: number } }) => {
        if (!d?.fatal) return;
        // Re-review #674: the network went while streaming — the phone copy, not "can't play".
        if (!fromPhone.current && !getNetState().online && hasSavedPreview(video.id) && !renewing.current) {
          void renew();
          return;
        }
        // The token ran out mid-play (a long video): one fresh token, same second.
        if (d.response?.code === 403 && !renewedAfter403.current && !fromPhone.current) {
          renewedAfter403.current = true;
          grant.current = null;
          void renew(true);
          return;
        }
        setFailed(true); pause();
      });
      // A segment really loaded: the 403 retry is available again (a LASTING 403 —
      // a revoked video — must not loop: review #411 C6).
      h.on("hlsFragLoaded", () => { renewedAfter403.current = false; });
      h.loadSource(src);
      h.attachMedia(v);
      hls.current = h;
    }
    attached.current = true;
    // S7b-6: online with a token → the background saver keeps a preview for no
    // network (it applies the member's budget and Wi-Fi rule itself).
    // Only where the phone copy could be played back: hls.js (review #674 — a
    // native HLS player cannot read it, so saving there only fills the phone).
    if (g && engine === "hlsjs" && Hls) {
      const currentUserId = async () => {
        try { return (await supabase.auth.getSession()).data.session?.user?.id ?? null; } catch { return null; }
      };
      void currentUserId()
        .then((uid) => maybeSaveVideoPreview({ userId: uid, videoId: video.id, masterUrl: g.master_url }, getNetState, currentUserId))
        .catch(() => { /* saving is a bonus, never an error */ });
    }
    return true;
  }, [video.id, pause]);

  const start = useCallback(async () => {
    const v = el.current;
    if (!v || playing.current) return;
    playing.current = true;
    if (!(await ensureSource())) { playing.current = false; return; }
    if (!playing.current) return; // paused while the source was being fetched
    claimPlayback(cardId, pause, () => decideRef.current?.());
    const sound = autoplayWithSound({ native: isNativeApp(), pref: getSoundPref(), hasAudio: video.hasAudio, userActivated: userActivated() });
    const r = await startPlayback(v, sound, { stillWanted: () => playing.current });
    setMuted(v.muted);
    if (!playing.current) { v.pause(); return; } // paused (scrolled away, another card) while it was starting
    if (r.ok) {
      setIsPlaying(true);
      setNeedsTap(false);
      setPlayError(null);
    } else {
      const reason = "error" in r ? r.error : "Error";
      // Refused even muted (a power saver, a stream that cannot load): the
      // poster and a Play button — and the reason kept where a device test can read it.
      playing.current = false;
      releasePlayback(cardId);
      setNeedsTap(true);
      setPlayError(reason);
      console.warn(`[video] play refused: ${reason}`);
    }
  }, [cardId, ensureSource, pause, video.hasAudio]);

  // Near the screen → fetch the poster. In view → play. Out of view, tab or app hidden → pause.
  useEffect(() => {
    const node = box.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    let ratio = 0;
    const decide = (): void => {
      const want = shouldPlay({
        ratio, wasPlaying: playing.current,
        tabVisible: document.visibilityState === "visible",
        // S7b-6: with no network, a video saved on the phone still plays by itself.
        online: getNetState().online || hasSavedPreview(video.id), reducedMotion: reducedMotion(),
      });
      // Why it is NOT starting by itself, for a device test to read (reduced motion is a member's system setting).
      node.dataset.autoplayHold = reducedMotion() ? "reduced-motion" : !getNetState().online && !hasSavedPreview(video.id) ? "offline" : "";
      if (want && !playing.current) void start();
      else if (!want && playing.current) pause();
      if (document.visibilityState !== "visible") hideNow();
    };
    decideRef.current = decide;
    const near = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setNear(true); }, { rootMargin: "600px 0px" });
    const view = new IntersectionObserver((es) => { ratio = es[es.length - 1]?.intersectionRatio ?? 0; decide(); }, { threshold: [0, 0.3, 0.6, 1] });
    near.observe(node); view.observe(node);
    document.addEventListener("visibilitychange", decide);
    const onPageHide = () => { if (playing.current) pause(); };
    window.addEventListener("pagehide", onPageHide);
    const off = subscribeNetState(decide);
    return () => {
      decideRef.current = null; near.disconnect(); view.disconnect();
      document.removeEventListener("visibilitychange", decide); window.removeEventListener("pagehide", onPageHide); off();
    };
  }, [start, pause, video.id]);

  // Poster only — the cheapest thing a card near the screen can do.
  useEffect(() => {
    if (!near || grant.current) return;
    // S7b-6: flight mode with a copy on the phone — there is no token to ask for.
    if (!getNetState().online && hasSavedPreview(video.id)) return;
    let live = true;
    // No token and a copy on the phone (flight mode): not a failure — it plays from there.
    void requestGrant(video.id).then((g) => { if (live && g) { grant.current = g; setPoster(g.poster_url); } else if (live && !g && !hasSavedPreview(video.id)) setFailed(true); });
    return () => { live = false; };
  }, [near, video.id]);

  // Leaving the page releases the decoder and the network for good — and lets
  // the card this one paused (the feed card under the comments box) carry on.
  useEffect(() => () => {
    leavePlayback(cardId);
    hls.current?.destroy(); hls.current = null;
    const v = el.current; if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
  }, [cardId]);

  const tapPlay = () => { setNeedsTap(false); void start(); };
  const togglePlay = () => {
    if (playing.current) { pause(); clearHide(); setControlsShown(true); } // paused: the controls stay up
    else { tapPlay(); reveal(); }
  };
  /** The picture: shows the controls (or hides them when they are up). A paused card starts. */
  const tapPicture = () => {
    if (!playing.current) { tapPlay(); reveal(); return; }
    if (controlsShown) hideNow(); else reveal();
  };
  /** Sound only — never play/pause. The choice holds for the session (setSoundPref). */
  const toggleSound = () => {
    const v = el.current;
    const next = !(v ? v.muted : muted);
    if (v) v.muted = next;
    setMuted(next);
    setSoundPref(!next);
    reveal();
  };

  /** A fresh token and the stream re-attached at the same second; playback goes on. */
  const renewing = useRef(false);
  const renewedAfter403 = useRef(false);
  const lastRenewAt = useRef(-Infinity);
  const renew = useCallback(async (fresh = false) => {
    const v = el.current;
    if (!v || renewing.current) return;
    renewing.current = true;
    lastRenewAt.current = performance.now();
    try {
      const wasPlaying = playing.current;
      if (await ensureSource(fresh) && wasPlaying) await v.play().catch(() => {});
    } finally {
      renewing.current = false;
    }
  }, [ensureSource]);

  // A video longer than the 15-minute token: renew it shortly before it ends, mid-play.
  useEffect(() => {
    const v = el.current;
    if (!v) return;
    const onTime = () => {
      if (!playing.current || renewing.current || !attached.current || fromPhone.current) return;
      if (grantDue(grant.current) && performance.now() - lastRenewAt.current >= MIN_RENEW_GAP_MS) void renew();
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [renew]);

  // S12-F1 · video watch %: seconds actually PLAYED ÷ length, reported only when
  // the whole-number % grows — on the element's own timeupdate, no timer.
  const onWatchRef = useRef(onWatchPct);
  onWatchRef.current = onWatchPct;
  useEffect(() => {
    const v = el.current;
    if (!v) return;
    let lastT = v.currentTime;
    let played = 0;
    let reported = -1;
    const onTime = () => {
      const now = v.currentTime;
      if (!v.paused && !v.seeking) played += playedStep(lastT, now);
      lastT = now;
      const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : video.durationS || 0;
      const pct = watchPercent(played, d);
      if (pct > reported && onWatchRef.current) {
        reported = pct;
        onWatchRef.current(pct);
      }
    };
    const onSeeked = () => { lastT = v.currentTime; };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("seeked", onSeeked);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("seeked", onSeeked);
    };
  }, [video.durationS]);

  // Time, length and sound, from the element itself (the stream knows its real length).
  useEffect(() => {
    const v = el.current;
    if (!v) return;
    const onTime = () => { if (!scrubbing.current) setTime(v.currentTime); };
    const onDur = () => { if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration); };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onVolume = () => setMuted(v.muted);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("loadedmetadata", onDur);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("volumechange", onVolume);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("loadedmetadata", onDur);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("volumechange", onVolume);
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
  const endScrub = () => { scrubbing.current = false; scheduleHide(); };

  const progress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div
      ref={box}
      data-testid="feed-video-card"
      data-frame-aspect={VIDEO_FRAME_ASPECT.toFixed(3)}
      data-fill="blurred"
      data-playing={isPlaying ? "true" : "false"}
      data-play-error={playError ?? undefined}
      data-source={source ?? undefined}
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
        onClick={tapPicture}
      />
      {(needsTap || (!isPlaying && !failed && (poster || (!getNetState().online && hasSavedPreview(video.id))))) && (
        <button type="button" aria-label="Play video" onClick={() => { tapPlay(); reveal(); }}
          className="absolute inset-0 m-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white">
          <Play className="h-7 w-7" />
        </button>
      )}
      {source === "phone" && savedPreviewInfo(video.id)?.full === false && (
        <p data-testid="video-saved-preview" className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
          Saved preview · first {Math.round(savedPreviewInfo(video.id)!.seconds)} s
        </p>
      )}
      {failed && (
        <p role="status" className="absolute inset-x-0 bottom-12 bg-black/70 p-2 text-center text-xs text-white">
          This video can't play right now.
        </p>
      )}
      {/* The controls: hidden until a tap (Meta-style); never toggle playback themselves (taps stop here). */}
      <div
        data-testid="video-controls"
        data-visible={controlsShown ? "true" : "false"}
        onClick={(e) => e.stopPropagation()}
        onFocus={() => { focusInside.current = true; reveal(); }}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; // focus moved within the controls
          focusInside.current = false;
          scheduleHide();
        }}
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/40 to-transparent pt-6 text-white transition-opacity duration-300 focus-within:pointer-events-auto focus-within:opacity-100 ${controlsShown ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <div className="flex items-center gap-1 px-1">
          <button type="button" aria-label={isPlaying ? "Pause" : "Play"} onClick={togglePlay}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-white/15">
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <span className="shrink-0 text-[11px] tabular-nums drop-shadow" data-testid="video-clock">
            {formatClock(time)} / {formatClock(duration)}
          </span>
          <span className="flex-1" />
          {video.hasAudio && (
            <button type="button" aria-label={muted ? "Turn sound on" : "Turn sound off"} aria-pressed={!muted}
              onClick={toggleSound}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-white/15">
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
          )}
        </div>
        {/* The bar: 3 px to the eye, 44 px to the finger (an invisible range input over it). */}
        <div className="relative h-11 w-full" data-testid="video-progress">
          <div aria-hidden="true" data-testid="video-progress-track" className="pointer-events-none absolute inset-x-2 bottom-3 h-[3px] rounded-full bg-white/30">
            <div className="h-full rounded-full bg-white/80" style={{ width: `${progress}%` }} />
          </div>
          <input
            type="range"
            aria-label="Seek"
            aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
            min={0}
            max={Math.max(0.1, duration)}
            step={0.1}
            value={Math.min(time, Math.max(0.1, duration))}
            onPointerDown={() => { scrubbing.current = true; clearHide(); }}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
            onChange={(e) => { seek(Number(e.target.value)); if (!scrubbing.current) scheduleHide(); }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
      </div>
    </div>
  );
}
