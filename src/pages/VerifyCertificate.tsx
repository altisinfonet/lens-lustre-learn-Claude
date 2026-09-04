import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Award, CheckCircle, Search, XCircle, Calendar, Shield, Ban, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isSearchUnavailableError } from "@/pages/verifyCertificateErrors";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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

// Humanize canonical cert.type values for display
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

type SearchMode = "id" | "details";

const VerifyCertificate = () => {
  const [searchParams] = useSearchParams();
  const initialId = searchParams.get("id") || "";

  // Search mode
  const [mode, setMode] = useState<SearchMode>(initialId ? "id" : "details");

  // ID search
  const [certId, setCertId] = useState(initialId);

  // Details search
  const [recipientName, setRecipientName] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [issuedDate, setIssuedDate] = useState("");

  // Results
  const [results, setResults] = useState<VerifiedCert[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // P31: a withdrawn grant is not an empty result. Held separately from
  // notFound so this page can never render a refusal as an absence.
  const [searchUnavailable, setSearchUnavailable] = useState(false);
  // P31 (transport): and a lookup that never completed is neither of those. A
  // dropped connection used to fall through to "No Certificates Found" — the
  // same confident wrong answer about a member's own credential, arriving by a
  // different road. Observed in a real browser, not theorised: the POST reset
  // after 21s and the page said no certificates matched.
  const [lookupFailed, setLookupFailed] = useState(false);

  const handleVerifyById = async () => {
    const trimmed = certId.trim();
    if (!trimmed) return;

    // BUG-078: accept both the internal UUID and the human-facing CERT-xxxx id
    // that users are actually given (verify_certificate now matches either).
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const certIdRegex = /^CERT-[0-9A-Za-z]+$/i;
    if (!uuidRegex.test(trimmed) && !certIdRegex.test(trimmed)) {
      setNotFound(true);
      setResults([]);
      setSearched(true);
      return;
    }

    setLoading(true);
    setNotFound(false);
    setSearchUnavailable(false);
    setLookupFailed(false);
    setResults([]);

    const { data, error } = await supabase.rpc("verify_certificate", { _cert_id: trimmed });

    // P31: the by-ID path carries the same defect the by-name path did, and it
    // is the path the unavailable panel redirects people to. Splitting only the
    // by-name branch would move the bug rather than remove it.
    if (isSearchUnavailableError(error)) {
      setSearchUnavailable(true);
    } else if (error) {
      // Any other error means the check did not complete. It is NOT an empty
      // result and it is NOT a withdrawal — retrying may well succeed — so it
      // gets its own honest state rather than borrowing either message.
      setLookupFailed(true);
    } else if (!data || data.length === 0) {
      setNotFound(true);
    } else {
      setResults(data as VerifiedCert[]);
    }
    setSearched(true);
    setLoading(false);
  };

  const handleSearchByDetails = async () => {
    const name = recipientName.trim() || undefined;
    const title = courseTitle.trim() || undefined;
    const date = issuedDate || undefined;

    if (!name && !title && !date) return;

    setLoading(true);
    setNotFound(false);
    setSearchUnavailable(false);
    setLookupFailed(false);
    setResults([]);

    const { data, error } = await supabase.rpc("search_certificates", {
      _name: name ?? null,
      _course_title: title ?? null,
      _issued_date: date ?? null,
    });

    // P31: the refusal is tested FIRST. The old single condition swallowed it
    // and rendered "No Certificates Found", telling a member holding a REAL
    // certificate that nothing matched. A silent wrong answer is worse than an
    // error. Empty results and unrelated errors keep their existing branch.
    if (isSearchUnavailableError(error)) {
      setSearchUnavailable(true);
    } else if (error) {
      // Any other error means the check did not complete. It is NOT an empty
      // result and it is NOT a withdrawal — retrying may well succeed — so it
      // gets its own honest state rather than borrowing either message.
      setLookupFailed(true);
    } else if (!data || data.length === 0) {
      setNotFound(true);
    } else {
      setResults(data as VerifiedCert[]);
    }
    setSearched(true);
    setLoading(false);
  };

  const handleSubmit = () => {
    if (mode === "id") handleVerifyById();
    else handleSearchByDetails();
  };

  // Auto-verify if ID is in URL params
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialId) {
      handleVerifyById();
    }
  }, []);

  const canSearch =
    mode === "id"
      ? certId.trim().length > 0
      : recipientName.trim().length > 0 || courseTitle.trim().length > 0 || issuedDate.length > 0;

  return (
    <main className="min-h-screen bg-background text-foreground">

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
              Verify <em className="italic text-primary">Certificate</em>
            </h1>
            <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
              Search by certificate ID or by recipient name, course, and date.
            </p>
          </div>

          {/* Mode toggle */}
          <div className="flex justify-center gap-1 mb-8 p-1 border border-border inline-flex mx-auto w-full max-w-sm">
            <button
              onClick={() => { setMode("id"); setSearched(false); setResults([]); setNotFound(false); setSearchUnavailable(false); setLookupFailed(false); }}
              className={`flex-1 text-[10px] tracking-[0.15em] uppercase py-2.5 transition-all duration-300 ${
                mode === "id" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              style={{ fontFamily: "var(--font-heading)" }}
            >
              By Certificate ID
            </button>
            <button
              onClick={() => { setMode("details"); setSearched(false); setResults([]); setNotFound(false); setSearchUnavailable(false); setLookupFailed(false); }}
              className={`flex-1 text-[10px] tracking-[0.15em] uppercase py-2.5 transition-all duration-300 ${
                mode === "details" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              style={{ fontFamily: "var(--font-heading)" }}
            >
              By Name / Course
            </button>
          </div>

          {/* Search forms */}
          <div className="mb-10">
            {mode === "id" ? (
              <div className="flex gap-3">
                <Input
                  value={certId}
                  onChange={(e) => setCertId(e.target.value)}
                  placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890"
                  className="bg-transparent font-mono text-sm"
                  maxLength={36}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                />
                <Button
                  onClick={handleSubmit}
                  disabled={loading || !canSearch}
                  className="shrink-0 bg-primary text-primary-foreground text-xs tracking-[0.1em] uppercase px-6"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  <Search className="h-3.5 w-3.5 mr-1.5" />
                  {loading ? "Checking…" : "Verify"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block" style={{ fontFamily: "var(--font-heading)" }}>
                    Recipient Name
                  </label>
                  <Input
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="e.g. John Doe"
                    className="bg-transparent text-sm"
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  />
                </div>
                <div>
                  <label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block" style={{ fontFamily: "var(--font-heading)" }}>
                    Course / Certificate Title
                  </label>
                  <Input
                    value={courseTitle}
                    onChange={(e) => setCourseTitle(e.target.value)}
                    placeholder="e.g. Photography Masterclass"
                    className="bg-transparent text-sm"
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  />
                </div>
                <div>
                  <label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block" style={{ fontFamily: "var(--font-heading)" }}>
                    Date of Completion
                  </label>
                  <Input
                    type="date"
                    value={issuedDate}
                    onChange={(e) => setIssuedDate(e.target.value)}
                    className="bg-transparent text-sm"
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  />
                </div>
                <Button
                  onClick={handleSubmit}
                  disabled={loading || !canSearch}
                  className="w-full bg-primary text-primary-foreground text-xs tracking-[0.1em] uppercase px-6"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  <Search className="h-3.5 w-3.5 mr-1.5" />
                  {loading ? "Searching…" : "Search Certificates"}
                </Button>
              </div>
            )}
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="space-y-4">
              {results.length > 1 && (
                <p className="text-xs text-muted-foreground mb-2" style={{ fontFamily: "var(--font-body)" }}>
                  Found {results.length} certificate{results.length > 1 ? "s" : ""}
                </p>
              )}
              {results.map((result, idx) => (
                <motion.div
                  key={result.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: idx * 0.1 }}
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
                    <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-body)" }}>
                      <span className="text-muted-foreground">Certificate ID</span>
                      <span className={`font-mono text-[10px] ${result.is_revoked ? "text-destructive" : "text-primary"}`}>{result.certificate_id || result.id}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* Not found */}
          {searched && notFound && !searchUnavailable && !lookupFailed && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="border border-destructive/30 p-8 text-center"
            >
              <XCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
              <p className="text-sm text-foreground mb-1" style={{ fontFamily: "var(--font-heading)" }}>
                No Certificates Found
              </p>
              <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                {mode === "id"
                  ? "The certificate ID you entered does not match any records. Please double-check and try again."
                  : "No certificates match your search criteria. Try adjusting the name, course title, or date."}
              </p>
            </motion.div>
          )}

          {/* P31: search withdrawn — deliberately NOT the destructive style.
              Nothing has gone wrong from the visitor's side, and the certificate
              they hold is not in question. Says what to do instead, and never
              shows the underlying error text. */}
          {/* P31 (transport): the check did not complete. Deliberately NOT the
              withdrawal copy — "no longer available, use the certificate ID" is
              FALSE when the connection dropped, because the search still exists
              and a retry may work. Deliberately NOT the destructive style
              either: nothing is wrong with the member's certificate, and saying
              so plainly is the whole point of this state. */}
          {searched && lookupFailed && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="border border-border p-8 text-center"
            >
              <RefreshCw className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-foreground mb-1" style={{ fontFamily: "var(--font-heading)" }}>
                Verification Could Not Be Completed
              </p>
              <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                We could not reach the verification service. This does not mean the
                certificate is invalid — please check your connection and try again.
              </p>
            </motion.div>
          )}

          {searched && searchUnavailable && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="border border-border p-8 text-center"
            >
              <Ban className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-foreground mb-1" style={{ fontFamily: "var(--font-heading)" }}>
                {mode === "id" ? "Verification Unavailable" : "Search Unavailable"}
              </p>
              <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                {mode === "id"
                  ? "We could not complete this check just now. This does not mean the certificate is invalid — please try again shortly."
                  : "Searching by name or course is no longer available. You can still verify a certificate using its certificate ID."}
              </p>
            </motion.div>
          )}
        </motion.div>
      </div>
    </main>
  );
};

export default VerifyCertificate;
