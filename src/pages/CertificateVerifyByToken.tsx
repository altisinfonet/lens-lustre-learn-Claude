import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Award, CheckCircle, XCircle, Calendar, Shield, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import PageSEO from "@/components/PageSEO";

interface VerifiedCert {
  id: string;
  title: string;
  description: string | null;
  type: string;
  issued_at: string;
  recipient_name: string | null;
  certificate_id: string | null;
  verification_token: string | null;
  is_revoked: boolean;
  revoked_at: string | null;
  revoked_reason: string | null;
}

const CERT_TYPE_LABELS: Record<string, string> = {
  course_completion: "Course Completion",
  competition_winner: "Competition Winner",
  winner: "Winner",
  finalist: "Finalist",
  participation_r1: "Round 1 Participation",
  participation_r2: "Round 2 Participation",
  participation_r3: "Round 3 Merit",
  participation_r4: "Round 4 Merit",
};
const formatCertType = (t: string) =>
  CERT_TYPE_LABELS[t] ?? t.replace(/_/g, " ");

const CertificateVerifyByToken = () => {
  const { token } = useParams<{ token: string }>();
  const [result, setResult] = useState<VerifiedCert | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const verify = useCallback(async () => {
    if (!token) { setNotFound(true); setLoading(false); return; }

    const { data, error } = await supabase.rpc("verify_certificate_by_token", { _token: token });

    if (error || !data || (data as any[]).length === 0) {
      setNotFound(true);
    } else {
      setResult((data as VerifiedCert[])[0]);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { verify(); }, [verify]);

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground text-sm">Verifying…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PageSEO
        title={result ? `Certificate: ${result.title}` : "Certificate Verification"}
        description="Verify the authenticity of a 50mm Retina World certificate."
      />

      <div className="container mx-auto py-12 md:py-20 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
          {/* Header */}
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Shield className="h-5 w-5 text-primary" />
              <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
                Verification
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-3" style={{ fontFamily: "var(--font-display)" }}>
              Certificate <em className="italic text-primary">Verification</em>
            </h1>
          </div>

          {/* Certificate found — valid OR revoked */}
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className={`border p-8 md:p-10 ${result.is_revoked ? "border-destructive/40 bg-destructive/5" : "border-primary/30"}`}
            >
              <div className="flex items-center gap-3 mb-6">
                {result.is_revoked ? (
                  <>
                    <Ban className="h-5 w-5 text-destructive" />
                    <span className="text-xs tracking-[0.2em] uppercase text-destructive font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                      Certificate Revoked
                    </span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-5 w-5 text-primary" />
                    <span className="text-xs tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
                      Valid Certificate
                    </span>
                  </>
                )}
              </div>

              {result.is_revoked && result.revoked_reason && (
                <div className="mb-6 p-4 border border-destructive/30 bg-destructive/10 rounded-sm">
                  <p className="text-[10px] tracking-[0.2em] uppercase text-destructive mb-1.5 font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                    Reason for Revocation
                  </p>
                  <p className="text-xs text-foreground/90 leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
                    {result.revoked_reason}
                  </p>
                  {result.revoked_at && (
                    <p className="text-[10px] text-destructive/70 mt-2" style={{ fontFamily: "var(--font-body)" }}>
                      Revoked on {new Date(result.revoked_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-start gap-5 mb-6">
                <div className={`shrink-0 w-14 h-14 flex items-center justify-center rounded-full ${result.is_revoked ? "bg-destructive/10" : "bg-primary/10"}`}>
                  <Award className={`h-6 w-6 ${result.is_revoked ? "text-destructive" : "text-primary"}`} />
                </div>
                <div>
                  <h2 className={`text-xl font-light tracking-tight mb-1 ${result.is_revoked ? "line-through decoration-destructive/40" : ""}`} style={{ fontFamily: "var(--font-display)" }}>
                    {result.title}
                  </h2>
                  {result.description && (
                    <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                      {result.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="border-t border-border pt-5 space-y-3">
                <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-body)" }}>
                  <span className="text-muted-foreground">Recipient</span>
                  <span className="text-foreground">{result.recipient_name || "—"}</span>
                </div>
                {result.certificate_id && (
                  <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-body)" }}>
                    <span className="text-muted-foreground">Certificate ID</span>
                    <span className={`font-mono text-[10px] ${result.is_revoked ? "text-destructive" : "text-primary"}`}>{result.certificate_id}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-body)" }}>
                  <span className="text-muted-foreground">Type</span>
                  <span className={`tracking-[0.15em] uppercase ${result.is_revoked ? "text-destructive" : "text-primary"}`} style={{ fontFamily: "var(--font-heading)" }}>
                    {formatCertType(result.type)}
                  </span>
                </div>
                <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-body)" }}>
                  <span className="text-muted-foreground">Issued</span>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    {new Date(result.issued_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Not found */}
          {notFound && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="border border-destructive/30 p-8 text-center"
            >
              <XCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
              <p className="text-sm text-foreground mb-1" style={{ fontFamily: "var(--font-heading)" }}>
                Certificate Not Found
              </p>
              <p className="text-xs text-muted-foreground mb-4" style={{ fontFamily: "var(--font-body)" }}>
                This verification link is invalid or has expired. Please check the URL.
              </p>
              <Link
                to="/verify"
                className="text-xs tracking-[0.15em] uppercase text-primary hover:underline"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Search Certificates →
              </Link>
            </motion.div>
          )}
        </motion.div>
      </div>
    </main>
  );
};

export default CertificateVerifyByToken;
