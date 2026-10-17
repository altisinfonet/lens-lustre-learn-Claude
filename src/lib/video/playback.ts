/**
 * VID-1 part 2 · THE FEED PLAYER'S RULES — pure, so they can be tested without a browser.
 *
 * Owner (R-97/R-105): muted autoplay while the card is in view, pause when it
 * is out of view, 240p on a slow network, every card 9:16.
 *
 *   play      ⇔ in view ≥ PLAY_RATIO  AND  tab visible  AND  online  AND  not reduced-motion
 *   pause     ⇔ anything above stops being true (hysteresis: leave below PAUSE_RATIO)
 *   quality   : slow or Data Saver → the 240p level only (autoLevelCapping = 0);
 *               otherwise start on 240p for a fast first frame and let ABR climb
 *   one at a time: starting a card pauses the one before it (a phone has one speaker
 *               and one hardware decoder budget)
 *   token     : 15 min (play-token.ts); asked again only when playback STARTS inside
 *               the last TOKEN_REFRESH_MARGIN_S — no timer (D2 skill: nothing faster
 *               than 1 s, every repeating timer cleared on visibilitychange).
 */
export const PLAY_RATIO = 0.6;
export const PAUSE_RATIO = 0.3;
export const TOKEN_REFRESH_MARGIN_S = 90;

export interface PlayInputs {
  /** IntersectionObserver ratio of the card, 0..1 */
  ratio: number;
  /** was it playing a moment ago? (hysteresis: stay playing until it falls below PAUSE_RATIO) */
  wasPlaying: boolean;
  tabVisible: boolean;
  online: boolean;
  reducedMotion: boolean;
}

export function shouldPlay(i: PlayInputs): boolean {
  if (!i.tabVisible || !i.online || i.reducedMotion) return false;
  return i.ratio >= (i.wasPlaying ? PAUSE_RATIO : PLAY_RATIO);
}

export interface LevelLike { height?: number; bitrate?: number }

/**
 * Which hls.js level may be used. hls.js sorts levels by bitrate, so index 0 is
 * the smallest. The 240p rendition is always made and always the smallest
 * (VID-1 §2), so "240p only" is level 0. Returns the highest allowed index;
 * `Infinity` means no cap.
 */
export function levelCap(levels: readonly LevelLike[], slow: boolean): number {
  if (!slow || levels.length === 0) return Number.POSITIVE_INFINITY;
  let low = 0;
  for (let i = 1; i < levels.length; i++) {
    const a = levels[i], b = levels[low];
    if ((a.height ?? Infinity) < (b.height ?? Infinity) || ((a.height ?? 0) === (b.height ?? 0) && (a.bitrate ?? Infinity) < (b.bitrate ?? Infinity))) low = i;
  }
  return low;
}

export function tokenNeedsRefresh(expiresAtS: number | null | undefined, nowS: number): boolean {
  if (typeof expiresAtS !== "number" || !Number.isFinite(expiresAtS)) return true;
  return expiresAtS - nowS <= TOKEN_REFRESH_MARGIN_S;
}

/** One card plays at a time. */
type Pauser = () => void;
interface Holder { id: string; pause: Pauser; resume?: () => void }
let current: Holder | null = null;
/**
 * The card a newer one paused, and who paused it. When that newer card goes
 * AWAY (unmounts — the comments box closing over the feed card it copied), the
 * paused card is asked to decide again (`resume` re-runs its own in-view rule,
 * it never forces play). Review #415: the feed video used to sit paused behind
 * a Play button after the comments box closed. A card that is merely paused
 * (a tap, scrolled away) hands nothing back — tapping pause in the comments box
 * must not start the video behind it.
 */
let preempted: { card: Holder; by: string } | null = null;
export function claimPlayback(id: string, pause: Pauser, resume?: () => void): void {
  const prev = current; // its pause() releases it, which clears `current`
  if (prev && prev.id !== id) {
    try { prev.pause(); } catch { /* a stale card must not block the next */ }
    preempted = { card: prev, by: id };
  }
  if (preempted?.card.id === id) preempted = null; // it is playing again by itself
  current = { id, pause, resume };
}
export function releasePlayback(id: string): void {
  if (current?.id === id) current = null;
}
/** The card is gone for good (unmounted): release it, and let the card it paused decide again. */
export function leavePlayback(id: string): void {
  releasePlayback(id);
  const p = preempted;
  if (p?.card.id === id) { preempted = null; return; }
  if (p?.by === id) {
    preempted = null;
    try { p.card.resume?.(); } catch { /* a stale card must not throw into an unmount */ }
  }
}
export function currentPlaybackId(): string | null { return current?.id ?? null; }
export function resetPlayback(): void { current = null; preempted = null; }

/* ── Sound (Owner 2026-10-18: "autoplay with sound, like the Instagram app") ──
 *
 *   APP (Capacitor, native): autoplay WITH sound by default. Capacitor's own
 *     WebView setup turns the gesture rule off (Bridge.initWebView:
 *     setMediaPlaybackRequiresUserGesture(false); android-build.yml asserts it),
 *     so the WebView lets an unmuted video start without a tap. The member can
 *     mute; that choice holds for the rest of the session.
 *   WEB: a browser only lets a MUTED video start by itself (Chrome / Safari /
 *     Firefox autoplay policy). So: muted autoplay, until the member unmutes
 *     once — that is remembered for the session, and later videos start WITH
 *     sound once the page has had a user activation (navigator.userActivation).
 *     If the browser still refuses sound, the video starts muted instead —
 *     never a paused card or an error because of it (startPlayback below).
 *
 * The session choice lives in sessionStorage (a per-tab convenience; storage
 * may throw or be empty — every access is guarded) and in memory.
 */
const SOUND_KEY = "50mm.video.sound";
let soundPref: boolean | null | undefined; // undefined = not read yet

export const isNativeApp = (): boolean => {
  try { return (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true; } catch { return false; }
};

/** The member's sound choice this session: true (on), false (off) or null (never chose). */
export function getSoundPref(): boolean | null {
  if (soundPref === undefined) {
    soundPref = null;
    try {
      const v = globalThis.sessionStorage?.getItem(SOUND_KEY);
      if (v === "on") soundPref = true; else if (v === "off") soundPref = false;
    } catch { /* storage blocked: memory only */ }
  }
  return soundPref;
}
export function setSoundPref(on: boolean): void {
  soundPref = on;
  try { globalThis.sessionStorage?.setItem(SOUND_KEY, on ? "on" : "off"); } catch { /* memory only */ }
}
export function resetSoundPref(): void {
  soundPref = undefined;
  try { globalThis.sessionStorage?.removeItem(SOUND_KEY); } catch { /* nothing */ }
}

export interface SoundInputs { native: boolean; pref: boolean | null; hasAudio: boolean; userActivated: boolean | null }
/**
 * Should the NEXT autoplay start with sound?  `userActivated`: the page has had
 * a tap/click/key (navigator.userActivation.hasBeenActive), null when the
 * browser cannot say (then we try, and startPlayback falls back to muted).
 */
export function autoplayWithSound(i: SoundInputs): boolean {
  if (!i.hasAudio) return false;
  if (i.native) return i.pref !== false;
  return i.pref === true && i.userActivated !== false;
}

export const userActivated = (): boolean | null => {
  try {
    const ua = (globalThis.navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } } | undefined)?.userActivation;
    return typeof ua?.hasBeenActive === "boolean" ? ua.hasBeenActive : null;
  } catch { return null; }
};

/* ── Which HLS engine ───────────────────────────────────────────────────────
 * Android WebView/Chrome answer canPlayType("application/vnd.apple.mpegurl")
 * with "maybe": Chromium registers the HLS MIME types whenever its built-in
 * HLS demuxer is compiled in (media/base/mime_util_internal.cc, under
 * ENABLE_HLS_DEMUXER, which media_options.gni defaults to proprietary_codecs —
 * true for Chrome and WebView builds). Up to app 1.2.23 the card asked
 * canPlayType FIRST, so inside the app it skipped hls.js and handed the bare
 * playlist to the WebView's own player — a path no browser test of ours
 * takes, without the 240p cap, and the one on which the app's in-view
 * autoplay did not start (Owner, app 1.2.23): its play() was called in the
 * same task as `src =` on a preload="none" element, and ANY refusal was
 * caught and turned into the Play button, with no retry and no trace.
 * Rule now: hls.js whenever the browser has Media Source Extensions; the
 * native player only on Apple WebKit (where it is the better player) or where
 * there is no MSE at all.
 */
export type HlsEngine = "hlsjs" | "native" | "none";
export function pickHlsEngine(i: { nativeHls: boolean; mse: boolean; appleWebKit: boolean }): HlsEngine {
  if (i.nativeHls && (i.appleWebKit || !i.mse)) return "native";
  if (i.mse) return "hlsjs";
  return i.nativeHls ? "native" : "none";
}
export const isAppleWebKit = (ua: string, platform: string | null = null): boolean =>
  platform === "ios" || /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Android|Firefox/.test(ua));

/* ── Starting playback without ever showing a broken card ───────────────────
 * play() can be refused: NotAllowedError (sound without a gesture, a power
 * saver), AbortError (the load the play() was waiting on was replaced). The old
 * card caught every refusal and silently showed a Play button. Now:
 *   1. the `muted` PROPERTY is set before play() is called (never left to a
 *      re-render);
 *   2. with sound refused → the same video again, muted;
 *   3. AbortError → once more when the element says it can play;
 *   4. only then a Play button — and the reason is kept (data-play-error) so a
 *      device test can read it.
 */
export interface MediaLike {
  muted: boolean;
  play(): Promise<void> | void;
  addEventListener(t: string, f: () => void, o?: { once?: boolean }): void;
  removeEventListener(t: string, f: () => void): void;
}
export type StartResult = { ok: true; muted: boolean } | { ok: false; error: string };
const errName = (e: unknown): string => (e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "Error");
const waitCanPlay = (m: MediaLike, ms: number) => new Promise<void>((done) => {
  const t = setTimeout(fin, ms);
  function fin() { clearTimeout(t); m.removeEventListener("canplay", fin); done(); }
  m.addEventListener("canplay", fin, { once: true });
});
/**
 * `stillWanted` (review #449): asked before every retry — a card that was
 * stopped meanwhile (scrolled past, taken over by another card, paused) is
 * never started again by a retry (no sound blip, never two videos at once).
 */
export async function startPlayback(m: MediaLike, withSound: boolean, opts: { abortRetryMs?: number; stillWanted?: () => boolean } = {}): Promise<StartResult> {
  const wanted = () => opts.stillWanted?.() !== false;
  let muted = !withSound;
  let abortRetried = false;
  for (;;) {
    m.muted = muted;
    try {
      await m.play();
      return { ok: true, muted };
    } catch (e) {
      const name = errName(e);
      if (!wanted()) return { ok: false, error: name };
      if (!muted && name !== "AbortError") { muted = true; continue; } // sound refused: start muted instead
      if (name === "AbortError" && !abortRetried) {
        abortRetried = true;
        await waitCanPlay(m, opts.abortRetryMs ?? 4000);
        if (!wanted()) return { ok: false, error: name };
        continue;
      }
      return { ok: false, error: name };
    }
  }
}

/** Meta-style controls: hidden until a tap, then gone again after this long (while playing). */
export const CONTROLS_HIDE_MS = 2500;
