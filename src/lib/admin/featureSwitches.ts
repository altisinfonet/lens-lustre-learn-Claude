/**
 * VID-7 / R-103 · Admin → Features: the pure half (labels, parsing, wording).
 *
 * The database stores a mode as 'off' | 'selected' | 'everyone'. The Owner's
 * words on the screen are "Off" / "Selected members" / "All members" (R-103);
 * this file is the only place the two vocabularies meet.
 *
 * Everything here is display logic. The SERVER decides (feature_set_mode checks
 * admin, refuses copyright_music_check On without the music-API key, writes one
 * audit row); a page that hides a control is never the enforcement.
 */
export type FeatureKey = "video_posts" | "video_ads" | "copyright_music_check";
export type FeatureMode = "off" | "selected" | "everyone";

export const FEATURE_MODES: ReadonlyArray<{ mode: FeatureMode; label: string }> = [
  { mode: "off", label: "Off" },
  { mode: "selected", label: "Selected members" },
  { mode: "everyone", label: "All members" },
];

export const FEATURE_INFO: Record<FeatureKey, { title: string; blurb: string }> = {
  video_posts: { title: "Video posts", blurb: "Who can add a video to a post." },
  video_ads: { title: "Video ads", blurb: "Whether admins can add a video to an ad." },
  copyright_music_check: {
    title: "Copyright music check",
    blurb: "Checks the sound of every video before it can be posted. Cannot be switched on until the music-API key is set.",
  },
};

export const NOTE_MAX = 500;
export const SEARCH_MIN = 2;

export function modeLabel(mode: string | null | undefined): string {
  return FEATURE_MODES.find((m) => m.mode === mode)?.label ?? String(mode ?? "—");
}

export interface FeatureMember { user_id: string; full_name: string | null; username: string | null; avatar_url: string | null; added_at: string; note: string | null }
export interface FeatureHistoryRow { at: string; actor: string | null; action: "mode" | "add" | "remove"; old: string | null; new: string | null; user_id: string | null; note: string | null }
export interface FeatureState {
  feature: FeatureKey;
  mode: FeatureMode;
  note: string | null;
  updated_at: string | null;
  /** only meaningful for copyright_music_check */
  key_configured: boolean | null;
  members: FeatureMember[];
  history: FeatureHistoryRow[];
}

const FEATURES = new Set<string>(["video_posts", "video_ads", "copyright_music_check"]);
const MODES = new Set<string>(["off", "selected", "everyone"]);

/** feature_admin_state() → cards. Unknown features / modes are dropped, never guessed. */
export function parseFeatureState(raw: unknown): FeatureState[] {
  if (!Array.isArray(raw)) return [];
  const out: FeatureState[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r.feature !== "string" || !FEATURES.has(r.feature)) continue;
    if (typeof r.mode !== "string" || !MODES.has(r.mode)) continue;
    out.push({
      feature: r.feature as FeatureKey,
      mode: r.mode as FeatureMode,
      note: typeof r.note === "string" ? r.note : null,
      updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
      key_configured: typeof r.key_configured === "boolean" ? r.key_configured : null,
      members: Array.isArray(r.members) ? (r.members as FeatureMember[]).filter((m) => m && typeof m.user_id === "string") : [],
      history: Array.isArray(r.history) ? (r.history as FeatureHistoryRow[]).filter((h) => h && typeof h.at === "string") : [],
    });
  }
  return out;
}

/** Can this mode be chosen right now? (The server re-checks.) */
export function modeSelectable(feature: FeatureKey, mode: FeatureMode, keyConfigured: boolean | null): boolean {
  if (feature === "copyright_music_check" && mode !== "off") return keyConfigured === true;
  return true;
}

/** Has the admin changed anything that Save would write? */
export function isDirty(s: Pick<FeatureState, "mode" | "note">, draftMode: FeatureMode, draftNote: string): boolean {
  return s.mode !== draftMode || (s.note ?? "") !== draftNote.trim();
}

/** Server error → words an admin can act on. Codes are from 20261005_0004_vid7_feature_access.sql. */
export function featureErrorMessage(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? "";
  if (m.includes("FEATURE-003")) return "The copyright music check can't be turned on yet — the music-API key isn't set.";
  if (m.includes("FEATURE-001")) return "Only an admin can change this.";
  if (m.includes("FEATURE-002")) return "That change isn't valid.";
  return "Couldn't save — try again.";
}

/** One audit row in plain words. `who` resolves a user id to a name (falls back to a short id). */
export function describeHistory(h: FeatureHistoryRow, who: (id: string | null) => string): string {
  const actor = who(h.actor);
  if (h.action === "mode") return `${actor} changed it from ${modeLabel(h.old)} to ${modeLabel(h.new)}`;
  if (h.action === "add") return `${actor} added ${who(h.user_id)}`;
  return `${actor} removed ${who(h.user_id)}`;
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "system";
}

/**
 * Two letters for a member's avatar when they have no photo (F-AUD-6): first +
 * last word of the name, else the first two of a one-word name or username,
 * else "?". Never empty — an empty circle reads as a loading glitch.
 */
export function memberInitials(m: { full_name: string | null; username: string | null }): string {
  const words = (m.full_name || m.username || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}
