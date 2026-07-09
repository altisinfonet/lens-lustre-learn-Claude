/**
 * Competition admin service — all Supabase queries for competition management.
 * Components must NOT call supabase.from() directly for competition operations.
 */
import { supabase } from "@/integrations/supabase/client";

export interface CompetitionPayload {
  title: string;
  description: string | null;
  category: string;
  cover_image_url: string | null;
  entry_fee: number;
  prize_info: string | null;
  max_entries_per_user: number;
  max_photos_per_entry: number;
  starts_at: string;
  ends_at: string;
  voting_ends_at: string;
  ai_images_allowed: boolean;
}

export interface PaymentDetails {
  paypal_email: string | null;
  bank_details: string | null;
  upi_id: string | null;
}

export const competitionService = {
  async fetchFullCompetition(compId: string) {
    const { data } = await supabase
      .from("competitions")
      .select("id, title, description, cover_image_url, category, entry_fee, prize_info, status, phase, max_entries_per_user, max_photos_per_entry, starts_at, ends_at, voting_ends_at, ai_images_allowed")
      .eq("id", compId)
      .single();
    return data;
  },

  async fetchPaymentDetails(compId: string): Promise<PaymentDetails | null> {
    const { data } = await (supabase
      .from("competition_payment_details" as any)
      .select("paypal_email, bank_details, upi_id")
      .eq("competition_id", compId)
      .maybeSingle() as any);
    return data as PaymentDetails | null;
  },

  async createCompetition(payload: CompetitionPayload & { created_by: string }) {
    return supabase
      .from("competitions")
      .insert({
        ...payload,
        updated_at: new Date().toISOString(),
      } as any)
      .select("id")
      .single();
  },

  async updateCompetition(compId: string, payload: CompetitionPayload) {
    return supabase
      .from("competitions")
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", compId);
  },

  async createDefaultRounds(compId: string) {
    const fixedRounds = [
      { competition_id: compId, round_number: 1, name: "Initial Screening" },
      { competition_id: compId, round_number: 2, name: "Round 2" },
      { competition_id: compId, round_number: 3, name: "Round 3" },
      { competition_id: compId, round_number: 4, name: "Final Round" },
    ];
    return supabase.from("judging_rounds").insert(fixedRounds);
  },

  async upsertPaymentDetails(compId: string, details: PaymentDetails) {
    return supabase.from("competition_payment_details" as any).upsert(
      {
        competition_id: compId,
        paypal_email: details.paypal_email,
        bank_details: details.bank_details,
        upi_id: details.upi_id,
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: "competition_id" }
    );
  },

  async archiveCompetition(compId: string, adminId: string) {
    const result = await supabase
      .from("competitions")
      .update({
        status: "archived",
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", compId);

    await supabase.from("db_audit_logs").insert({
      table_name: "competitions",
      operation: "SOFT_DELETE",
      row_id: compId,
      new_data: { archived_by: adminId, archived_at: new Date().toISOString() },
      changed_by: adminId,
    });

    return result;
  },
};
