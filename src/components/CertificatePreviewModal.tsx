import { useEffect, useRef, useState } from "react";
import { Loader2, Download, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { generateCertificatePdf, type CertificateType } from "@/lib/generateCertificatePdf";
import { toast } from "@/hooks/core/use-toast";

/**
 * Canonical cert.type catalogue — mirrors the DB CHECK constraint on
 * public.certificates.type and the TIER_CONFIG map in generateCertificatePdf.ts.
 */
export const CERT_TYPE_CATALOG: { value: CertificateType; label: string; sampleTitle: string }[] = [
  { value: "course_completion", label: "Course Completion", sampleTitle: "Foundations of Photography" },
  { value: "competition_winner", label: "Competition Winner (Legacy)", sampleTitle: "Spring Showcase 2026" },
  { value: "winner", label: "Winner", sampleTitle: "Spring Showcase 2026" },
  { value: "finalist", label: "Finalist", sampleTitle: "Spring Showcase 2026" },
  { value: "participation_r1", label: "Round 1 — Accepted", sampleTitle: "Spring Showcase 2026" },
  { value: "participation_r2", label: "Round 2 — Qualifier", sampleTitle: "Spring Showcase 2026" },
  { value: "participation_r3", label: "Round 3 — Semi-Finalist", sampleTitle: "Spring Showcase 2026" },
  { value: "participation_r4", label: "Round 4 — Final Qualifier", sampleTitle: "Spring Showcase 2026" },
];

interface CertificatePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the modal opens directly to this type with no picker. */
  initialType?: CertificateType;
  /** Optional preview data overrides (recipient name, course title, etc.) */
  recipientName?: string;
  courseTitle?: string;
  /** When true, shows the full type-picker so you can preview every variant. */
  allowTypeSwitch?: boolean;
}

const CertificatePreviewModal = ({
  open,
  onOpenChange,
  initialType = "winner",
  recipientName = "Jane Photographer",
  courseTitle,
  allowTypeSwitch = true,
}: CertificatePreviewModalProps) => {
  const [type, setType] = useState<CertificateType>(initialType);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastUrlRef = useRef<string | null>(null);

  // Reset to requested type each time the modal opens
  useEffect(() => {
    if (open) setType(initialType);
  }, [open, initialType]);

  // Render the PDF whenever modal is open or selected type changes
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const render = async () => {
      setLoading(true);
      try {
        const entry = CERT_TYPE_CATALOG.find((c) => c.value === type);
        const doc = await generateCertificatePdf({
          recipientName,
          courseTitle: courseTitle || entry?.sampleTitle || "Sample Title",
          issueDate: new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          certificateId: "preview-only-not-issued",
          displayCertificateId: "PREVIEW-0000",
          type,
        });
        const blob = doc.output("blob");
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = url;
        setPdfUrl(url);
      } catch (err) {
        if (!cancelled) {
          toast({ title: "Preview failed", description: "Could not render certificate.", variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    render();
    return () => {
      cancelled = true;
    };
  }, [open, type, recipientName, courseTitle]);

  // Cleanup blob URL on unmount / close
  useEffect(() => {
    if (!open && lastUrlRef.current) {
      URL.revokeObjectURL(lastUrlRef.current);
      lastUrlRef.current = null;
      setPdfUrl(null);
    }
  }, [open]);

  const handleDownloadSample = () => {
    if (!pdfUrl) return;
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = `Sample-Certificate-${type}.pdf`;
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 md:p-5 border-b border-border shrink-0">
          <DialogTitle className="text-base md:text-lg font-light tracking-tight">
            Certificate Preview
          </DialogTitle>
          <DialogDescription className="text-xs">
            Preview-only render — sample data, no certificate is issued.
          </DialogDescription>
        </DialogHeader>

        {/* Type switcher */}
        {allowTypeSwitch && (
          <div className="px-4 md:px-5 py-3 border-b border-border shrink-0 overflow-x-auto">
            <div className="flex gap-1.5 min-w-max">
              {CERT_TYPE_CATALOG.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setType(c.value)}
                  className={`text-[10px] md:text-xs tracking-[0.1em] uppercase px-2.5 py-1.5 rounded transition-all ${
                    type === c.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PDF iframe area */}
        <div className="flex-1 min-h-0 bg-muted/30 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/60 backdrop-blur-sm">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
          {pdfUrl && (
            <iframe
              key={pdfUrl}
              src={pdfUrl}
              title="Certificate preview"
              className="w-full h-full border-0"
            />
          )}
        </div>

        {/* Footer actions */}
        <div className="p-3 md:p-4 border-t border-border shrink-0 flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            Type: <code className="font-mono text-foreground">{type}</code>
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleDownloadSample} disabled={!pdfUrl || loading}>
              <Download className="h-3.5 w-3.5" />
              Download Sample
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              <X className="h-3.5 w-3.5" />
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CertificatePreviewModal;
