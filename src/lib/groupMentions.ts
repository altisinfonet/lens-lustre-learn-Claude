// @followers and @all (Owner 2026-11-12, plan PLAN-2026-11-12-mention-all-followers.md).
//
// ONE list of group tags, offered by BOTH @mention lists — the caption box
// (useCaptionMentions) and the comment box (MentionInput) — so they can never
// offer different things. The app only OFFERS the tags: the server reads the
// saved text and decides (verified rule, daily limits, once per post). A
// hacked app that writes "@all" without the right gets nothing.
//
// Stored like a person mention: @[@all](all), @[@followers](followers).
// "all" / "followers" are reserved names, never a member id.

export type GroupMentionId = "all" | "followers";

export interface GroupMention {
  id: GroupMentionId;
  /** What is inserted and shown, with its "@". */
  display: string;
  /** One line under the tag in the list. */
  hint: string;
  group: true;
  avatar_url: null;
}

export const GROUP_MENTIONS: readonly GroupMention[] = [
  { id: "followers", display: "@followers", hint: "Tag your followers", group: true, avatar_url: null },
  { id: "all", display: "@all", hint: "Tag everyone", group: true, avatar_url: null },
];

let state = { on: false, canAll: false };

/** Switched by the feature flag (and the sample harness). Off = no group tags offered. */
export function setGroupMentions(next: { on: boolean; canAll: boolean }): void {
  state = { ...next };
}

/** Group tags matching what was typed after "@" ("" = just "@"). @all only for a verified member. */
export function groupMentionOptions(query: string): GroupMention[] {
  if (!state.on) return [];
  const q = query.trim().toLowerCase().replace(/^@/, "");
  return GROUP_MENTIONS.filter((g) => (g.id !== "all" || state.canAll) && g.id.startsWith(q));
}

export const isGroupMention = (s: { group?: boolean } | null | undefined): s is GroupMention => s?.group === true;

/** "all" / "followers" in a stored mention @[..](id) — a group tag, not a member id. */
export const isGroupMentionId = (id: string): boolean => id === "all" || id === "followers";
