import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Award, Download, Calendar, Share2, Copy, FileCheck2, Loader2, Eye, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { toast } from "@/hooks/core/use-toast";
import CertificatePreviewModal from "@/components/CertificatePreviewModal";
import type { CertificateType } from "@/lib/generateCertificatePdf";


const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.8, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  }),
};

interface Certificate {
  id: string;
  title: string;
  description: string | null;
  type: string;
  issued_at: string;
  reference_id: string | null;
  file_url: string | null;
  certificate_id: string | null;
  verification_token: string | null;
  is_revoked: boolean;
  revoked_at: string | null;
  revoked_reason: string | null;
}

/**
 * Spec v3 §5 — eligibility per round (revised, tag dependency removed for R2/R3):
 *   R1 → progression_decision='accepted'  AND R1 published
 *   R2 → progression_decision='qualified' AND current_round='2' AND R2 published
 *   R3 → progression_decision='qualified' AND current_round='3' AND R3 published
 *   R4 → any award placement OR Qualified-for-Final tag, AND R4 published
 *
 * Marks remain private in every round (Golden Rule #2). Cert type drives label only.
 */
type CertType = "winner" | "finalist" | "participation_r1" | "participation_r2" | "participation_r3" | "participation_r4";

interface EligibleEntry {
  entry_id: string;
  entry_title: string;
  competition_id: string;
  competition_title: string;
  status: string;
  placement: string | null;
  round: 1 | 2 | 3 | 4;
  cert_type: CertType;
  cert_title: string;
  cert_description: string;
}

const Certificates = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [eligible, setEligible] = useState<EligibleEntry[]>([]);
  const [requesting, setRequesting] = useState<string | null>(null);
  const { data: profileCore } = useProfileCore(user?.id);
  const displayName = profileCore?.full_name || "Photographer";
  const [loading, setLoading] = useState(true);
  // Preview modal state — see CertificatePreviewModal
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewType, setPreviewType] = useState<CertificateType>("winner");
  const [previewTitle, setPreviewTitle] = useState<string | undefined>(undefined);
  const [allowSwitch, setAllowSwitch] = useState(true);

  const openPreview = (type: CertificateType, title?: string, lockType = false) => {
    setPreviewType(type);
    setPreviewTitle(title);
    setAllowSwitch(!lockType);
    setPreviewOpen(true);
  };

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    const fetchCerts = async () => {
      // 1. Existing certificates the user has already requested
      const { data: certs } = await supabase
        .from("certificates")
        .select("*")
        .eq("user_id", user.id)
        .order("issued_at", { ascending: false });
      const existingCerts = certs || [];

      // 2. Eligible entries — show as REQUESTABLE, never auto-create (Spec v3 §5).
      // Per Spec v3 §5 (revised): certificates become request-able after EACH round
      // is admin-Declared. Tag dependency removed for R2/R3. Eligibility map:
      //   R1 → progression_decision='accepted'  (R1 published)
      //   R2 → progression_decision='qualified' AND current_round='2' (R2 published)
      //   R3 → progression_decision='qualified' AND current_round='3' (R3 published)
      //   R4 → any award placement OR Qualified-for-Final tag (R4 published)
      // certificate_ready remains the judge-side completion signal; the publish-gate
      // (competition_round_publish.published_at IS NOT NULL) is what unlocks the UI.
      // BUG-042B: raw progression_decision is no longer client-readable
      // (column revoked). Own certificate-ready entries come from the
      // owner-gated SECURITY DEFINER RPC (publish-gated server-side); the
      // row shape below is mapped to match the old embedded-select exactly.
      const { data: rpcEntries } = await supabase.rpc("get_my_certificate_entries" as any);
      const readyEntries = ((rpcEntries as any[]) ?? []).map((r) => ({
        ...r,
        competitions: { title: r.competition_title },
      }));

      // Build per-round publish map: { competition_id -> Set<round_number> }
      const candidateCompIds = Array.from(
        new Set((readyEntries || []).map((e: any) => e.competition_id))
      );
      const publishedRounds = new Map<string, Set<number>>();
      if (candidateCompIds.length > 0) {
        const { data: pubRows } = await supabase
          .from("competition_round_publish")
          .select("competition_id, round_number, published_at")
          .in("competition_id", candidateCompIds)
          .not("published_at", "is", null);
        for (const r of (pubRows || []) as any[]) {
          if (!publishedRounds.has(r.competition_id)) publishedRounds.set(r.competition_id, new Set());
          publishedRounds.get(r.competition_id)!.add(r.round_number);
        }
      }

      // Dedupe by (reference_id, type) so a single entry can yield multiple per-round
      // certificates (e.g. R1 Accepted AND later R4 Finalist) without one hiding the other.
      const existingRefTypeKeys = new Set(
        existingCerts
          .filter((c) => c.reference_id)
          .map((c) => `${c.reference_id}::${c.type}`)
      );

      // Resolve which round this entry has unlocked a certificate for.
      // Walks high → low so a R4 finalist takes precedence over R3 participation.
      const resolveEligibleRound = (entry: any): { round: 1 | 2 | 3 | 4; certType: CertType } | null => {
        const pub = publishedRounds.get(entry.competition_id) || new Set<number>();
        const decision = entry.progression_decision as string | null;
        // Dual-read: prefer DB-generated current_round_int (Mutation #5), fall back to
        // byte-identical digit-extract on legacy text. Future writes of 'round2'/'r3'
        // resolve correctly via the generated column.
        const currentRoundInt: number | null =
          typeof entry.current_round_int === "number"
            ? entry.current_round_int
            : (() => {
                const m = String(entry.current_round ?? "").replace(/\D/g, "");
                return m ? parseInt(m, 10) : null;
              })();
        const currentRound = currentRoundInt != null ? String(currentRoundInt) : "";

        // R4 — placement award OR finalist
        if (pub.has(4)) {
          if (entry.placement === "winner") return { round: 4, certType: "winner" };
          if (entry.placement === "1st_runner_up" || entry.placement === "2nd_runner_up")
            return { round: 4, certType: "finalist" };
          if (entry.status === "finalist" || entry.status === "shortlisted")
            return { round: 4, certType: "finalist" };
          if (decision === "qualified" && currentRound === "4")
            return { round: 4, certType: "participation_r4" };
        }
        // R3 — qualified for Final
        if (pub.has(3) && decision === "qualified" && currentRound === "3") {
          return { round: 3, certType: "participation_r3" };
        }
        // R2 — qualified for R3
        if (pub.has(2) && decision === "qualified" && currentRound === "2") {
          return { round: 2, certType: "participation_r2" };
        }
        // R1 — accepted. NOTE: complete-round/index.ts:631 writes
        // progression_decision='accept' (NOT 'accepted'). Must match the writer
        // exactly or every R1 participant is silently filtered out (Audit C-1).
        if (pub.has(1) && (decision === "accept" || decision === "accepted")) {
          return { round: 1, certType: "participation_r1" };
        }
        return null;
      };

      const certLabel = (certType: CertType, compTitle: string): { title: string; description: string } => {
        switch (certType) {
          case "winner":
            return { title: `Winner — ${compTitle}`, description: `Winner certificate for ${compTitle}` };
          case "finalist":
            return { title: `Finalist — ${compTitle}`, description: `Finalist certificate for ${compTitle}` };
          case "participation_r4":
            return { title: `Qualified for Final — ${compTitle}`, description: `Final-round qualification for ${compTitle}` };
          case "participation_r3":
            return { title: `Round 3 Qualifier — ${compTitle}`, description: `Round 3 qualification for ${compTitle}` };
          case "participation_r2":
            return { title: `Round 2 Qualifier — ${compTitle}`, description: `Round 2 qualification for ${compTitle}` };
          case "participation_r1":
          default:
            return { title: `Accepted — ${compTitle}`, description: `Round 1 acceptance for ${compTitle}` };
        }
      };

      const eligibleNew: EligibleEntry[] = (readyEntries || [])
        .map((entry: any): EligibleEntry | null => {
          const resolved = resolveEligibleRound(entry);
          if (!resolved) return null;
          // Per-(entry,type) dedupe — see existingRefTypeKeys above.
          if (existingRefTypeKeys.has(`${entry.id}::${resolved.certType}`)) return null;
          const compTitle = entry.competitions?.title || "Competition";
          const { title, description } = certLabel(resolved.certType, compTitle);
          return {
            entry_id: entry.id,
            entry_title: entry.title,
            competition_id: entry.competition_id,
            competition_title: compTitle,
            status: entry.status,
            placement: entry.placement,
            round: resolved.round,
            cert_type: resolved.certType,
            cert_title: title,
            cert_description: description,
          };
        })
        .filter((x): x is EligibleEntry => x !== null);
      setCertificates(existingCerts);
      setEligible(eligibleNew);
      setLoading(false);
    };
    fetchCerts();
  }, [user]);

  const handleRequest = async (e: EligibleEntry) => {
    if (!user || requesting) return;
    setRequesting(e.entry_id);
    try {
      const { data: newCert, error } = await supabase
        .from("certificates")
        .insert({
          user_id: user.id,
          title: e.cert_title,
          type: e.cert_type,
          reference_id: e.entry_id,
          description: e.cert_description,
          // verification_token + certificate_id are generated by the
          // generate_certificate_identifiers BEFORE INSERT trigger.
          // Do NOT supply them client-side — the trigger only fills NULLs,
          // so a client UUID would persist and fragment the token format
          // (Audit C-3).
        })
        .select()
        .single();
      if (error) throw error;
      if (newCert) {
        setCertificates((prev) => [newCert as Certificate, ...prev]);
        setEligible((prev) => prev.filter((x) => x.entry_id !== e.entry_id));
        toast({ title: "Certificate generated", description: "Your certificate is ready to download." });
      }
    } catch {
      toast({ title: "Request failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setRequesting(null);
    }
  };

  if (authLoading || loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">

      <div className="container mx-auto py-4 md:py-20 max-w-4xl">
        <motion.div initial="hidden" animate="visible">
          <motion.div variants={fadeUp} custom={0} className="mb-4 md:mb-12">
            <div className="flex items-center gap-3 mb-1 md:mb-2">
              <div className="w-8 md:w-12 h-px bg-primary" />
              <span className="text-[9px] md:text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
                Achievements
              </span>
            </div>
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <h1 className="text-xl md:text-5xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
                My <em className="italic text-primary">Certificates</em>
              </h1>
              {/* Preview-all entry point — opens modal in gallery mode (every cert.type) */}
              <button
                onClick={() => openPreview("winner", undefined, false)}
                className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-3 py-2 border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300 rounded-md md:rounded-none"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <Eye className="h-3 w-3" />
                Preview All Types
              </button>
            </div>
          </motion.div>

          {/* ── Eligible (request-to-generate) ── SOW C-5 */}
          {eligible.length > 0 && (
            <motion.div variants={fadeUp} custom={1} className="mb-6 md:mb-10">
              <div className="flex items-center gap-2 mb-3">
                <FileCheck2 className="h-3.5 w-3.5 text-emerald-500" />
                <h2 className="text-[10px] md:text-xs tracking-[0.2em] uppercase text-emerald-600 dark:text-emerald-400" style={{ fontFamily: "var(--font-heading)" }}>
                  Available to Request ({eligible.length})
                </h2>
              </div>
              <div className="space-y-3">
                {eligible.map((e, i) => (
                  <motion.div
                    key={e.entry_id}
                    variants={fadeUp}
                    custom={i + 2}
                    className="border border-emerald-500/20 bg-emerald-500/5 rounded-xl md:rounded-none p-3 md:p-5 flex items-center gap-3 md:gap-4"
                  >
                    <div className="shrink-0 w-9 h-9 md:w-11 md:h-11 flex items-center justify-center bg-emerald-500/10 rounded-full ring-1 ring-emerald-500/30">
                      <Award className="h-4 w-4 md:h-5 md:w-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm md:text-base font-light tracking-tight truncate" style={{ fontFamily: "var(--font-display)" }}>
                        {e.cert_title}
                      </h3>
                      <p className="text-[10px] md:text-xs text-muted-foreground truncate" style={{ fontFamily: "var(--font-body)" }}>
                        {e.cert_description}
                      </p>
                    </div>
                    <button
                      onClick={() => openPreview(e.cert_type, e.competition_title, true)}
                      className="shrink-0 inline-flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase px-2.5 py-2 md:py-2.5 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 transition-all rounded-md md:rounded-none"
                      style={{ fontFamily: "var(--font-heading)" }}
                      title="Preview before requesting"
                    >
                      <Eye className="h-3 w-3" />
                      <span className="hidden md:inline">Preview</span>
                    </button>
                    <button
                      onClick={() => handleRequest(e)}
                      disabled={requesting === e.entry_id}
                      className="shrink-0 inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-3 py-2 md:px-4 md:py-2.5 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-wait transition-all duration-300 rounded-md md:rounded-none"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      {requesting === e.entry_id ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Generating
                        </>
                      ) : (
                        <>
                          <FileCheck2 className="h-3 w-3" />
                          Request Certificate
                        </>
                      )}
                    </button>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {certificates.length === 0 && eligible.length === 0 ? (
            <motion.div variants={fadeUp} custom={1} className="border border-border rounded-xl md:rounded-none p-6 md:p-12 text-center">
              <Award className="h-8 w-8 md:h-10 md:w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-2" style={{ fontFamily: "var(--font-body)" }}>
                No certificates yet.
              </p>
              <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                Win competitions or complete courses to earn your first certificate!
              </p>
              <Link
                to="/courses"
                className="inline-block mt-4 text-xs tracking-[0.15em] uppercase px-5 py-3 border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-500 rounded-lg md:rounded-none"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Browse Courses
              </Link>
            </motion.div>
          ) : certificates.length > 0 ? (
            <div className="space-y-4">
              {certificates.map((cert, i) => {
                const certName = cert.title
                  .replace(" — Completion Certificate", "")
                  .replace(" — Winner Certificate", "");
                const shareUrl = cert.verification_token
                  ? `${window.location.origin}/certificate/${cert.verification_token}`
                  : `${window.location.origin}/verify?id=${cert.id}`;

                return (
                  <motion.div
                    key={cert.id}
                    variants={fadeUp}
                    custom={i + 1}
                    className={`group border rounded-xl md:rounded-none backdrop-blur-sm transition-all duration-500 ${
                      cert.is_revoked
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-border/60 bg-card/40 hover:border-primary/40"
                    }`}
                  >
                    {cert.is_revoked && (
                      <div className="px-3 md:px-6 pt-3 md:pt-4 pb-2 flex items-start gap-2 border-b border-destructive/20">
                        <Ban className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[9px] md:text-[10px] tracking-[0.2em] uppercase text-destructive font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                              Revoked
                            </span>
                            {cert.revoked_at && (
                              <span className="text-[9px] md:text-[10px] text-destructive/70" style={{ fontFamily: "var(--font-body)" }}>
                                · {new Date(cert.revoked_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                              </span>
                            )}
                          </div>
                          {cert.revoked_reason && (
                            <p className="text-[10px] md:text-xs text-destructive/80 mt-1 leading-snug" style={{ fontFamily: "var(--font-body)" }}>
                              {cert.revoked_reason}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    <div className={`p-3 md:p-6 ${cert.is_revoked ? "opacity-70" : ""}`}>
                      {/* Top row: icon + title + PDF */}
                      <div className="flex items-center gap-3 md:gap-4 mb-2 md:mb-3">
                        <div className={`shrink-0 w-9 h-9 md:w-11 md:h-11 flex items-center justify-center rounded-full ring-1 ${
                          cert.is_revoked
                            ? "bg-destructive/10 ring-destructive/20"
                            : "bg-primary/10 ring-primary/20"
                        }`}>
                          <Award className={`h-4 w-4 md:h-5 md:w-5 ${cert.is_revoked ? "text-destructive" : "text-primary"}`} />
                        </div>
                        <h3 className={`flex-1 min-w-0 text-sm md:text-lg font-light tracking-tight ${cert.is_revoked ? "line-through decoration-destructive/40" : ""}`} style={{ fontFamily: "var(--font-display)" }}>
                          {certName}
                        </h3>
                        <button
                          onClick={() => openPreview(cert.type as CertificateType, certName, true)}
                          disabled={cert.is_revoked}
                          className="shrink-0 inline-flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase px-2.5 py-1.5 md:px-3 md:py-2 border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-all rounded-md md:rounded-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:border-border"
                          style={{ fontFamily: "var(--font-heading)" }}
                          title={cert.is_revoked ? "This certificate has been revoked" : "Preview certificate"}
                        >
                          <Eye className="h-3 w-3" />
                          <span className="hidden md:inline">Preview</span>
                        </button>
                        <button
                          onClick={async () => {
                            if (cert.is_revoked) return;
                            try {
                              const { generateCertificatePdf } = await import("@/lib/generateCertificatePdf");
                              const doc = await generateCertificatePdf({
                                recipientName: displayName,
                                courseTitle: certName,
                                issueDate: new Date(cert.issued_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
                                certificateId: cert.id,
                                verificationToken: cert.verification_token || undefined,
                                displayCertificateId: cert.certificate_id || undefined,
                                type: cert.type as never,
                              });
                              doc.save(`50mmRetina-Certificate-${(cert.certificate_id || cert.id).slice(0, 12)}.pdf`);
                            } catch {
                              toast({ title: "Download failed", variant: "destructive" });
                            }
                          }}
                          disabled={cert.is_revoked}
                          className="shrink-0 inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-2.5 py-1.5 md:px-3 md:py-2 border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300 rounded-md md:rounded-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-primary"
                          style={{ fontFamily: "var(--font-heading)" }}
                          title={cert.is_revoked ? "Revoked certificates cannot be downloaded" : "Download PDF"}
                        >
                          <Download className="h-3 w-3" />
                          PDF
                        </button>
                      </div>

                      {/* Description */}
                      {cert.description && (
                        <p className="text-[11px] md:text-xs text-muted-foreground mb-2 md:mb-3 ml-12 md:ml-[60px]" style={{ fontFamily: "var(--font-body)" }}>
                          {cert.description}
                        </p>
                      )}

                      {/* Bottom meta row: Date | Cert ID (center) | Share */}
                      <div className="ml-12 md:ml-[60px] flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {new Date(cert.issued_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                        </span>
                        {cert.certificate_id && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(cert.certificate_id!).then(() => {
                                toast({ title: "Copied!", description: "Certificate ID copied." });
                              });
                            }}
                            className={`inline-flex items-center gap-1 font-mono hover:bg-primary/10 transition-colors cursor-pointer text-[9px] md:text-[10px] px-1.5 py-0.5 rounded border ${
                              cert.is_revoked
                                ? "text-destructive border-destructive/30"
                                : "text-primary border-primary/30"
                            }`}
                            title="Click to copy"
                          >
                            {cert.certificate_id}
                            <Copy className="h-2.5 w-2.5 opacity-60" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (cert.is_revoked) {
                              toast({ title: "Cannot share", description: "This certificate has been revoked.", variant: "destructive" });
                              return;
                            }
                            navigator.clipboard.writeText(shareUrl).then(() => {
                              toast({ title: "Link copied!", description: "Verification link copied to clipboard." });
                            }).catch(() => {
                              toast({ title: "Copy failed", variant: "destructive" });
                            });
                          }}
                          disabled={cert.is_revoked}
                          className="inline-flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase text-muted-foreground hover:text-primary transition-colors cursor-pointer p-1.5 md:p-0 rounded-full md:rounded-none hover:bg-primary/10 md:hover:bg-transparent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                          style={{ fontFamily: "var(--font-heading)" }}
                        >
                          <Share2 className="h-3.5 w-3.5 md:h-3 md:w-3" />
                          <span className="hidden md:inline">Share</span>
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ) : null}
        </motion.div>
      </div>
      <CertificatePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        initialType={previewType}
        recipientName={displayName}
        courseTitle={previewTitle}
        allowTypeSwitch={allowSwitch}
      />
    </main>
  );
};

export default Certificates;
