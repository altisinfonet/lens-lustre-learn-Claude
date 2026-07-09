/**
 * WalletReconciliationAudit — Wallet Phase 2.3 admin widget.
 * Surfaces drift between gift_announcements/referrals and wallet_transactions:
 *   - announcements with no wallet credit
 *   - amount mismatches
 *   - orphan wallet credits
 * Provides one-click backfill via fix_gift_drift_admin / fix_referral_drift_admin RPCs.
 *
 * Re-uses the same forensic pattern as JudgingDriftAudit and AwardsIntegrityAudit.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, RefreshCw, ShieldCheck, Wrench, Wallet, Gift, UserPlus } from "lucide-react";
import { toast } from "@/hooks/core/use-toast";

interface GiftRow {
  drift_type: string;
  announcement_id: string | null;
  user_id: string;
  gift_credit_id: string | null;
  expected_amount: number | null;
  actual_amount: number | null;
  is_expired: boolean | null;
  created_at: string;
  notes: string | null;
}

interface RefRow {
  drift_type: string;
  referral_id: string | null;
  referrer_id: string;
  referred_id: string | null;
  expected_amount: number | null;
  actual_amount: number | null;
  rewarded_at: string | null;
  notes: string | null;
}

const WalletReconciliationAudit = () => {
  const [giftRows, setGiftRows] = useState<GiftRow[] | null>(null);
  const [refRows, setRefRows] = useState<RefRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixingId, setFixingId] = useState<string | null>(null);

  const fetchAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, r] = await Promise.all([
        supabase.rpc("get_gift_drift_admin" as any),
        supabase.rpc("get_referral_drift_admin" as any),
      ]);
      if (g.error) throw g.error;
      if (r.error) throw r.error;
      setGiftRows((g.data as GiftRow[]) || []);
      setRefRows((r.data as RefRow[]) || []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load wallet reconciliation report");
    } finally {
      setLoading(false);
    }
  };

  const fixGift = async (row: GiftRow) => {
    if (!row.announcement_id) {
      toast({ title: "Cannot fix orphan", description: "No source announcement to backfill from.", variant: "destructive" });
      return;
    }
    setFixingId(row.announcement_id);
    try {
      const { data, error: rpcErr } = await supabase.rpc("fix_gift_drift_admin" as any, { _announcement_id: row.announcement_id });
      if (rpcErr) throw rpcErr;
      toast({ title: "Gift backfilled", description: `Tx: ${(data as any)?.tx_id?.slice(0, 8) ?? "ok"}` });
      await fetchAudit();
    } catch (e: any) {
      toast({ title: "Fix failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setFixingId(null);
    }
  };

  const fixReferral = async (row: RefRow) => {
    if (!row.referral_id) {
      toast({ title: "Cannot fix orphan", description: "No source referral to backfill from.", variant: "destructive" });
      return;
    }
    setFixingId(row.referral_id);
    try {
      const { data, error: rpcErr } = await supabase.rpc("fix_referral_drift_admin" as any, { _referral_id: row.referral_id });
      if (rpcErr) throw rpcErr;
      toast({ title: "Referral backfilled", description: `Tx: ${(data as any)?.tx_id?.slice(0, 8) ?? "ok"}` });
      await fetchAudit();
    } catch (e: any) {
      toast({ title: "Fix failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setFixingId(null);
    }
  };

  const giftCount = giftRows?.length ?? 0;
  const refCount = refRows?.length ?? 0;
  const totalCount = giftCount + refCount;
  const hasRun = giftRows !== null || refRows !== null;

  return (
    <div className="border-2 border-emerald-500/40 rounded-lg p-5 bg-emerald-500/5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
          <Wallet className="h-3.5 w-3.5 text-emerald-500" />
          Wallet Reconciliation Audit (Gifts + Referrals)
        </h3>
        <button
          onClick={fetchAudit}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-emerald-500 text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Scanning…" : !hasRun ? "Run Scan" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="border border-destructive/30 bg-destructive/5 p-2 mt-2">
          <p className="text-[10px] text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" /> {error}
          </p>
        </div>
      )}

      {hasRun && !error && (
        <div className="mt-2 space-y-3">
          <div className={`flex items-center gap-2 text-[10px] tracking-[0.1em] uppercase ${totalCount === 0 ? "text-green-500" : "text-yellow-500"}`} style={{ fontFamily: "var(--font-heading)" }}>
            {totalCount === 0 ? (
              <><ShieldCheck className="h-3 w-3" /> Clean — 0 wallet drift findings</>
            ) : (
              <><AlertTriangle className="h-3 w-3" /> {giftCount} gift drift · {refCount} referral drift</>
            )}
          </div>

          {giftCount > 0 && (
            <div>
              <p className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground mb-1 flex items-center gap-1" style={{ fontFamily: "var(--font-heading)" }}>
                <Gift className="h-2.5 w-2.5" /> Gift Drift
              </p>
              <div className="border border-border max-h-60 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="text-left p-2 font-medium">User</th>
                      <th className="text-left p-2 font-medium">Type</th>
                      <th className="text-right p-2 font-medium">Expected</th>
                      <th className="text-right p-2 font-medium">Actual</th>
                      <th className="text-left p-2 font-medium">Notes</th>
                      <th className="text-right p-2 font-medium w-20">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {giftRows!.map((r, i) => (
                      <tr key={`g-${i}`} className="hover:bg-muted/40">
                        <td className="p-2 font-mono text-[9px]">{r.user_id.slice(0, 8)}</td>
                        <td className="p-2 text-yellow-500">{r.drift_type}</td>
                        <td className="p-2 text-right">{r.expected_amount ?? "—"}</td>
                        <td className="p-2 text-right">{r.actual_amount ?? "—"}</td>
                        <td className="p-2 text-muted-foreground text-[9px] max-w-[200px] truncate" title={r.notes ?? ""}>{r.notes ?? "—"}</td>
                        <td className="p-2 text-right">
                          <button
                            onClick={() => fixGift(r)}
                            disabled={fixingId === r.announcement_id || !r.announcement_id || r.is_expired === true}
                            className="inline-flex items-center gap-1 text-[9px] tracking-[0.1em] uppercase px-1.5 py-0.5 border border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-40 transition-colors"
                            style={{ fontFamily: "var(--font-heading)" }}
                            title={r.is_expired ? "Expired — cannot backfill" : !r.announcement_id ? "Orphan — no source" : "Backfill wallet credit"}
                          >
                            <Wrench className="h-2.5 w-2.5" />
                            {fixingId === r.announcement_id ? "…" : "Fix"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {refCount > 0 && (
            <div>
              <p className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground mb-1 flex items-center gap-1" style={{ fontFamily: "var(--font-heading)" }}>
                <UserPlus className="h-2.5 w-2.5" /> Referral Drift
              </p>
              <div className="border border-border max-h-60 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="text-left p-2 font-medium">Referrer</th>
                      <th className="text-left p-2 font-medium">Type</th>
                      <th className="text-right p-2 font-medium">Expected</th>
                      <th className="text-right p-2 font-medium">Actual</th>
                      <th className="text-left p-2 font-medium">Notes</th>
                      <th className="text-right p-2 font-medium w-20">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {refRows!.map((r, i) => (
                      <tr key={`r-${i}`} className="hover:bg-muted/40">
                        <td className="p-2 font-mono text-[9px]">{r.referrer_id.slice(0, 8)}</td>
                        <td className="p-2 text-yellow-500">{r.drift_type}</td>
                        <td className="p-2 text-right">{r.expected_amount ?? "—"}</td>
                        <td className="p-2 text-right">{r.actual_amount ?? "—"}</td>
                        <td className="p-2 text-muted-foreground text-[9px] max-w-[200px] truncate" title={r.notes ?? ""}>{r.notes ?? "—"}</td>
                        <td className="p-2 text-right">
                          <button
                            onClick={() => fixReferral(r)}
                            disabled={fixingId === r.referral_id || !r.referral_id}
                            className="inline-flex items-center gap-1 text-[9px] tracking-[0.1em] uppercase px-1.5 py-0.5 border border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-40 transition-colors"
                            style={{ fontFamily: "var(--font-heading)" }}
                            title={!r.referral_id ? "Orphan — no source" : "Backfill wallet credit"}
                          >
                            <Wrench className="h-2.5 w-2.5" />
                            {fixingId === r.referral_id ? "…" : "Fix"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {!hasRun && !loading && !error && (
        <p className="text-xs text-muted-foreground italic mt-2" style={{ fontFamily: "var(--font-body)" }}>
          Compares gift_announcements + referrals against wallet_transactions to find missing or mismatched credits.
        </p>
      )}
    </div>
  );
};

export default WalletReconciliationAudit;
