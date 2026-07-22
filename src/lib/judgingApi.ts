/**
 * judgingApi — Phase 0.5 client wrapper for the 3 new edge functions.
 *
 * Cutover strategy: DUAL-WRITE WINDOW.
 * - submitJudgeDecision / submitJudgeScore are called BEFORE the existing
 *   PostgREST upsert in useJudgeActions.ts. They never throw to the caller —
 *   any error is logged and the existing PostgREST write proceeds as the
 *   safety net.
 * - getJudgeSessionResume is read-only; current useJudgeSession PostgREST
 *   read remains the primary path. This wrapper exists for parity testing.
 *
 * All three call SOW-aligned edge fns and return structured results so the
 * Phase 0.5 audit can compare server vs client outcomes row-for-row.
 */
import { supabase } from "@/integrations/supabase/client";

export interface DecisionPayload {
  entry_id: string;
  photo_index: number;
  round_number: number;
  decision: string;
}

export interface ScorePayload {
  entry_id: string;
  photo_index: number;
  round_number: number;
  score?: number | null;
  feedback?: string | null;
  criteria?: Record<string, number | null>;
  /** MASTER-KEY seat mode: admin-only; store under this judge's identity. */
  as_judge_id?: string;
}

export interface DualWriteResult {
  ok: boolean;
  source: "edge" | "edge-error";
  error?: string;
  data?: any;
}

async function callEdge(name: string, body: unknown): Promise<DualWriteResult> {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      console.warn(`[judgingApi:${name}] edge error`, error);
      return { ok: false, source: "edge-error", error: String(error.message ?? error) };
    }
    if (data && (data as any).ok === false) {
      return { ok: false, source: "edge-error", error: (data as any).error ?? "unknown", data };
    }
    return { ok: true, source: "edge", data };
  } catch (e: any) {
    console.warn(`[judgingApi:${name}] threw`, e);
    return { ok: false, source: "edge-error", error: e?.message ?? String(e) };
  }
}

// Judging v5: submitJudgeDecisionEdge removed — Accept/Reject/Needs-Review/
// Shortlist vocabulary is gone. All judge decisions now flow through tag
// clicks via judge_tag_assignments. The submit-judge-decision edge function
// has been deleted.

export function submitJudgeScoreEdge(p: ScorePayload) {
  return callEdge("submit-judge-score", p);
}

// JP-H-2 Phase A — dual-write wrappers. Never throw; direct write in
// useJudgeActions remains as safety net during the dual-write window.
export interface TagTogglePayload {
  entry_id: string;
  photo_index: number;
  round_number: number;
  tag_id: string;
  /** MASTER-KEY seat mode: admin-only; store under this judge's identity. */
  as_judge_id?: string;
}
export function submitJudgeTagEdge(p: TagTogglePayload) {
  return callEdge("submit-judge-tag", p);
}

export interface CommentPayload {
  entry_id: string;
  photo_index: number;
  comment: string;
  round_id?: string | null;
  /** MASTER-KEY seat mode: admin-only; store under this judge's identity. */
  as_judge_id?: string;
}
export function submitJudgeCommentEdge(p: CommentPayload) {
  return callEdge("submit-judge-comment", p);
}

export async function getJudgeSessionResume(competition_id: string) {
  const { data, error } = await supabase.functions.invoke("judge-session-resume", {
    body: { competition_id },
  });
  if (error) throw error;
  return data as {
    ok: boolean;
    session: any | null;
    resume:
      | {
          entry_id: string;
          entry_index: number;
          photo_index: number;
          entry_exists: boolean;
          photo_in_range: boolean;
        }
      | null;
  };
}
