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
let current: { id: string; pause: Pauser } | null = null;
export function claimPlayback(id: string, pause: Pauser): void {
  if (current && current.id !== id) { try { current.pause(); } catch { /* a stale card must not block the next */ } }
  current = { id, pause };
}
export function releasePlayback(id: string): void {
  if (current?.id === id) current = null;
}
export function currentPlaybackId(): string | null { return current?.id ?? null; }
export function resetPlayback(): void { current = null; }
