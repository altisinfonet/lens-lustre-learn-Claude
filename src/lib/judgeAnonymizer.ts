/**
 * Judge Privacy Phase 2 — Identity anonymization for admin-visible audit views.
 *
 * Policy:
 *   - By default, judge IDs and names are replaced with deterministic per-competition
 *     handles ("Judge A", "Judge B", …).
 *   - A super_admin may explicitly enable a "Reveal identities" mode (per-session,
 *     persisted to localStorage). Enabling it writes an audit log entry.
 *   - Handles are deterministic per (competitionId, judgeId) so the same judge
 *     always shows the same letter within a given competition, but different
 *     letters across competitions (cross-competition correlation prevented).
 *
 * Use this everywhere admin UIs render judge identifiers from
 *   - judge_activity_logs
 *   - judge_scores
 *   - judge_decisions
 *   - judge_comments
 *   - competition_judges
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { logAdminAction } from "@/lib/adminLogger";

const REVEAL_KEY = "admin.judgeReveal.v1";

/* ------------------------------------------------------------------ */
/* Reveal toggle (browser-side, super_admin gated by caller)          */
/* ------------------------------------------------------------------ */

const listeners = new Set<() => void>();

function readReveal(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(REVEAL_KEY) === "1";
}

function emit() {
  listeners.forEach((l) => l());
}

export function setJudgeReveal(reveal: boolean, adminId?: string) {
  if (typeof window === "undefined") return;
  if (reveal) window.localStorage.setItem(REVEAL_KEY, "1");
  else window.localStorage.removeItem(REVEAL_KEY);
  emit();
  if (adminId) {
    logAdminAction(adminId, {
      action: reveal ? "judge_identity_reveal_on" : "judge_identity_reveal_off",
      category: "admin",
      severity: reveal ? "warn" : "info",
      metadata: { surface: "admin_audit_views" },
    });
  }
}

export function useJudgeReveal(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readReveal,
    () => false
  );
}

/* ------------------------------------------------------------------ */
/* Deterministic per-competition handle                               */
/* ------------------------------------------------------------------ */

/** Stable hash → small positive int. */
function hash(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Convert int to spreadsheet-style letters: 0→A, 25→Z, 26→AA, … */
function toLetters(n: number): string {
  let s = "";
  let x = n;
  do {
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s;
}

/**
 * Deterministic anonymous handle for a judge within a competition.
 * Same judge in the same competition always gets the same letter; different
 * competitions yield different letters to prevent cross-competition correlation.
 *
 * Pass `competitionId = ""` for global views (e.g. `/admin/health`) — handles
 * are then global-stable per judge.
 */
export function getJudgeHandle(competitionId: string, judgeId: string): string {
  const seed = `${competitionId}:${judgeId}`;
  const idx = hash(seed) % (26 * 27); // up to 702 distinct handles (A..ZZ)
  return `Judge ${toLetters(idx)}`;
}

/**
 * Resolve display name for a judge given the current reveal state.
 *  - reveal=false → anonymous handle
 *  - reveal=true  → real name (or fallback to handle if name unknown)
 */
export function resolveJudgeDisplay(
  competitionId: string,
  judgeId: string,
  realName: string | null | undefined,
  reveal: boolean
): string {
  if (reveal && realName) return realName;
  return getJudgeHandle(competitionId, judgeId);
}
