/**
 * PHOTO PLAN U4 · "SAVE MOBILE DATA" (Owner decision 6, 2026-11-02; switch
 * `photo_set_v2` — with the switch OFF nothing reads this and nothing changes).
 *
 *   · A member setting, kept on THIS device (it is about this phone's data plan,
 *     so it does not follow the member to another device). Default: off.
 *   · When it is on and the phone is on mobile data, every photo is ONE SIZE
 *     DOWN: feed 1080 → 600, full screen 2048 → 1080, inline 1080 → 600
 *     (grids are already the smallest copy, 320). Videos start on 240p and
 *     never climb above 480p.
 *   · Which link the device is on comes from `navigator.connection.type`
 *     (Chromium and the Android app's WebView). A device that cannot say
 *     (iPhone, desktop Safari / Firefox) is treated as POSSIBLY mobile data,
 *     the same rule "Save videos only on Wi-Fi" already uses
 *     (offlineVideo.canSaveVideoNow): a member who turned the saver on there
 *     gets the saving, never a surprise bill.
 *
 * Storage may throw or be empty (private mode, blocked site data): every access
 * is guarded and the answer is then "off" / memory only.
 * Imports nothing, so any module may use it.
 */
export const SAVE_MOBILE_DATA_KEY = "50mm.saveMobileData";

/** What the device says it is connected through. */
export type LinkKind = "wifi" | "mobile" | "unknown";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => { try { f(); } catch { /* a listener must not break the others */ } });

let memo: boolean | undefined;

export function getSaveMobileData(): boolean {
  if (memo === undefined) {
    memo = false;
    try { memo = globalThis.localStorage?.getItem(SAVE_MOBILE_DATA_KEY) === "on"; } catch { /* blocked: off */ }
  }
  return memo;
}

export function setSaveMobileData(on: boolean): void {
  memo = on;
  try { globalThis.localStorage?.setItem(SAVE_MOBILE_DATA_KEY, on ? "on" : "off"); } catch { /* memory only */ }
  emit();
}

interface NetInfo { type?: string; addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void }
function connection(): NetInfo | undefined {
  try { return (globalThis.navigator as unknown as { connection?: NetInfo } | undefined)?.connection; } catch { return undefined; }
}

/** wifi / ethernet → "wifi"; cellular (and tethering kinds) → "mobile"; anything else → "unknown". */
export function linkKindOf(type: string | undefined): LinkKind {
  if (type === "wifi" || type === "ethernet") return "wifi";
  if (type === "cellular" || type === "bluetooth" || type === "wimax") return "mobile";
  return "unknown";
}

export function getLinkKind(): LinkKind {
  return linkKindOf(connection()?.type);
}

/** Is a size-down due right now? Only with the setting on, and never on a link the device names as Wi-Fi. */
export function savingDataNow(setting: boolean, kind: LinkKind): boolean {
  return setting && kind !== "wifi";
}

/** Setting changes and link changes both notify. */
export function subscribeDataSaver(fn: () => void): () => void {
  listeners.add(fn);
  const c = connection();
  try { c?.addEventListener?.("change", fn); } catch { /* not supported */ }
  return () => {
    listeners.delete(fn);
    try { c?.removeEventListener?.("change", fn); } catch { /* not supported */ }
  };
}

/** Test seam. */
export function resetDataSaver(): void {
  memo = undefined;
}
