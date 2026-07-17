import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

const BATCH_SIZE = 500;

/**
 * Judging v3 / Phase 3.2 (Step 2.4): catalog-derived award vocabulary.
 *
 * The hardcoded `AWARD_STATUS_MAP`, `REQUIRED_AWARDS`, and `UNIQUE_AWARDS`
 * constants were retired in favour of a single source of truth in
 * `public.v3_stage_catalog` (rows where `family='award' AND round_number=4`).
 *
 * The maps below are SAFE FALLBACKS only — they are used iff the catalog
 * query fails or returns zero rows (so a transient DB error never bricks
 * Round 4 finalization). Under normal operation, every value in these maps
 * is overwritten by the catalog data loaded at request start.
 *
 * Mapping convention:
 *   AWARD_STATUS_MAP[normalizeTagLabel(stage.tag_label_canonical)] = stage.decision_token
 *
 * Fallback values were copied verbatim from the v3_stage_catalog seed so
 * they cannot drift below.
 */
const AWARD_STATUS_MAP_FALLBACK: Record<string, string> = {
  // 16-Key Frozen Contract v3 — keys are normalizeTagLabel(tag_label_canonical).
  // Synonym aliases (legacy short labels) preserved so historic judging_tags rows
  // still resolve correctly during transition.
  "winner": "winner",
  "1st runner-up": "runner_up_1",
  "1st runner up": "runner_up_1",
  "2nd runner-up": "runner_up_2",
  "2nd runner up": "runner_up_2",
  "honorary mention": "honorary_mention",
  "special jury award": "special_jury",
  "special jury": "special_jury",
  "best moment award": "special_jury",
  "top 50 global photographer": "finalist",
  "top 50 finalist": "finalist",
  "top 50": "finalist",
  "top 100 global photographer": "qualified",
  "top 100": "qualified",
  "finalist (no placement)": "finalist",
};

const AWARD_DECISION_TOKEN_TO_PUBLIC_KEY: Record<string, string> = {
  winner: "winner",
  runner_up_1: "runner_up_1",
  runner_up_2: "runner_up_2",
  honorary_mention: "honorary_mention",
  special_jury: "special_jury",
  top_50: "top_50",
  top_100: "top_100",
  finalist_only: "finalist",
  finalist: "finalist",
  qualified: "top_100",
};

/** Normalize judging_tags.label for AWARD_STATUS_MAP lookup. */
function normalizeTagLabel(s: string): string {
  return s.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Ruleset v4: only WINNER is mandatory in Round 4. All other R4 award tags
 * (Runner-Ups, Honorary Mention, Special Jury, Top 50, Top 100) are optional.
 *
 * v3 / Phase 3.2: this constant is now a fallback. Active value is derived
 * from `v3_stage_catalog` rows where `cert_eligible=true AND family='award'
 * AND round_number=4 AND stage_key='r4_winner'`. Plan locks Winner as the
 * only required award; the catalog has no `is_required` column today, so
 * this list stays small and explicit.
 */
const REQUIRED_AWARDS_FALLBACK = ["winner"];

/**
 * Awards that must be unique (only 1 entry allowed). Top 50/100 are NOT unique.
 * v3 / Phase 3.2: fallback only. Active value is derived from catalog —
 * Winner + the two Runner-Up stages (`r4_runner_up_1`, `r4_runner_up_2`).
 */
const UNIQUE_AWARDS_FALLBACK = ["winner", "1st runner up", "2nd runner up"];

/**
 * Judging v3 / Phase 3.2 — catalog snapshot loaded once per request.
 *
 * Returns the live `AWARD_STATUS_MAP`, `REQUIRED_AWARDS`, and `UNIQUE_AWARDS`
 * derived from `v3_stage_catalog`. On any error or empty result, falls back
 * to the hardcoded constants above so a transient DB hiccup never bricks
 * Round 4 finalization. The shape mirrors the legacy constants exactly so
 * downstream code is byte-compatible.
 */
async function loadAwardCatalog(admin: any): Promise<{
  AWARD_STATUS_MAP: Record<string, string>;
  REQUIRED_AWARDS: string[];
  UNIQUE_AWARDS: string[];
  source: "catalog" | "fallback";
}> {
  try {
    const { data, error } = await admin
      .from("v3_stage_catalog")
      .select("stage_key, decision_token, tag_label_canonical, cert_eligible")
      .eq("round_number", 4)
      .eq("family", "award")
      .eq("cert_eligible", true)
      .eq("is_active", true);

    if (error || !Array.isArray(data) || data.length === 0) {
      return {
        AWARD_STATUS_MAP: AWARD_STATUS_MAP_FALLBACK,
        REQUIRED_AWARDS: REQUIRED_AWARDS_FALLBACK,
        UNIQUE_AWARDS: UNIQUE_AWARDS_FALLBACK,
        source: "fallback",
      };
    }

    // Build label → decision_token map (handles synonyms like "Top 50" and
    // "Top 50 Finalist" both resolving to decision_token='finalist').
    const map: Record<string, string> = {};
    for (const row of data) {
      if (!row.tag_label_canonical || !row.decision_token) continue;
      map[normalizeTagLabel(row.tag_label_canonical)] = row.decision_token;
    }

    // REQUIRED_AWARDS and UNIQUE_AWARDS are KEYED BY normalized label (not
    // decision_token) because downstream code does `awardEntries.get(label)`
    // where `awardEntries` is keyed by the normalized tag label.
    //
    // Required = label of stage_key='r4_winner' (the only mandatory R4 award).
    const winnerRow = data.find((r: any) => r.stage_key === "r4_winner");
    const required = winnerRow
      ? [normalizeTagLabel(winnerRow.tag_label_canonical)]
      : REQUIRED_AWARDS_FALLBACK;

    // Unique = labels of Winner + both Runner-Up stages.
    const uniqueStageKeys = ["r4_winner", "r4_runner_up_1", "r4_runner_up_2"];
    const unique: string[] = [];
    for (const key of uniqueStageKeys) {
      const row = data.find((r: any) => r.stage_key === key);
      if (row?.tag_label_canonical) unique.push(normalizeTagLabel(row.tag_label_canonical));
    }

    return {
      AWARD_STATUS_MAP: map,
      REQUIRED_AWARDS: required,
      UNIQUE_AWARDS: unique.length > 0 ? unique : UNIQUE_AWARDS_FALLBACK,
      source: "catalog",
    };
  } catch (e) {
    console.error("[complete-round] loadAwardCatalog failed, using fallback", e);
    return {
      AWARD_STATUS_MAP: AWARD_STATUS_MAP_FALLBACK,
      REQUIRED_AWARDS: REQUIRED_AWARDS_FALLBACK,
      UNIQUE_AWARDS: UNIQUE_AWARDS_FALLBACK,
      source: "fallback",
    };
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getSecureHeaders(req);

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const admin = createClient(supabaseUrl, serviceKey);

    // ── B1.6 — Admin Execution Guarantee ──
    // The contract is: ONLY (a) a JWT carrying the admin role OR (b) the
    // service-role key may invoke this fn. Anything else is rejected 401/403
    // BEFORE any state mutation, and a forensic audit row is written
    // BEFORE the mutation path runs.
    const bearerToken = authHeader.slice("Bearer ".length).trim();
    const isServiceRole = bearerToken === serviceKey;

    let callerId: string;
    let callerRole: "admin" | "judge" | "service_role";

    if (isServiceRole) {
      // Internal/cron caller. No user context; attribute to NULL actor and
      // tag the audit row so it is forensically distinguishable from a real
      // admin invocation.
      callerId = "00000000-0000-0000-0000-000000000000";
      callerRole = "service_role";

      // ── STAGE 1 INSTRUMENTATION (AUDIT-C-3 / JP-C-3) ──
      // Record every service-role bearer invocation so we can prove whether
      // any legitimate caller still uses this branch before removing it.
      // Zero behaviour change: fire-and-forget, never throws, never blocks.
      try {
        const src = req.headers.get("x-forwarded-for")
          ?? req.headers.get("cf-connecting-ip")
          ?? "unknown";
        const ua = req.headers.get("user-agent") ?? "unknown";
        console.warn(
          "[SECURITY][complete-round] service-role bearer invocation",
          JSON.stringify({ ip: src, ua, ts: new Date().toISOString() })
        );
        // Best-effort audit row; do not await failures.
        admin.from("db_audit_logs").insert({
          table_name: "complete-round",
          operation: "SERVICE_ROLE_BEARER_INVOCATION",
          row_id: null,
          old_data: null,
          new_data: { ip: src, ua, function: "complete-round" },
          changed_by: null,
        }).then(({ error }) => {
          if (error) console.warn("[SECURITY] audit insert failed:", error.message);
        });
      } catch (e) {
        console.warn("[SECURITY] instrumentation error:", (e as Error).message);
      }
    } else {
      // FIX 9: Use getUser() instead of getClaims()
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);

      callerId = userData.user.id;

      // CR-A (2026-07-03): Restore judge Lock authority.
      // Spec: `mem://judging/round-declaration-by-admin` — Lock (writes
      // closed_at) is performed by JUDGE or ADMIN via this fn; Declare
      // (writes published_at) is admin-only via `publish-round`.
      // Previously this branch hard-required admin, breaking judge Lock end
      // to end. We now accept either role and preserve callerRole for
      // downstream audit + admin-only gates (e.g. dry_run on locked rounds).
      // Direct query to avoid has_role() overload ambiguity (PGRST203).
      const { data: roleRows } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", callerId)
        .in("role", ["admin", "judge"]);

      const roleSet = new Set((roleRows || []).map((r: any) => r.role));
      if (!roleSet.has("admin") && !roleSet.has("judge")) {
        return json({ error: "Forbidden: judge or admin role required" }, 403);
      }
      callerRole = roleSet.has("admin") ? "admin" : ("judge" as any);
    }


    const { competition_id, round_number, action, dry_run: dryRunRaw, preflight: preflightRaw, ui_eligible: uiEligibleRaw } = await req.json();
    if (!competition_id) return json({ error: "Missing competition_id" }, 400);
    if (typeof round_number !== "number" || round_number < 1 || round_number > 4)
      return json({ error: "Invalid round_number (1-4)" }, 400);
    // X19: dry-run safe-guard. When true, edge fn computes decisions and
    // returns the preview WITHOUT writing to DB. No triggers fire, no emails,
    // no progression. Default = false (production behavior unchanged).
    const dry_run: boolean = dryRunRaw === true;
    // PREFLIGHT MODE (judge-side button): when true, the edge fn does NOT run
    // any decision aggregation, locking, or write. It only:
    //   1. Calls public.get_round_judging_gate_self() to obtain the canonical
    //      DB-side view of the caller's eligible-photo set per assigned entry.
    //   2. Diffs that set against the UI-side `ui_eligible` payload the judge
    //      button submitted (entry_id → photo_index[]).
    //   3. Writes one append-only row to public.judging_preflight_log so admins
    //      can later forensically reconstruct any drift.
    //   4. Returns { drift_detected, ui_only, db_only, db_view } so the dialog
    //      can show / block accordingly.
    const preflight: boolean = preflightRaw === true;
    const ui_eligible: Record<string, number[]> | null =
      uiEligibleRaw && typeof uiEligibleRaw === "object" && !Array.isArray(uiEligibleRaw)
        ? (uiEligibleRaw as Record<string, number[]>)
        : null;

    // ── FEATURE FLAGS ──
    const getFlag = async (key: string): Promise<boolean> => {
      const { data } = await admin.from("system_flags").select("value").eq("key", key).maybeSingle();
      return data?.value === true;
    };

    // FIX 5: Check strict lock — block even admin if flag is on
    const strictLock = await getFlag("enforce_strict_round_lock");

    // ── B1.6 — Pre-mutation forensic audit row ──
    // Writes the operator's INTENT to db_audit_logs BEFORE any state mutation
    // happens, so a later DB outage / partial failure leaves an immutable
    // trail of what was attempted, by whom, with which payload. Preflight
    // (read-only) is exempt — it has its own dedicated log.
    const writePreMutationAudit = async (intent: string, extra: Record<string, unknown> = {}) => {
      try {
        await admin.from("db_audit_logs").insert({
          table_name: "judging_rounds",
          operation: `complete-round:${intent}`,
          row_id: `${competition_id}:${round_number}`,
          new_data: {
            intent,
            competition_id,
            round_number,
            action: action ?? null,
            dry_run,
            caller_role: callerRole,
            caller_id: callerId,
            ...extra,
          },
          changed_by: callerRole === "service_role" ? null : callerId,
        });
      } catch (auditErr) {
        // Audit failure must NOT block the operation, but it is logged loudly
        // so a missing audit row is reconstructible from edge logs.
        console.error("[complete-round B1.6] pre-mutation audit insert failed", auditErr);
      }
    };

    // ── PREFLIGHT MODE (judge-side Complete Round button) ──
    // Read-only. Returns the diff between UI-side and DB-side eligible-photo
    // sets, plus an audit row in judging_preflight_log. Does NOT lock the
    // round or write any progression. Bypasses strictLock because no mutation
    // happens here.
    if (preflight) {
      // B1.6: preflight is read-only; the dedicated `judging_preflight_log`
      // row already provides forensic coverage, so no db_audit_logs write here.
      // Use a USER-CONTEXT client so the SECURITY DEFINER RPC sees auth.uid()
      // and applies its own caller-judge gate. Service-role callers cannot
      // run preflight (the RPC needs a real auth.uid).
      if (isServiceRole) {
        return json({ error: "Preflight requires an admin JWT (no service-role)" }, 400);
      }
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: gateRows, error: gateErr } = await userClient.rpc(
        "get_round_judging_gate_self",
        { _competition_id: competition_id, _round_number: round_number }
      );

      if (gateErr) {
        return json({ error: `Preflight RPC failed: ${gateErr.message}` }, 500);
      }

      type GateRow = {
        entry_id: string;
        entry_title: string | null;
        ui_eligible_photo_indices: number[] | null;
        ui_eligible_photos: number;
        my_decisions_missing: number;
        my_scores_missing: number;
      };
      const dbView = (gateRows as GateRow[] | null) ?? [];

      // Build canonical DB sets: { entry_id → Set<photo_index> }
      const dbMap = new Map<string, Set<number>>();
      for (const r of dbView) {
        dbMap.set(r.entry_id, new Set(r.ui_eligible_photo_indices ?? []));
      }
      const uiMap = new Map<string, Set<number>>();
      if (ui_eligible) {
        for (const [eid, idxs] of Object.entries(ui_eligible)) {
          if (Array.isArray(idxs)) uiMap.set(eid, new Set(idxs.map(Number)));
        }
      }

      // Diff
      const ui_only: { entry_id: string; photo_index: number }[] = [];
      const db_only: { entry_id: string; photo_index: number }[] = [];
      for (const [eid, set] of uiMap) {
        const dbSet = dbMap.get(eid) ?? new Set<number>();
        for (const pi of set) if (!dbSet.has(pi)) ui_only.push({ entry_id: eid, photo_index: pi });
      }
      for (const [eid, set] of dbMap) {
        const uiSet = uiMap.get(eid) ?? new Set<number>();
        for (const pi of set) if (!uiSet.has(pi)) db_only.push({ entry_id: eid, photo_index: pi });
      }

      let ui_count = 0;
      for (const s of uiMap.values()) ui_count += s.size;
      let db_count = 0;
      for (const s of dbMap.values()) db_count += s.size;
      const diff_count = ui_only.length + db_only.length;
      const drift_detected = diff_count > 0;

      // Append to audit log (best-effort; failure must not break preflight).
      try {
        await admin.from("judging_preflight_log").insert({
          competition_id,
          round_number,
          caller_id: callerId,
          caller_role: callerRole,
          ui_count,
          db_count,
          diff_count,
          ui_only_sample: ui_only.slice(0, 50),
          db_only_sample: db_only.slice(0, 50),
          drift_detected,
        });
      } catch (logErr) {
        console.error("[complete-round preflight] audit log insert failed", logErr);
      }

      return json({
        ok: true,
        preflight: true,
        round_number,
        drift_detected,
        ui_count,
        db_count,
        diff_count,
        ui_only: ui_only.slice(0, 50),
        db_only: db_only.slice(0, 50),
        db_view: dbView.map((r) => ({
          entry_id: r.entry_id,
          entry_title: r.entry_title,
          ui_eligible_photos: r.ui_eligible_photos,
          my_decisions_missing: r.my_decisions_missing,
          my_scores_missing: r.my_scores_missing,
        })),
      });
    }

    // ── ACTION: ACTIVATE ──
    if (action === "activate") {
      // B1.6: pre-mutation forensic audit BEFORE any state change.
      await writePreMutationAudit("activate");

      const { data: targetRound, error: roundErr } = await admin
        .from("judging_rounds")
        .select("id, competition_id, round_number, status")
        .eq("competition_id", competition_id)
        .eq("round_number", round_number)
        .maybeSingle();
      if (roundErr) throw roundErr;
      if (!targetRound) return json({ error: "Round not found" }, 404);

      // FIX 5: Block activation if strict lock is on and round is completed
      if (strictLock && targetRound.status === "completed") {
        return json({ error: "Cannot modify completed round (strict lock enabled)" }, 403);
      }

      const { error: deactivateErr } = await admin
        .from("judging_rounds")
        .update({ status: "pending" })
        .eq("competition_id", competition_id)
        .eq("status", "active");
      if (deactivateErr) throw deactivateErr;

      const { error: activateErr } = await admin
        .from("judging_rounds")
        .update({ status: "active" })
        .eq("id", targetRound.id);
      if (activateErr) throw activateErr;

      // SOW: When judge activates a round, competition enters "judging" phase
      await admin.from("competitions").update({
        phase: "judging",
        status: "judging",
        current_round: String(round_number),
      }).eq("id", competition_id);

      return json({ activated: true, round_id: targetRound.id, round_number });
    }

    // ── HELPERS ──
    const batchUpdateEntries = async (ids: string[], payload: Record<string, unknown>) => {
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const chunk = ids.slice(i, i + BATCH_SIZE);
        const { error } = await admin.from("competition_entries").update(payload).in("id", chunk);
        if (error) throw new Error(`Batch update failed: ${error.message}`);
      }
    };

    const fetchAllEntries = async (filters: Record<string, string>) => {
      const all: any[] = [];
      let offset = 0;
      const limit = 1000;
      while (true) {
        // FIX #4 (rejected-photo round-close blocker): include photo_meta so
        // we can skip admin-rejected photos when computing eligibility.
        let q = admin.from("competition_entries").select("id, title, status, current_round, placement, photos, photo_meta").eq("competition_id", competition_id);
        for (const [k, v] of Object.entries(filters)) {
          if (k === "status_in") q = q.in("status", v.split(","));
          else q = q.eq(k, v);
        }
        const { data, error } = await q.range(offset, offset + limit - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < limit) break;
        offset += limit;
      }
      return all;
    };

    /**
     * Per-photo eligibility for round N (N >= 2):
     * a (entry_id, photo_index) pair is eligible only if it was decided 'shortlist'
     * in round N-1. For R1, every photo of every entry is eligible.
     * Returns a Set of "entryId::photoIndex" keys.
     */
    // FIX #4: helper — is this photo admin-rejected?
    const isPhotoRejected = (entry: any, photoIndex: number): boolean => {
      const meta = Array.isArray(entry?.photo_meta) ? entry.photo_meta : null;
      if (!meta) return false;
      return meta[photoIndex]?.rejected === true;
    };

    const fetchEligiblePhotoKeys = async (
      entries: any[],
      roundNum: number,
    ): Promise<Set<string>> => {
      const keys = new Set<string>();
      if (roundNum <= 1) {
        for (const e of entries) {
          const pc = Array.isArray(e.photos) ? e.photos.length : 1;
          for (let pi = 0; pi < pc; pi++) {
            // FIX #4: admin-rejected photos are NOT eligible — they were
            // hidden from judges site-wide so they cannot be required for
            // round closure.
            if (isPhotoRejected(e, pi)) continue;
            keys.add(`${e.id}::${pi}`);
          }
        }
        return keys;
      }
      const ids = entries.map((e: any) => e.id);
      const entryById = new Map(entries.map((e: any) => [e.id, e]));

      // FIX A (audit 2026-07-04): In distributed judge-assignment mode, only entries
      // that appear in judge_entry_assignments for THIS round are actually part of
      // the round's judging surface. R1-qualified entries that were never re-assigned
      // in R2/R3/R4 would otherwise become invisible-yet-blocking eligibility rows
      // (UI never shows them, but the coverage gate demanded 10 SOW criteria from
      // every competition_judge → round-close was permanently un-completable).
      const { data: compRow } = await admin
        .from("competitions")
        .select("judge_assignment_mode")
        .eq("id", competition_id)
        .maybeSingle();
      const isDistributed = (compRow as any)?.judge_assignment_mode === "distributed";
      let assignedEntryIds: Set<string> | null = null;
      if (isDistributed) {
        assignedEntryIds = new Set<string>();
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const chunk = ids.slice(i, i + BATCH_SIZE);
          const { data } = await admin.from("judge_entry_assignments")
            .select("entry_id")
            .eq("competition_id", competition_id)
            .in("entry_id", chunk);
          if (data) for (const r of data as any[]) assignedEntryIds.add(r.entry_id);
        }
      }

      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const chunk = ids.slice(i, i + BATCH_SIZE);
        const { data } = await admin.from("judge_decisions")
          .select("entry_id, photo_index, decision")
          .eq("round_number", roundNum - 1)
          .in("entry_id", chunk);
        if (data) for (const d of data) {
          if (!isQualifyingDecision(String(d.decision ?? ""), roundNum - 1)) continue;
          const pi = d.photo_index ?? 0;
          const entry = entryById.get(d.entry_id);
          // FIX #4: even prior-round shortlists are dropped if the photo was
          // rejected by an admin after the fact.
          if (entry && isPhotoRejected(entry, pi)) continue;
          // FIX A: drop phantom eligibility for entries not re-assigned this round.
          if (assignedEntryIds && !assignedEntryIds.has(d.entry_id)) continue;
          keys.add(`${d.entry_id}::${pi}`);
        }
      }
      return keys;
    };

    /** Check which entries have unjudged ELIGIBLE photos for a given round */
    const findUnjudgedEntries = (
      entries: any[],
      decisions: any[],
      eligibleKeys: Set<string>,
    ): string[] => {
      const judgedSet = new Set<string>();
      for (const d of decisions) {
        const pi = d.photo_index ?? 0;
        judgedSet.add(`${d.entry_id}::${pi}`);
      }
      const unjudged: string[] = [];
      for (const entry of entries) {
        const photoCount = Array.isArray(entry.photos) ? entry.photos.length : 1;
        let entryHasEligible = false;
        for (let pi = 0; pi < photoCount; pi++) {
          const key = `${entry.id}::${pi}`;
          if (!eligibleKeys.has(key)) continue;
          entryHasEligible = true;
          if (!judgedSet.has(key)) {
            unjudged.push(entry.id);
            break;
          }
        }
        // If no eligible photos at all, the entry shouldn't even be in this round —
        // skip it silently (don't flag as unjudged).
        void entryHasEligible;
      }
      return unjudged;
    };

    /**
     * 100% Coverage Gate (per stakeholder policy 2026-04-18):
     * Every assigned judge must have decided every eligible (entry,photo) pair
     * before the round can be closed. Returns details of who is missing what.
     */
    const checkJudgeCoverage = async (
      entries: any[],
      decisions: any[],
      eligibleKeys: Set<string>,
    ): Promise<{ ok: true } | { ok: false; missing_judges: number; missing_decisions: number; sample: { judge_id: string; entry_id: string; photo_index: number }[]; missing_full: { judge_id: string; entry_id: string; photo_index: number }[]; assigned_judges: number }> => {
      // Get assigned judges. If distributed mode, restrict to per-entry assignments.
      const { data: comp } = await admin.from("competitions").select("judge_assignment_mode").eq("id", competition_id).maybeSingle();
      const isDistributed = (comp as any)?.judge_assignment_mode === "distributed";
      const { data: judgeRows } = await admin.from("competition_judges").select("judge_id").eq("competition_id", competition_id);
      const assignedJudges: string[] = (judgeRows || []).map((r: any) => r.judge_id);
      if (assignedJudges.length === 0) return { ok: true }; // no judges configured → nothing to gate
      // Distributed: load per-entry judge assignments
      const distMap: Map<string, Set<string>> = new Map(); // entry_id → Set<judge_id>
      if (isDistributed) {
        const ids = entries.map((e: any) => e.id);
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const chunk = ids.slice(i, i + BATCH_SIZE);
          const { data } = await admin.from("judge_entry_assignments")
            .select("entry_id, judge_id")
            .eq("competition_id", competition_id)
            .in("entry_id", chunk);
          for (const r of (data || [])) {
            const s = distMap.get((r as any).entry_id) || new Set<string>();
            s.add((r as any).judge_id);
            distMap.set((r as any).entry_id, s);
          }
        }
      }
      // Build set of decided keys: `${judge_id}::${entry_id}::${photo_index}`
      const decidedSet = new Set<string>();
      for (const d of decisions) {
        decidedSet.add(`${d.judge_id}::${d.entry_id}::${d.photo_index ?? 0}`);
      }
      // For each eligible (entry,photo), every judge responsible for that entry must have decided it.
      const missingSample: { judge_id: string; entry_id: string; photo_index: number }[] = [];
      const missingFull: { judge_id: string; entry_id: string; photo_index: number }[] = [];
      const missingJudges = new Set<string>();
      let missingCount = 0;
      for (const entry of entries) {
        const photoCount = Array.isArray(entry.photos) ? entry.photos.length : 1;
        const judgesForEntry = isDistributed
          ? Array.from(distMap.get(entry.id) || new Set<string>())
          : assignedJudges;
        if (judgesForEntry.length === 0) continue;
        for (let pi = 0; pi < photoCount; pi++) {
          if (!eligibleKeys.has(`${entry.id}::${pi}`)) continue;
          for (const jid of judgesForEntry) {
            if (!decidedSet.has(`${jid}::${entry.id}::${pi}`)) {
              missingCount++;
              missingJudges.add(jid);
              const rec = { judge_id: jid, entry_id: entry.id, photo_index: pi };
              missingFull.push(rec);
              if (missingSample.length < 20) missingSample.push(rec);
            }
          }
        }
      }
      if (missingCount === 0) return { ok: true };
      return { ok: false, missing_judges: missingJudges.size, missing_decisions: missingCount, sample: missingSample, missing_full: missingFull, assigned_judges: assignedJudges.length };
    };

    // ── JUDGING-15: Mandatory 15-criteria coverage gate (R2/R3/R4 only) ──
    // Every (judge, eligible photo) pair must have a judge_scores row with all
    // FIFTEEN elements of art non-null (owner-approved 2026-07-16). Locking the
    // round is blocked until this is satisfied.
    const SOW_SCORE_COLS = [
      "composition_score","color_palette_score","technique_score",
      "line_score","shape_score","form_score","texture_score",
      "space_score","tone_score","balance_score","light_score","depth_score",
      "editing_score","story_score","moment_score",
    ] as const;

    // Human-readable criteria labels for the toast.
    const SOW_LABELS: Record<string, string> = {
      composition_score: "Composition",
      color_palette_score: "Color Palette",
      technique_score: "Technique",
      line_score: "Line",
      shape_score: "Shape",
      form_score: "Form",
      texture_score: "Texture",
      space_score: "Space",
      tone_score: "Tone",
      balance_score: "Balance",
      light_score: "Light",
      depth_score: "Depth",
      editing_score: "Editing",
      story_score: "Story",
      moment_score: "Moment",
    };

    // Fix B: derive a human photo label from photo_meta[pi].title, photo filename,
    // or fall back to "Photo N" (1-based).
    const derivePhotoLabel = (entry: any, pi: number): string => {
      const meta = Array.isArray(entry?.photo_meta) ? entry.photo_meta[pi] : null;
      const metaTitle = meta && typeof meta.title === "string" ? meta.title.trim() : "";
      if (metaTitle) return metaTitle;
      const photos = Array.isArray(entry?.photos) ? entry.photos : [];
      const url = typeof photos[pi] === "string" ? photos[pi] : "";
      if (url) {
        try {
          const base = url.split("?")[0].split("/").pop() || "";
          const noExt = base.replace(/\.[a-z0-9]+$/i, "");
          if (noExt) return noExt;
        } catch { /* ignore */ }
      }
      return `Photo ${pi + 1}`;
    };

    const checkScoreCoverage = async (
      entries: any[],
      eligibleKeys: Set<string>,
    ): Promise<{ ok: true } | { ok: false; missing_count: number; sample: { judge_id: string; entry_id: string; entry_title: string | null; photo_index: number; photo_label: string; missing_criteria: string[]; missing_criteria_labels: string[] }[]; summary: string }> => {
      const { data: comp } = await admin.from("competitions").select("judge_assignment_mode").eq("id", competition_id).maybeSingle();
      const isDistributed = (comp as any)?.judge_assignment_mode === "distributed";
      const { data: judgeRows } = await admin.from("competition_judges").select("judge_id").eq("competition_id", competition_id);
      const assignedJudges: string[] = (judgeRows || []).map((r: any) => r.judge_id);
      if (assignedJudges.length === 0) return { ok: true };

      const distMap: Map<string, Set<string>> = new Map();
      if (isDistributed) {
        const ids = entries.map((e: any) => e.id);
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const chunk = ids.slice(i, i + BATCH_SIZE);
          const { data } = await admin.from("judge_entry_assignments")
            .select("entry_id, judge_id")
            .eq("competition_id", competition_id)
            .in("entry_id", chunk);
          for (const r of (data || [])) {
            const s = distMap.get((r as any).entry_id) || new Set<string>();
            s.add((r as any).judge_id);
            distMap.set((r as any).entry_id, s);
          }
        }
      }

      // Load current-round judge_scores rows for these entries in batches.
      // Multiple rows can exist historically for the same judge/photo; coverage
      // passes if ANY current-round row has all 10 SOW criteria complete.
      const entryIds = entries.map((e: any) => e.id);
      const scoreRows: any[] = [];
      const cols = ["entry_id","judge_id","photo_index", ...SOW_SCORE_COLS].join(",");
      for (let i = 0; i < entryIds.length; i += BATCH_SIZE) {
        const chunk = entryIds.slice(i, i + BATCH_SIZE);
        const { data } = await admin.from("judge_scores").select(cols).eq("round_number", round_number).in("entry_id", chunk);
        if (data) scoreRows.push(...data);
      }
      const scoreByKey = new Map<string, any>();
      const missingFor = (row: any | null | undefined): string[] =>
        SOW_SCORE_COLS.filter((col) => !row || row[col] === null || row[col] === undefined);
      for (const r of scoreRows) {
        const key = `${r.judge_id}::${r.entry_id}::${r.photo_index ?? 0}`;
        const existing = scoreByKey.get(key);
        if (!existing || missingFor(r).length < missingFor(existing).length) scoreByKey.set(key, r);
      }

      const sample: { judge_id: string; entry_id: string; entry_title: string | null; photo_index: number; photo_label: string; missing_criteria: string[]; missing_criteria_labels: string[] }[] = [];
      let missingCount = 0;
      // Aggregate per-entry counts for the human summary line.
      const perEntry = new Map<string, { title: string | null; count: number }>();

      for (const entry of entries) {
        const photoCount = Array.isArray(entry.photos) ? entry.photos.length : 1;
        const judgesForEntry = isDistributed ? Array.from(distMap.get(entry.id) || new Set<string>()) : assignedJudges;
        if (judgesForEntry.length === 0) continue;
        for (let pi = 0; pi < photoCount; pi++) {
          if (!eligibleKeys.has(`${entry.id}::${pi}`)) continue;
          for (const jid of judgesForEntry) {
            const row = scoreByKey.get(`${jid}::${entry.id}::${pi}`);
            const missingCriteria = missingFor(row);
            if (missingCriteria.length > 0) {
              missingCount++;
              const agg = perEntry.get(entry.id) || { title: entry.title ?? null, count: 0 };
              agg.count++;
              perEntry.set(entry.id, agg);
              if (sample.length < 20) {
                sample.push({
                  judge_id: jid,
                  entry_id: entry.id,
                  entry_title: entry.title ?? null,
                  photo_index: pi,
                  photo_label: derivePhotoLabel(entry, pi),
                  missing_criteria: missingCriteria,
                  missing_criteria_labels: missingCriteria.map((c) => SOW_LABELS[c] ?? c),
                });
              }
            }
          }
        }
      }
      if (missingCount === 0) return { ok: true };
      // Build a top-line human summary that names the entries, not UUIDs.
      const summaryParts = Array.from(perEntry.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([, v]) => `“${v.title ?? "(untitled)"}” — ${v.count} photo${v.count === 1 ? "" : "s"} incomplete`);
      const extra = perEntry.size > 5 ? ` and ${perEntry.size - 5} more entrie(s)` : "";
      const summary = summaryParts.join("; ") + extra;
      return { ok: false, missing_count: missingCount, sample, summary };
    };

    /**
     * Aggregate per-photo decisions to entry-level decision (majority vote of ELIGIBLE photos only).
     *
     * Phase 2.1 (D1/D2): DETERMINISTIC SOW tie-break priority — when two decisions tie in count,
     * the highest-priority decision wins. This eliminates Object.entries() ordering non-determinism.
     *
     * SOW priority (highest → lowest):
     *   shortlist > qualified > accept > needs_review > skip > reject
     */
    const SOW_DECISION_PRIORITY: Record<string, number> = {
      shortlist: 60,
      shortlisted: 60,
      qualified_r3: 60,
      qualified_final: 60,
      shortlisted_final: 60,
      qualified: 50,
      accept: 40,
      needs_review: 30,
      skip: 20,
      reject: 10,
      rejected: 10,
    };

    const isQualifyingDecision = (decision: string, fromRound: number): boolean => {
      const normalized = decision.toLowerCase().trim();
      if (fromRound === 1) return ["shortlist", "shortlisted"].includes(normalized);
      if (fromRound === 2) {
        return ["qualified_r3", "shortlist", "shortlisted", "qualified", "qualified_for_r3", "qualified for r3"].includes(normalized);
      }
      if (fromRound === 3) {
        return ["qualified_final", "shortlisted_final", "qualified", "shortlist", "shortlisted", "finalist", "shortlisted_for_final", "shortlisted for final"].includes(normalized);
      }
      return false;
    };

    const aggregateEntryDecision = (
      entryId: string,
      _photoCount: number,
      decisions: any[],
      eligibleKeys?: Set<string>,
    ): string | null => {
      const entryDecisions = decisions.filter((d: any) => {
        if (d.entry_id !== entryId) return false;
        if (!eligibleKeys) return true;
        return eligibleKeys.has(`${entryId}::${d.photo_index ?? 0}`);
      });
      if (entryDecisions.length === 0) return null;
      const counts: Record<string, number> = {};
      for (const d of entryDecisions) {
        counts[d.decision] = (counts[d.decision] || 0) + 1;
      }
      // Sort by (count DESC, sow_priority DESC) for deterministic outcome.
      const sorted = Object.entries(counts).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        const pa = SOW_DECISION_PRIORITY[a[0]] ?? 0;
        const pb = SOW_DECISION_PRIORITY[b[0]] ?? 0;
        return pb - pa;
      });
      return sorted[0]?.[0] ?? null;
    };

    /** Map an aggregated decision string to canonical progression_decision value. */
    const toProgressionDecision = (d: string | null): string | null => {
      if (!d) return null;
      if (d === "shortlist" || d === "shortlisted") return "shortlisted";
      if (d === "accept") return "accept";
      if (d === "qualified") return "qualified";
      if (d === "needs_review") return "needs_review";
      if (d === "reject" || d === "rejected" || d === "skip") return "reject";
      return null;
    };

    // ── SNAPSHOT (Recovery System) ──
    const saveSnapshot = async (entries: any[]) => {
      await admin.from("round_snapshots").insert({
        competition_id,
        round_number,
        snapshot_data: entries,
      });
    };

    // ── COMPETITION VALIDATION ──
    // B1.6: pre-mutation forensic audit BEFORE round-close work begins.
    // Covers every round-close code path (R1, R2, R3, R4) including dry-run,
    // because a dry-run is still an attempted operation worth attributing.
    await writePreMutationAudit("round-close");

    const { data: comp, error: compErr } = await admin
      .from("competitions")
      .select("id, current_round, phase")
      .eq("id", competition_id)
      .maybeSingle();
    if (compErr) throw compErr;
    if (!comp) return json({ error: "Competition not found" }, 404);

    const currentRoundNum = comp.current_round ? parseInt(comp.current_round, 10) : 0;
    // BUG-056: an already-processed call performs NO writes — surface it as a
    // WARNING (warning:true, ok:false) so the UI doesn't render it as a fresh
    // successful round close. HTTP stays 200 (idempotent no-op, not an error).
    if (currentRoundNum > round_number) {
      return json({ message: `Round ${round_number} already completed.`, already_processed: true, warning: true, ok: false });
    }
    if (comp.phase === "result") {
      return json({ message: "Competition already finalized.", already_processed: true, warning: true, ok: false });
    }

    // ── FIX 10: Lock completed round ──
    // Spec v3 / Golden Rule "Locking ≠ Declaring":
    //   - Lock = judge finished judging the round. Sets `judging_rounds.status='completed'`
    //     AND stamps `competition_round_publish.closed_at` (audit trail).
    //   - Declare = admin explicitly publishes results to participants. Sets
    //     `competition_round_publish.published_at`. Handled by the publish-round edge fn.
    // Locking does NOT publish, does NOT email participants, does NOT flip participant-visible status.
    // The participant-visibility gate (useGatedEntryStatus / SubmissionDetail / Certificates)
    // already keys off `published_at`, so judge-side mutations stay invisible until admin declares.
    const lockRound = async (rn: number) => {
      const { data: round } = await admin.from("judging_rounds")
        .select("id")
        .eq("competition_id", competition_id)
        .eq("round_number", rn)
        .maybeSingle();
      if (round) {
        await admin.from("judging_rounds").update({ status: "completed" }).eq("id", round.id);
      }
      // Stamp the lock side of the two-step gate. Upsert because the row may not exist yet.
      await admin
        .from("competition_round_publish")
        .upsert(
          {
            competition_id,
            round_number: rn,
            closed_at: new Date().toISOString(),
            closed_by: callerId,
          },
          { onConflict: "competition_id,round_number" }
        );
    };

    // ── BUG-001 FIX: Auto-activate next round atomically after completing current ──
    const autoActivateNextRound = async (completedRoundNumber: number): Promise<{ activated: boolean; next_round_number?: number; next_round_id?: string }> => {
      if (completedRoundNumber >= 4) return { activated: false }; // R4 = final, no next round
      const nextRoundNumber = completedRoundNumber + 1;
      const { data: nextRound } = await admin.from("judging_rounds")
        .select("id, status")
        .eq("competition_id", competition_id)
        .eq("round_number", nextRoundNumber)
        .maybeSingle();
      if (!nextRound || nextRound.status === "completed") return { activated: false };
      // Activate the next round
      await admin.from("judging_rounds").update({ status: "active" }).eq("id", nextRound.id);
      // Update competition phase
      await admin.from("competitions").update({
        phase: "judging",
        status: "judging",
        current_round: String(nextRoundNumber),
      }).eq("id", competition_id);
      return { activated: true, next_round_number: nextRoundNumber, next_round_id: nextRound.id };
    };

    // ── ROUND 1: DECISION-BASED (FIX 1 — NO SCORE LOGIC) ──
    if (round_number === 1) {
      const entries = await fetchAllEntries({ status_in: "submitted,approved,round1_qualified,rejected,needs_review,shortlisted" });

      if (entries.length === 0) {
        await admin.from("competitions").update({ current_round: "2" }).eq("id", competition_id);
        await lockRound(1);
        const nextActivation = await autoActivateNextRound(1);
        return json({ processed: 0, competition_round: 2, next_round_activated: nextActivation.activated, next_round_number: nextActivation.next_round_number, next_round_id: nextActivation.next_round_id });
      }

      // Fetch all R1 decisions (per-photo) to validate completeness
      const entryIds = entries.map((e: any) => e.id);
      const allR1Decisions: any[] = [];
      for (let i = 0; i < entryIds.length; i += BATCH_SIZE) {
        const chunk = entryIds.slice(i, i + BATCH_SIZE);
        const { data } = await admin.from("judge_decisions")
          .select("entry_id, decision, photo_index, judge_id")
          .eq("round_number", 1)
          .in("entry_id", chunk);
        if (data) allR1Decisions.push(...data);
      }

      // ── TAG-ONLY EQUIVALENCE (BUG #1 ROOT FIX, 2026-04-24, updated 2026-04-26 Spec v3) ──
      // Many R1 judges work tag-only (no judge_decisions rows). Synthesize
      // per-photo decisions from judge_tag_assignments so the coverage gate,
      // needs-review block, and aggregation all work uniformly.
      // Tag label → decision mapping (canonical). We accept BOTH old and new
      // wording so any in-flight assignments from before the Spec v3 rename keep working.
      const TAG_LABEL_TO_DECISION: Record<string, string> = {
        // Spec v3 wording (current DB labels)
        "reject": "reject",
        "accept": "accept",
        "shortlist for r2": "shortlist",
        // Legacy labels (kept for any pre-rename assignments)
        "rejected": "reject",
        "accepted": "accept",
        "qualified for 2nd round": "shortlist",
      };
      // Index existing decisions so tag-derived rows never overwrite an explicit decision.
      const decidedKeys = new Set(
        allR1Decisions.map((d: any) => `${d.judge_id}::${d.entry_id}::${d.photo_index ?? 0}`)
      );
      for (let i = 0; i < entryIds.length; i += BATCH_SIZE) {
        const chunk = entryIds.slice(i, i + BATCH_SIZE);
        const { data: tagRows } = await admin
          .from("judge_tag_assignments")
          .select("entry_id, photo_index, judge_id, round_number, judging_tags!inner(label, visible_in_round)")
          .in("entry_id", chunk);
        for (const row of (tagRows as any[] | null) || []) {
          if (row.round_number !== 1) continue;
          const tag = row.judging_tags;
          if (!tag) continue;
          // Only honour tags visible in R1
          const visible: number[] = Array.isArray(tag.visible_in_round) ? tag.visible_in_round : [];
          if (visible.length > 0 && !visible.includes(1)) continue;
          const decision = TAG_LABEL_TO_DECISION[String(tag.label || "").trim().toLowerCase()];
          if (!decision) continue;
          const pi = row.photo_index ?? 0;
          const key = `${row.judge_id}::${row.entry_id}::${pi}`;
          if (decidedKeys.has(key)) continue; // explicit judge_decisions wins
          decidedKeys.add(key);
          allR1Decisions.push({
            entry_id: row.entry_id,
            judge_id: row.judge_id,
            photo_index: pi,
            decision,
          });
        }
      }

      // Block if any needs_review decisions remain
      const needsReviewDecisions = allR1Decisions.filter((d: any) => d.decision === "needs_review");
      const needsReviewEntryIds = [...new Set(needsReviewDecisions.map((d: any) => d.entry_id))];
      if (needsReviewEntryIds.length > 0) {
        return json({
          error: "Cannot complete round: entries with 'Needs Review' decisions must be resolved first.",
          needs_review_count: needsReviewEntryIds.length,
          needs_review_ids: needsReviewEntryIds.slice(0, 20),
        }, 409);
      }

      // Block if any photos are unjudged (R1: every photo of every entry is eligible)
      const eligibleKeysR1 = await fetchEligiblePhotoKeys(entries, 1);
      const unjudgedIds = findUnjudgedEntries(entries, allR1Decisions, eligibleKeysR1);
      if (unjudgedIds.length > 0) {
        return json({
          error: "Cannot complete round: some photos have not been judged yet.",
          unjudged_count: unjudgedIds.length,
          unjudged_ids: unjudgedIds.slice(0, 20),
        }, 409);
      }

      // Phase 2.1 (D5): 100% Coverage Gate is DEFAULT-ON HARD — no admin bypass.
      // Every assigned judge must decide every eligible photo before round close.
      const coverageR1 = await checkJudgeCoverage(entries, allR1Decisions, eligibleKeysR1);
      if (!coverageR1.ok) {
        console.log(JSON.stringify({
          tag: "round_close_coverage_gate_block",
          competition_id, round_number: 1,
          assigned_judges: coverageR1.assigned_judges,
          missing_judges: coverageR1.missing_judges,
          missing_count: coverageR1.missing_decisions,
          missing_full: coverageR1.missing_full,
        }));
        return json({
          error: `Cannot complete round: ${coverageR1.missing_judges} of ${coverageR1.assigned_judges} assigned judge(s) have not decided every eligible photo (${coverageR1.missing_decisions} missing decision(s)).`,
          missing_judges: coverageR1.missing_judges,
          assigned_judges: coverageR1.assigned_judges,
          missing_decisions: coverageR1.missing_decisions,
          sample: coverageR1.sample,
        }, 409);
      }

      // Aggregate per-photo decisions to entry-level status (deterministic SOW priority).
      // Phase 2.1 (D3/D4): also persist progression_decision per entry.
      const qualifiedIds: string[] = [];
      const shortlistedIds: string[] = [];
      const rejectedIds: string[] = [];
      // BUG-021: entries with ZERO judged eligible photos aggregate to null.
      // The unjudged/coverage gates skip zero-eligible entries by design, so a
      // null here means "no judge ever saw this entry" — it must NEVER fall
      // into the promote bucket. Held out and rejected, surfaced separately.
      const noEligibleIds: string[] = [];
      for (const entry of entries) {
        const photoCount = Array.isArray(entry.photos) ? entry.photos.length : 1;
        const entryDecision = aggregateEntryDecision(entry.id, photoCount, allR1Decisions, eligibleKeysR1);
        if (entryDecision === null) noEligibleIds.push(entry.id);
        else if (entryDecision === "reject" || entryDecision === "rejected") rejectedIds.push(entry.id);
        else if (entryDecision === "shortlist" || entryDecision === "shortlisted") shortlistedIds.push(entry.id);
        else qualifiedIds.push(entry.id); // accept / round1_qualified
      }

      // X19 DRY-RUN: return computed decisions without writing.
      if (dry_run) {
        return json({
          ok: true, dry_run: true, round_number: 1,
          preview: {
            processed: entries.length,
            rejected: rejectedIds.length, rejected_ids: rejectedIds,
            qualified: qualifiedIds.length, qualified_ids: qualifiedIds,
            shortlisted: shortlistedIds.length, shortlisted_ids: shortlistedIds,
            // BUG-021: zero-eligible-photo entries are rejected, never promoted.
            no_eligible_photos: noEligibleIds.length, no_eligible_photos_ids: noEligibleIds,
            // 16-Key Frozen Contract v3 (Phase 1): r1_shortlisted_for_r2 → r1_shortlisted_r2.
            stage_keys_used: ["r1_rejected", "r1_accepted", "r1_shortlisted_r2"],
          },
        });
      }

      // 16-Key Frozen Contract v3 — progression_decision MUST be an active
      // v3_stage_catalog.stage_key. Validated by trg_progression_decision_vocabulary_gate.
      // Phase 1 renamed r1_shortlisted_for_r2 → r1_shortlisted_r2.
      if (rejectedIds.length > 0) await batchUpdateEntries(rejectedIds, { status: "rejected", current_round: "1", progression_decision: "r1_rejected" });
      // BUG-021: zero-eligible entries are held back as rejected (same shape as
      // judge-rejected) — reported separately via no_eligible_photos.
      if (noEligibleIds.length > 0) {
        console.log(JSON.stringify({ tag: "round_close_no_eligible_photos", round_number: 1, competition_id, count: noEligibleIds.length, ids: noEligibleIds }));
        await batchUpdateEntries(noEligibleIds, { status: "rejected", current_round: "1", progression_decision: "r1_rejected" });
      }

      await Promise.all([
        // PHASE-2 (owner SOW 2026-07-16): "Accepted in Round 1" is TERMINAL — the
        // entry's journey ends at R1 (current_round stays "1") and it earns the
        // Round-1 Acceptance Certificate (issued after Declare — Phase 3).
        // Only "Shortlist for Round 2" advances.
        qualifiedIds.length > 0 ? batchUpdateEntries(qualifiedIds, { status: "round1_qualified", current_round: "1", certificate_ready: false, progression_decision: "r1_accepted" }) : Promise.resolve(),
        shortlistedIds.length > 0 ? batchUpdateEntries(shortlistedIds, { status: "shortlisted", current_round: "2", certificate_ready: false, progression_decision: "r1_shortlisted_r2" }) : Promise.resolve(),
      ]);

      await admin.from("competitions").update({ current_round: "2" }).eq("id", competition_id);
      await lockRound(1);
      const nextActivation = await autoActivateNextRound(1);

      return json({
        processed: entries.length,
        rejected: rejectedIds.length,
        qualified: qualifiedIds.length,
        shortlisted: shortlistedIds.length,
        no_eligible_photos: noEligibleIds.length,
        no_eligible_photos_ids: noEligibleIds,
        competition_round: 2,
        round_locked: true,
        mode: "decision_based",
        next_round_activated: nextActivation.activated,
        next_round_number: nextActivation.next_round_number,
        next_round_id: nextActivation.next_round_id,
      });
    }

    // ── ROUND 2: DECISION-BASED PROGRESSION ──
    if (round_number === 2) {
      // Round 2 includes every entry promoted out of Round 1:
      // - round1_qualified = accepted into Round 2
      // - shortlisted = explicitly shortlisted into Round 2
      const entries = await fetchAllEntries({ current_round: "2", status_in: "round1_qualified,shortlisted" });

      await saveSnapshot(entries);

      if (entries.length === 0) {
        await admin.from("competitions").update({ current_round: "3" }).eq("id", competition_id);
        await lockRound(2);
        const nextActivation = await autoActivateNextRound(2);
        return json({ processed: 0, promoted: 0, qualified: 0, competition_round: 3, next_round_activated: nextActivation.activated, next_round_number: nextActivation.next_round_number, next_round_id: nextActivation.next_round_id });
      }

      const entryIds = entries.map((e: any) => e.id);

      // Fetch all R2 judge decisions (per-photo)
      const allDecisions: any[] = [];
      for (let i = 0; i < entryIds.length; i += BATCH_SIZE) {
        const chunk = entryIds.slice(i, i + BATCH_SIZE);
        const { data } = await admin.from("judge_decisions")
          .select("entry_id, decision, photo_index, judge_id")
          .eq("round_number", 2)
          .in("entry_id", chunk);
        if (data) allDecisions.push(...data);
      }

      // Spec V3: 'Needs Review' is R1-only — no NR gate for R2.
      // Any stray needs_review row (DB guard now hard-rejects new ones) is
      // ignored as a no-op decision and treated as 'no decision' for that
      // judge/photo. The coverage gate below will still flag truly missing
      // decisions.

      // Block if any photos are unjudged (only photos shortlisted in R1 are eligible for R2)
      const eligibleKeysR2 = await fetchEligiblePhotoKeys(entries, 2);
      const unjudgedIds = findUnjudgedEntries(entries, allDecisions, eligibleKeysR2);
      if (unjudgedIds.length > 0) {
        return json({
          error: "Cannot complete round: some photos have not been judged yet.",
          unjudged_count: unjudgedIds.length,
          unjudged_ids: unjudgedIds.slice(0, 20),
        }, 409);
      }

      // Phase 2.1 (D5): 100% Coverage Gate is DEFAULT-ON HARD — no admin bypass.
      const coverageR2 = await checkJudgeCoverage(entries, allDecisions, eligibleKeysR2);
      if (!coverageR2.ok) {
        console.log(JSON.stringify({
          tag: "round_close_coverage_gate_block",
          competition_id, round_number: 2,
          assigned_judges: coverageR2.assigned_judges,
          missing_judges: coverageR2.missing_judges,
          missing_count: coverageR2.missing_decisions,
          missing_full: coverageR2.missing_full,
        }));
        return json({
          error: `Cannot complete round: ${coverageR2.missing_judges} of ${coverageR2.assigned_judges} assigned judge(s) have not decided every eligible photo (${coverageR2.missing_decisions} missing decision(s)).`,
          missing_judges: coverageR2.missing_judges,
          assigned_judges: coverageR2.assigned_judges,
          missing_decisions: coverageR2.missing_decisions,
          sample: coverageR2.sample,
        }, 409);
      }

      // Spec v3 / B3+B4: every (judge, eligible photo) must have all 10 SOW criteria filled.
      const scoreCovR2 = await checkScoreCoverage(entries, eligibleKeysR2);
      if (!scoreCovR2.ok) {
        return json({
          error: `Cannot complete Round 2 — ${scoreCovR2.summary}. Each photo needs all 10 SOW criteria scored.`,
          missing_score_count: scoreCovR2.missing_count,
          sample: scoreCovR2.sample,
          summary: scoreCovR2.summary,
          code: "scores_incomplete",
        }, 409);
      }

      // Aggregate per-photo decisions to entry-level (eligible photos only).
      // Ruleset v4 (2026-04-29): R2 is strictly BINARY — promote / reject.
      // R2 entries earn NO certificate (certs are R4-only).
      const promotedIds: string[] = [];
      const rejectedIds: string[] = [];
      const qualifiedIds: string[] = []; // legacy fallback (unmapped decision string only)
      // BUG-021: null aggregate = zero judged eligible photos (gates skip these
      // entries by design). Previously fell into the fallback promote bucket —
      // ghost entries no judge ever saw advanced to R3. Now rejected + surfaced.
      const noEligibleIds: string[] = [];
      for (const entry of entries) {
        const photoCount = Array.isArray(entry.photos) ? entry.photos.length : 1;
        const entryDecision = aggregateEntryDecision(entry.id, photoCount, allDecisions, eligibleKeysR2);
        if (entryDecision === null) noEligibleIds.push(entry.id);
        else if (entryDecision === "shortlist" || entryDecision === "shortlisted" || entryDecision === "qualified_r3") promotedIds.push(entry.id);
        else if (entryDecision === "reject" || entryDecision === "rejected" || entryDecision === "skip") rejectedIds.push(entry.id);
        else qualifiedIds.push(entry.id);
      }

      // X19 DRY-RUN: return computed decisions without writing.
      if (dry_run) {
        return json({
          ok: true, dry_run: true, round_number: 2,
          preview: {
            processed: entries.length,
            promoted: promotedIds.length, promoted_ids: promotedIds,
            rejected: rejectedIds.length, rejected_ids: rejectedIds,
            qualified_fallback: qualifiedIds.length, qualified_fallback_ids: qualifiedIds,
            // BUG-021: zero-eligible-photo entries are rejected, never promoted.
            no_eligible_photos: noEligibleIds.length, no_eligible_photos_ids: noEligibleIds,
            // B1.9: Rejected R2 entries no longer carry progression_decision.
            // entry_public_status derives r2_not_selected_r3 from
            // (status='rejected' + current_round=2). Pass branches still write
            // r2_qualified_r3 / r2_accepted as canonical decisions.
            stage_keys_used: ["r2_qualified_r3", "r2_accepted"],
            rejects_use_status_only: true,
          },
        });
      }

      // Declared-result source of truth:
      //  - Promoted/qualified entries carry a canonical progression_decision so
      //    entry_public_status can reveal them immediately after Admin declares R2.
      //  - Rejected entries do NOT receive a progression_decision (B1.9): the view
      //    derives 'r2_not_selected_r3' from (status='rejected' + current_round='2').
      //    current_round stays at '2' so the derivation is unambiguous.
      // BUG-021: zero-eligible entries take the reject write (B1.9: no
      // progression_decision; public status derives from status+round).
      if (noEligibleIds.length > 0) {
        console.log(JSON.stringify({ tag: "round_close_no_eligible_photos", round_number: 2, competition_id, count: noEligibleIds.length, ids: noEligibleIds }));
      }
      await Promise.all([
        promotedIds.length > 0 ? batchUpdateEntries(promotedIds, { status: "round2_qualified", current_round: "3", certificate_ready: false, progression_decision: "r2_qualified_r3" }) : Promise.resolve(),
        rejectedIds.length > 0 ? batchUpdateEntries(rejectedIds, { status: "rejected", current_round: "2", certificate_ready: false }) : Promise.resolve(),
        noEligibleIds.length > 0 ? batchUpdateEntries(noEligibleIds, { status: "rejected", current_round: "2", certificate_ready: false }) : Promise.resolve(),
        // PHASE-2 (owner SOW): "Accepted in Round 2" is TERMINAL — stays at R2
        // (current_round "2"), earns the Round-2 Acceptance Certificate after
        // Declare (Phase 3). Only "Qualified for Round 3" advances.
        qualifiedIds.length > 0 ? batchUpdateEntries(qualifiedIds, { status: "round2_qualified", current_round: "2", certificate_ready: false, progression_decision: "r2_accepted" }) : Promise.resolve(),
      ]);

      await admin.from("competitions").update({ current_round: "3" }).eq("id", competition_id);
      await lockRound(2);
      const nextActivation = await autoActivateNextRound(2);
      return json({
        processed: entries.length,
        promoted: promotedIds.length,
        rejected: rejectedIds.length,
        qualified: qualifiedIds.length,
        no_eligible_photos: noEligibleIds.length,
        no_eligible_photos_ids: noEligibleIds,
        competition_round: 3,
        progression: "decision_based_binary_v4",
        round_locked: true,
        mode: "decision_based_binary_v4",
        next_round_activated: nextActivation.activated,
        next_round_number: nextActivation.next_round_number,
        next_round_id: nextActivation.next_round_id,
      });
    }

    // ── ROUND 3: DECISION-BASED PROGRESSION ──
    if (round_number === 3) {
      const entries = await fetchAllEntries({ current_round: "3" });

      await saveSnapshot(entries);

      if (entries.length === 0) {
        await admin.from("competitions").update({ current_round: "4" }).eq("id", competition_id);
        await lockRound(3);
        const nextActivation = await autoActivateNextRound(3);
        return json({ processed: 0, promoted: 0, held: 0, competition_round: 4, next_round_activated: nextActivation.activated, next_round_number: nextActivation.next_round_number, next_round_id: nextActivation.next_round_id });
      }

      const entryIds = entries.map((e: any) => e.id);

      // Fetch all R3 judge decisions (per-photo)
      const allDecisions: any[] = [];
      for (let i = 0; i < entryIds.length; i += BATCH_SIZE) {
        const chunk = entryIds.slice(i, i + BATCH_SIZE);
        const { data } = await admin.from("judge_decisions")
          .select("entry_id, decision, photo_index, judge_id")
          .eq("round_number", 3)
          .in("entry_id", chunk);
        if (data) allDecisions.push(...data);
      }

      // Spec V3: 'Needs Review' is R1-only — no NR gate for R3.
      // Any stray needs_review row (DB guard now hard-rejects new ones) is
      // ignored as a no-op decision and treated as 'no decision' for that
      // judge/photo. The coverage gate below will still flag truly missing
      // decisions.

      // Block if any photos are unjudged (only photos shortlisted in R2 are eligible for R3)
      const eligibleKeysR3 = await fetchEligiblePhotoKeys(entries, 3);
      const unjudgedIds = findUnjudgedEntries(entries, allDecisions, eligibleKeysR3);
      if (unjudgedIds.length > 0) {
        return json({
          error: "Cannot complete round: some photos have not been judged yet.",
          unjudged_count: unjudgedIds.length,
          unjudged_ids: unjudgedIds.slice(0, 20),
        }, 409);
      }

      // Phase 2.1 (D5): 100% Coverage Gate is DEFAULT-ON HARD — no admin bypass.
      const coverageR3 = await checkJudgeCoverage(entries, allDecisions, eligibleKeysR3);
      if (!coverageR3.ok) {
        console.log(JSON.stringify({
          tag: "round_close_coverage_gate_block",
          competition_id, round_number: 3,
          assigned_judges: coverageR3.assigned_judges,
          missing_judges: coverageR3.missing_judges,
          missing_count: coverageR3.missing_decisions,
          missing_full: coverageR3.missing_full,
        }));
        return json({
          error: `Cannot complete round: ${coverageR3.missing_judges} of ${coverageR3.assigned_judges} assigned judge(s) have not decided every eligible photo (${coverageR3.missing_decisions} missing decision(s)).`,
          missing_judges: coverageR3.missing_judges,
          assigned_judges: coverageR3.assigned_judges,
          missing_decisions: coverageR3.missing_decisions,
          sample: coverageR3.sample,
        }, 409);
      }

      // Spec v3 / B3+B4: every (judge, eligible photo) must have all 10 SOW criteria filled.
      const scoreCovR3 = await checkScoreCoverage(entries, eligibleKeysR3);
      if (!scoreCovR3.ok) {
        return json({
          error: `Cannot complete Round 3 — ${scoreCovR3.summary}. Each photo needs all 10 SOW criteria scored.`,
          missing_score_count: scoreCovR3.missing_count,
          sample: scoreCovR3.sample,
          summary: scoreCovR3.summary,
          code: "scores_incomplete",
        }, 409);
      }

      // Aggregate per-photo decisions to entry-level (eligible photos only).
      // Ruleset v4 (2026-04-29): R3 is strictly BINARY — promote / reject.
      // R3 entries earn NO certificate (certs are R4-only).
      const promotedIds: string[] = [];
      const rejectedIds: string[] = [];
      const finalistIds: string[] = []; // legacy fallback (unmapped decision string only)
      // BUG-021: null aggregate = zero judged eligible photos (gates skip these
      // entries by design). Previously fell into the fallback promote bucket —
      // ghost entries no judge ever saw became FINALISTS. Now rejected + surfaced.
      const noEligibleIds: string[] = [];
      for (const entry of entries) {
        const photoCount = Array.isArray(entry.photos) ? entry.photos.length : 1;
        const entryDecision = aggregateEntryDecision(entry.id, photoCount, allDecisions, eligibleKeysR3);
        if (entryDecision === null) noEligibleIds.push(entry.id);
        else if (entryDecision === "shortlist" || entryDecision === "shortlisted" || entryDecision === "qualified_final" || entryDecision === "shortlisted_final") promotedIds.push(entry.id);
        else if (entryDecision === "reject" || entryDecision === "rejected" || entryDecision === "skip") rejectedIds.push(entry.id);
        else finalistIds.push(entry.id);
      }

      // X19 DRY-RUN: return computed decisions without writing.
      if (dry_run) {
        return json({
          ok: true, dry_run: true, round_number: 3,
          preview: {
            processed: entries.length,
            promoted: promotedIds.length, promoted_ids: promotedIds,
            rejected: rejectedIds.length, rejected_ids: rejectedIds,
            finalist_fallback: finalistIds.length, finalist_fallback_ids: finalistIds,
            // BUG-021: zero-eligible-photo entries are rejected, never promoted.
            no_eligible_photos: noEligibleIds.length, no_eligible_photos_ids: noEligibleIds,
            // B1.9: Rejected R3 entries no longer carry progression_decision.
            // entry_public_status derives r3_not_selected_final from
            // (status='rejected' + current_round=3). Pass branches still write
            // r3_qualified_final / r3_accepted as canonical decisions.
            stage_keys_used: ["r3_qualified_final", "r3_accepted"],
            rejects_use_status_only: true,
          },
        });
      }

      // Declared-result source of truth:
      //  - Promoted/qualified entries carry a canonical progression_decision so
      //    entry_public_status can reveal them immediately after Admin declares R3.
      //  - Rejected entries do NOT receive a progression_decision (B1.9): the view
      //    derives 'r3_not_selected_final' from (status='rejected' + current_round='3').
      //    current_round stays at '3' so the derivation is unambiguous.
      // BUG-021: zero-eligible entries take the reject write (B1.9: no
      // progression_decision; public status derives from status+round).
      if (noEligibleIds.length > 0) {
        console.log(JSON.stringify({ tag: "round_close_no_eligible_photos", round_number: 3, competition_id, count: noEligibleIds.length, ids: noEligibleIds }));
      }
      await Promise.all([
        promotedIds.length > 0 ? batchUpdateEntries(promotedIds, { status: "finalist", current_round: "4", certificate_ready: false, progression_decision: "r3_qualified_final" }) : Promise.resolve(),
        rejectedIds.length > 0 ? batchUpdateEntries(rejectedIds, { status: "rejected", current_round: "3", certificate_ready: false }) : Promise.resolve(),
        noEligibleIds.length > 0 ? batchUpdateEntries(noEligibleIds, { status: "rejected", current_round: "3", certificate_ready: false }) : Promise.resolve(),
        // PHASE-2 (owner SOW): "Accepted in Round 3" is TERMINAL — the entry
        // stops at R3 as round3_qualified (NOT a finalist; requires the
        // round3_qualified status added by phase2_prereqs.sql) and earns the
        // Round-3 Acceptance Certificate after Declare (Phase 3).
        // Only "Qualified for Final" advances to R4.
        finalistIds.length > 0 ? batchUpdateEntries(finalistIds, { status: "round3_qualified", current_round: "3", certificate_ready: false, progression_decision: "r3_accepted" }) : Promise.resolve(),
      ]);

      await admin.from("competitions").update({ current_round: "4" }).eq("id", competition_id);
      await lockRound(3);
      const nextActivation = await autoActivateNextRound(3);
      return json({
        processed: entries.length,
        promoted: promotedIds.length,
        rejected: rejectedIds.length,
        held: finalistIds.length,
        no_eligible_photos: noEligibleIds.length,
        no_eligible_photos_ids: noEligibleIds,
        competition_round: 4,
        progression: "decision_based_binary_v4",
        round_locked: true,
        mode: "decision_based_binary_v4",
        next_round_activated: nextActivation.activated,
        next_round_number: nextActivation.next_round_number,
        next_round_id: nextActivation.next_round_id,
      });
    }

    // ── ROUND 4: FINAL AWARDS (TAG-BASED, JUDGE-CONTROLLED) ──
    if (round_number === 4) {
      // Phase 3.2: load catalog-derived award vocabulary (with safe fallback).
      const { AWARD_STATUS_MAP, REQUIRED_AWARDS, UNIQUE_AWARDS, source: catalogSource } =
        await loadAwardCatalog(admin);
      console.log(`[complete-round] R4 award vocabulary source=${catalogSource}, ` +
        `awards=${Object.keys(AWARD_STATUS_MAP).length}, required=${REQUIRED_AWARDS.length}, ` +
        `unique=${UNIQUE_AWARDS.length}`);

      const entries = await fetchAllEntries({ current_round: "4" });

      await saveSnapshot(entries);

      if (entries.length === 0) {
        return json({ error: "No entries in Round 4. Cannot finalize." }, 409);
      }

      const entryIds = entries.map((e: any) => e.id);

      // JUDGING-15: every (judge, eligible R4 photo) must have all 15 criteria.
      // R4 eligibility = every photo of every R4 entry (no decision-based pre-filter at R4).
      const eligibleKeysR4 = await fetchEligiblePhotoKeys(entries, 4);
      // BUG-055 (owner decision 2026-07-16): ANY photo carrying an R4 award tag
      // must be fully scored, even if it wasn't in the R3-qualified eligible set.
      // Union award-tagged photos into the coverage key set so an award can never
      // rest on an unscored photo.
      {
        const { data: awardTagged } = await admin
          .from("judge_tag_assignments")
          .select("entry_id, photo_index")
          .eq("round_number", 4)
          .in("entry_id", entryIds);
        for (const t of (awardTagged || [])) {
          eligibleKeysR4.add(`${(t as any).entry_id}::${(t as any).photo_index ?? 0}`);
        }
      }
      const scoreCovR4 = await checkScoreCoverage(entries, eligibleKeysR4);
      if (!scoreCovR4.ok) {
        return json({
          error: `Cannot finalize Round 4 — ${scoreCovR4.summary}. Each photo (including every award-tagged photo) needs all 15 criteria scored.`,
          missing_score_count: scoreCovR4.missing_count,
          sample: scoreCovR4.sample,
          summary: scoreCovR4.summary,
          code: "scores_incomplete",
        }, 409);
      }

      // Fetch all R4 tags
      const { data: r4Tags } = await admin.from("judging_tags").select("id, label, visible_in_round");
      const r4TagMap = new Map<string, string>();
      (r4Tags || []).forEach((tag: any) => {
        if (Array.isArray(tag.visible_in_round) && tag.visible_in_round.includes(4)) {
          r4TagMap.set(tag.id, normalizeTagLabel(tag.label));
        }
      });

      if (r4TagMap.size === 0) {
        return json({ error: "No award tags configured for Round 4." }, 409);
      }

      // Fetch all tag assignments for R4 entries
      const tagAssignments: any[] = [];
      for (let i = 0; i < entryIds.length; i += BATCH_SIZE) {
        const chunk = entryIds.slice(i, i + BATCH_SIZE);
        const { data } = await admin.from("judge_tag_assignments").select("entry_id, tag_id").eq("round_number", 4).in("entry_id", chunk);
        if (data) tagAssignments.push(...data);
      }

      // Build: label → list of entry_ids
      const awardEntries = new Map<string, string[]>();
      for (const ta of tagAssignments) {
        const label = r4TagMap.get(ta.tag_id);
        if (!label) continue;
        const existing = awardEntries.get(label) || [];
        if (!existing.includes(ta.entry_id)) existing.push(ta.entry_id);
        awardEntries.set(label, existing);
      }

      // ── VALIDATION: Required awards ──
      const missingAwards: string[] = [];
      for (const required of REQUIRED_AWARDS) {
        const found = awardEntries.get(required);
        if (!found || found.length === 0) {
          missingAwards.push(required);
        }
      }
      if (missingAwards.length > 0) {
        return json({
          error: `Cannot finalize Round 4: Winner has not been assigned. Winner is the only mandatory award; Runner-Ups, Honorary Mention, and Special Jury Award are optional.`,
          missing_awards: missingAwards,
          required_awards: REQUIRED_AWARDS,
        }, 422);
      }

      // ── VALIDATION: Unique awards ──
      const duplicateAwards: string[] = [];
      for (const unique of UNIQUE_AWARDS) {
        const found = awardEntries.get(unique);
        if (found && found.length > 1) {
          duplicateAwards.push(`${unique} (${found.length} entries)`);
        }
      }
      if (duplicateAwards.length > 0) {
        return json({
          error: "Unique awards can only be assigned to one entry each.",
          duplicate_awards: duplicateAwards,
        }, 409);
      }

      // ── STATUS UPDATES ──
      // DB CHECK constraint `competition_entries_status_check` only allows:
      //   submitted, approved, rejected, round1_qualified, shortlisted,
      //   round2_qualified, finalist, winner, needs_review.
      // Therefore the actual award identity (runner_up_1, runner_up_2,
      // honorary_mention, special_jury) must live in `placement` (free text),
      // NOT in `status`. Only the Winner gets status='winner'; every other
      // awarded entry keeps status='finalist' and carries the award in placement.
      const statusUpdates: { ids: string[]; placement: string; status: string; certificate: boolean }[] = [];

      for (const [label, eids] of awardEntries) {
        const decisionToken = AWARD_STATUS_MAP[label];
        const placementKey = AWARD_DECISION_TOKEN_TO_PUBLIC_KEY[decisionToken] ?? decisionToken;
        if (placementKey) {
          statusUpdates.push({
            ids: eids,
            placement: placementKey,
            // Only "winner" is a valid status enum value among the R4 awards.
            status: placementKey === "winner" ? "winner" : "finalist",
            certificate: true,
          });
        }
      }

      // Entries with no award tag remain as "finalist"
      const awardedEntryIds = new Set(statusUpdates.flatMap((u) => u.ids));
      const nonAwardedIds = entryIds.filter((id: string) => !awardedEntryIds.has(id));

      // X19 DRY-RUN: return computed awards without writing.
      if (dry_run) {
        return json({
          ok: true, dry_run: true, round_number: 4,
          preview: {
            processed: entries.length,
            awards: statusUpdates.map((u) => ({
              placement: u.placement, status: u.status,
              certificate_ready: u.certificate, ids: u.ids, count: u.ids.length,
            })),
            finalists_remaining: nonAwardedIds.length,
            finalists_remaining_ids: nonAwardedIds,
          },
        });
      }

      // Apply status + placement updates
      for (const update of statusUpdates) {
        await batchUpdateEntries(update.ids, {
          status: update.status,
          certificate_ready: update.certificate,
          placement: update.placement,
        });
      }

      // Mark non-awarded as finalist (no certificate yet)
      if (nonAwardedIds.length > 0) {
        await batchUpdateEntries(nonAwardedIds, { status: "finalist" });
      }

      // Finalize competition
      await admin.from("competitions").update({
        current_round: "4",
        phase: "result",
        status: "result",
        judging_completed: true,
      }).eq("id", competition_id);

      // FIX 10: Lock Round 4
      await lockRound(4);

      return json({
        processed: entries.length,
        awards: Object.fromEntries(statusUpdates.map((u) => [u.status, u.ids.length])),
        finalists_remaining: nonAwardedIds.length,
        competition_phase: "result",
        competition_status: "result",
        round_locked: true,
      });
    }

    return json({ error: "Unhandled round_number" }, 400);
  } catch (err: any) {
    console.error("complete-round error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
