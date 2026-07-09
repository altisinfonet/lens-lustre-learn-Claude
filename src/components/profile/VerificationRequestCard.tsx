import { useState, useEffect } from "react";
import { BadgeCheck, Send, Clock, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

interface VerificationRequest {
  id: string;
  status: string;
  reason: string | null;
  portfolio_url: string | null;
  admin_message: string | null;
  created_at: string;
}

const VerificationRequestCard = () => {
  const { user } = useAuth();
  const [request, setRequest] = useState<VerificationRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data } = await supabase
        .from("verification_requests" as any)
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setRequest(data as any);
      setLoading(false);
    };
    fetch();
  }, [user]);

  const handleSubmit = async () => {
    if (!user || !reason.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.from("verification_requests" as any).insert({
      user_id: user.id,
      reason: reason.trim(),
      portfolio_url: portfolioUrl.trim() || null,
    } as any);
    if (error) {
      toast({ title: "Failed to submit", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Verification request submitted!" });
      const { data } = await supabase
        .from("verification_requests" as any)
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setRequest(data as any);
    }
    setSubmitting(false);
  };

  if (loading) return null;

  if (request) {
    const statusConfig: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
      pending: { icon: <Clock className="h-4 w-4" />, label: "Under Review", cls: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
      approved: { icon: <CheckCircle2 className="h-4 w-4" />, label: "Approved", cls: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
      rejected: { icon: <XCircle className="h-4 w-4" />, label: "Rejected", cls: "text-destructive bg-destructive/10 border-destructive/20" },
    };
    const cfg = statusConfig[request.status] || statusConfig.pending;

    return (
      <div className="border border-border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
            <BadgeCheck className="h-4 w-4 text-blue-500" />
            Verification Status
          </h3>
          <span className={`inline-flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase px-3 py-1 border rounded-sm ${cfg.cls}`} style={headingFont}>
            {cfg.icon} {cfg.label}
          </span>
        </div>
        {request.admin_message && (
          <p className="text-xs text-muted-foreground" style={bodyFont}>
            <strong>Admin message:</strong> {request.admin_message}
          </p>
        )}
        {request.status === "rejected" && (
          <button
            onClick={() => setRequest(null)}
            className="text-[10px] tracking-[0.15em] uppercase text-primary hover:underline"
            style={headingFont}
          >
            Apply Again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="border border-border p-6 space-y-4">
      <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
        <BadgeCheck className="h-4 w-4 text-blue-500" />
        Apply for Verification
      </h3>
      <p className="text-xs text-muted-foreground" style={bodyFont}>
        Get the verified badge on your profile. Tell us why you should be verified.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder="Why should you be verified? Share your photography experience..."
        className="w-full bg-transparent border border-border focus:border-primary outline-none p-3 text-sm resize-none transition-colors"
        style={bodyFont}
      />
      <input
        type="url"
        value={portfolioUrl}
        onChange={(e) => setPortfolioUrl(e.target.value)}
        placeholder="Portfolio URL (optional)"
        className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm transition-colors"
        style={bodyFont}
      />
      <button
        onClick={handleSubmit}
        disabled={submitting || !reason.trim()}
        className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
        style={headingFont}
      >
        <Send className="h-3 w-3" />
        {submitting ? "Submitting…" : "Submit Request"}
      </button>
    </div>
  );
};

export default VerificationRequestCard;
