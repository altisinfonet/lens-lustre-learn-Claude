import { supabase } from "@/integrations/supabase/client";

export interface Competition {
  id: string; title: string; category: string; status: string; phase: string; ends_at: string; voting_ends_at?: string | null; entry_count?: number;
}
export interface JudgingTag {
  id: string; label: string; color: string; icon?: string | null; image_url?: string | null;
  visible_in_round?: number[] | null;
}
export interface JudgingRound {
  id: string; round_number: number; name: string; status: string;
}
export interface JudgeComment {
  id: string; comment: string; created_at: string; round_id: string | null; judge_id: string; judge_name?: string;
}
export interface JudgePhotoComment extends JudgeComment {
  entry_id: string; photo_index: number;
}
export interface JudgeEntry {
  id: string; title: string; description: string | null;
  photos: string[];
  /** SOW v2.1 Step 5: ~150–250KB WebP thumbnails (mirrors photos[] index) for grid/filmstrip rendering. Falls back to photos[i] when null. */
  photo_thumbnails: string[] | null;
  /** SOW EXIF v2: per-photo metadata { url, thumbnail_url, title, exif, exif_available, raw_required, image_hash }. */
  photo_meta: any[] | null;
  user_id: string;
  status: string; placement: string | null; created_at: string; competition_id: string;
  photographer_name: string | null; photographer_avatar: string | null; vote_count: number; my_score: number | null;
  my_feedback: string | null; avg_score: number | null; is_ai_generated: boolean;
  ai_detection_result: any[] | null; exif_data: any | null;
  my_tags: string[]; all_tags: { tag_id: string; judge_id: string }[];
  all_scores: { judge_id: string; score: number }[];
  my_comments: JudgeComment[];
}
/**
 * SOW v2.1 Step 5 — split URLs:
 *  - photoUrl       = full original (used by lightbox / Cinema full view ONLY)
 *  - photoThumbUrl  = lightweight WebP thumbnail (used by every grid/list/filmstrip)
 * The two are equal when no thumbnail exists for that entry (graceful fallback).
 */
export interface FlatPhoto {
  entryId: string;
  photoUrl: string;
  photoThumbUrl: string;
  photoIndex: number;
  entry: JudgeEntry;
}

export const getJudgePhotoMeta = (photo: FlatPhoto): any | null => {
  const meta = Array.isArray(photo.entry?.photo_meta) ? photo.entry.photo_meta[photo.photoIndex] : null;
  return meta && typeof meta === "object" ? meta : null;
};

export const getJudgePhotoTitle = (photo: FlatPhoto): string => {
  const meta = getJudgePhotoMeta(photo);
  return typeof meta?.title === "string" && meta.title.trim().length > 0
    ? meta.title.trim()
    : photo.entry.title;
};

export type SidebarView = "round" | "rejected" | "accepted" | "shortlisted" | "stayed" | "needs_review" | "completed" | "unjudged" | "qualified" | "finalist" | "winner" | "runner_up_1" | "runner_up_2" | "honorary_mention" | "special_jury" | `shortlisted_tag_${string}`;

export interface PhotoEvaluation {
  score: number | null; tags: string[]; feedback: string | null;
  allScores: { judge_id: string; score: number }[]; comments: JudgeComment[];
  criteria: CriteriaScores;
  decision?: string | null;
}

export interface CriteriaScores {
  composition: number | null;
  color_palette: number | null;
  technique: number | null;
  line: number | null;
  shape: number | null;
  form: number | null;
  texture: number | null;
  space: number | null;
  tone: number | null;
  balance: number | null;
  light: number | null;
  depth: number | null;
}

export const DEFAULT_CRITERIA: CriteriaScores = {
  composition: null, color_palette: null, technique: null,
  line: null, shape: null, form: null, texture: null,
  space: null, tone: null, balance: null, light: null, depth: null,
};

export const CRITERIA_KEYS = [
  "composition", "color_palette", "technique",
  "line", "shape", "form", "texture", "space", "tone", "balance", "light", "depth",
] as const;

/**
 * SOW Round 2–4: exactly 10 criteria authoritative for scoring.
 * Phase 5 conformance: submit-judge-score edge function accepts ONLY these keys.
 */
export const SOW_ROUND4_CRITERIA_KEYS = [
  "line", "shape", "form", "texture", "color_palette", "space", "tone", "balance", "light", "depth",
] as const;

/**
 * Legacy criteria retained in DB for audit trail (judge_scores columns exist)
 * but NEVER surfaced in R2+ UI and REJECTED by submit-judge-score edge fn.
 */
export const LEGACY_CRITERIA_KEYS = ["composition", "technique"] as const;

export const CRITERIA_LABELS: Record<string, string> = {
  composition: "Composition", color_palette: "Color Palette", technique: "Technique",
  line: "Line", shape: "Shape", form: "Form", texture: "Texture",
  space: "Space", tone: "Tone", balance: "Balance", light: "Light", depth: "Depth",
};

/** SOW Round 4 display labels (Color Palette → "Color" for SOW alignment) */
export const SOW_ROUND4_CRITERIA_LABELS: Record<string, string> = {
  line: "Line", shape: "Shape", form: "Form", texture: "Texture",
  color_palette: "Color", space: "Space", tone: "Tone", balance: "Balance",
  light: "Light", depth: "Depth",
};

export interface PhotoScoreData {
  myScore: number | null;
  myFeedback: string | null;
  myCriteria: CriteriaScores;
  allScores: { judge_id: string; score: number }[];
}
export interface PhotoTagData {
  myTags: string[];
  allTags: { tag_id: string; judge_id: string }[];
}

export interface PhotoDecisionData {
  myDecision: string | null;
  allDecisions: { judge_id: string; decision: string; round_number: number }[];
}

export interface PhotoDataMaps {
  photoScoresMap: Record<string, PhotoScoreData>;
  photoTagsMap: Record<string, PhotoTagData>;
  photoCommentsMap: Record<string, JudgeComment[]>;
  photoDecisionsMap: Record<string, PhotoDecisionData>;
}

export const ENTRIES_PAGE_SIZE = 50;

export const normalizePhotoIndex = (value: unknown): number => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export const fetchInBatches = async (
  buildQuery: (ids: string[]) => any,
  ids: string[],
  batchSize = 500,
): Promise<any[]> => {
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);
    let from = 0;
    while (true) {
      const { data } = await buildQuery(chunk).range(from, from + 999);
      if (!data || data.length === 0) break;
      results.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  return results;
};
