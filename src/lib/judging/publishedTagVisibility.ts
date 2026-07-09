import { classifyTag } from "@/lib/judging/tagSemantics";
import type { PerPhotoStatus } from "@/lib/judging/perPhotoStatusTypes";

export interface PublishedTagAssignment {
  entry_id: string;
  tag_id: string;
  photo_index: number;
  created_at: string | null;
}

export interface PublishedTagInfo {
  label: string;
  color: string;
  icon?: string;
  image_url?: string | null;
}

export type EntryTagMap<T extends PublishedTagInfo = PublishedTagInfo> = Record<string, T[]>;
export type EntryTagsByPhotoMap<T extends PublishedTagInfo = PublishedTagInfo> = Record<string, Record<number, T[]>>;
export type TagDerivedStatusMap = Record<string, Record<number, PerPhotoStatus>>;

export function tagVisibleInPublishedRounds(
  tagId: string,
  tagRoundMap: ReadonlyMap<string, number[]>,
  publishedRounds: ReadonlySet<number>,
): boolean {
  const rounds = tagRoundMap.get(tagId) || [];
  return rounds.length > 0 && rounds.some((round) => publishedRounds.has(Number(round)));
}

export function selectLatestPublishedTagAssignments(
  assignments: readonly PublishedTagAssignment[],
  tagRoundMap: ReadonlyMap<string, number[]>,
  publishedRounds: ReadonlySet<number>,
): PublishedTagAssignment[] {
  const latestVisible = new Map<string, PublishedTagAssignment>();

  for (const assignment of assignments) {
    if (!tagVisibleInPublishedRounds(assignment.tag_id, tagRoundMap, publishedRounds)) continue;

    const key = `${assignment.entry_id}::${assignment.photo_index}`;
    const previous = latestVisible.get(key);
    const previousTime = previous?.created_at ? new Date(previous.created_at).getTime() : -1;
    const currentTime = assignment.created_at ? new Date(assignment.created_at).getTime() : 0;
    if (!previous || currentTime >= previousTime) latestVisible.set(key, assignment);
  }

  return Array.from(latestVisible.values());
}

export function participantStatusFromPublishedTag(
  info: PublishedTagInfo,
  rounds: readonly number[],
): PerPhotoStatus | null {
  const semantic = classifyTag({ label: info.label, visible_in_round: [...rounds] });

  if (semantic.family === "rejection") return "rejected";
  if (semantic.family === "progression_pass") {
    if (semantic.advancesToRound === 2) return "round1_qualified";
    if (semantic.advancesToRound === 3) return "round2_qualified";
    if (semantic.advancesToRound === 4) return "finalist";
  }
  if (semantic.family === "progression_fail" && semantic.blocksFromRound === 2) return "rejected";
  return null;
}

export function buildPublishedParticipantTagMaps<T extends PublishedTagInfo>(
  assignments: readonly PublishedTagAssignment[],
  tagInfoMap: ReadonlyMap<string, T>,
  tagRoundMap: ReadonlyMap<string, number[]>,
  publishedRounds: ReadonlySet<number>,
): {
  entryTagMap: EntryTagMap<T>;
  entryTagsByPhotoMap: EntryTagsByPhotoMap<T>;
  tagDerivedStatusByEntryPhoto: TagDerivedStatusMap;
} {
  const entryTagMap: EntryTagMap<T> = {};
  const entryTagsByPhotoMap: EntryTagsByPhotoMap<T> = {};
  const tagDerivedStatusByEntryPhoto: TagDerivedStatusMap = {};

  for (const assignment of selectLatestPublishedTagAssignments(assignments, tagRoundMap, publishedRounds)) {
    const info = tagInfoMap.get(assignment.tag_id);
    if (!info) continue;

    const derived = participantStatusFromPublishedTag(info, tagRoundMap.get(assignment.tag_id) || []);
    if (derived) {
      tagDerivedStatusByEntryPhoto[assignment.entry_id] ??= {};
      tagDerivedStatusByEntryPhoto[assignment.entry_id][assignment.photo_index] = derived;
    }

    entryTagMap[assignment.entry_id] ??= [];
    if (!entryTagMap[assignment.entry_id].some((tag) => tag.label === info.label)) {
      entryTagMap[assignment.entry_id].push(info);
    }

    entryTagsByPhotoMap[assignment.entry_id] ??= {};
    entryTagsByPhotoMap[assignment.entry_id][assignment.photo_index] = [info];
  }

  return { entryTagMap, entryTagsByPhotoMap, tagDerivedStatusByEntryPhoto };
}