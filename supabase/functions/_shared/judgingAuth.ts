/**
 * Shared authentication & authorization helper for all judging edge functions.
 * Ensures: JWT validation, role check (judge or admin), and provides admin service client.
 */
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface JudgingAuthResult {
  userId: string;
  isAdmin: boolean;
  isJudge: boolean;
  admin: SupabaseClient;
}

export async function authenticateJudge(req: Request): Promise<JudgingAuthResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header", 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const token = authHeader.replace("Bearer ", "");

  // Validate JWT
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user?.id) {
    throw new AuthError("Unauthorized: invalid token", 401);
  }

  const userId = userData.user.id;
  const admin = createClient(supabaseUrl, serviceKey);

  // Check roles — must be judge OR admin
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "judge"]);

  const roleSet = new Set((roles || []).map((r: any) => r.role));
  const isAdmin = roleSet.has("admin");
  const isJudge = roleSet.has("judge");

  if (!isAdmin && !isJudge) {
    throw new AuthError("Forbidden: judge or admin role required", 403);
  }

  return { userId, isAdmin, isJudge, admin };
}

/**
 * Fetch consensus config from judging_config table (server-side truth).
 * Falls back to defaults if no config exists.
 */
export async function getConsensusConfig(
  admin: SupabaseClient,
  competitionId: string,
  roundNumber: number
): Promise<{ threshold: number; minJudges: number }> {
  const { data } = await admin
    .from("judging_config")
    .select("threshold, min_judges")
    .eq("competition_id", competitionId)
    .eq("round_number", roundNumber)
    .maybeSingle();

  return {
    threshold: data?.threshold ?? 0.5,
    minJudges: data?.min_judges ?? 2,
  };
}

/**
 * Validate that a round is NOT completed (locked).
 * Admins can bypass. Throws AuthError if locked and not admin.
 */
export async function validateRoundNotLocked(
  admin: SupabaseClient,
  competitionId: string,
  roundNumber: number,
  isAdmin: boolean
): Promise<void> {
  const { data: round } = await admin
    .from("judging_rounds")
    .select("status")
    .eq("competition_id", competitionId)
    .eq("round_number", roundNumber)
    .maybeSingle();

  if (round?.status === "completed" && !isAdmin) {
    throw new AuthError(`Round ${roundNumber} is completed. Changes are locked.`, 403);
  }
}

/**
 * Validate that a judge is assigned to an entry's competition.
 * For distributed mode, also checks judge_entry_assignments.
 */
export async function validateJudgeAssignment(
  admin: SupabaseClient,
  userId: string,
  entryId: string,
  competitionId: string,
  isAdmin: boolean
): Promise<void> {
  if (isAdmin) return; // Admins can access any entry

  // Check competition-level assignment
  const { data: cj } = await admin
    .from("competition_judges")
    .select("id")
    .eq("competition_id", competitionId)
    .eq("judge_id", userId)
    .maybeSingle();

  if (!cj) {
    throw new AuthError("Forbidden: you are not assigned to this competition", 403);
  }

  // Check entry-level assignment if distributed mode
  const { data: comp } = await admin
    .from("competitions")
    .select("judge_assignment_mode")
    .eq("id", competitionId)
    .single();

  if (comp?.judge_assignment_mode === "distributed") {
    const { data: assignment } = await admin
      .from("judge_entry_assignments")
      .select("id")
      .eq("entry_id", entryId)
      .eq("judge_id", userId)
      .maybeSingle();

    if (!assignment) {
      throw new AuthError("Forbidden: this entry is not assigned to you", 403);
    }
  }
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
