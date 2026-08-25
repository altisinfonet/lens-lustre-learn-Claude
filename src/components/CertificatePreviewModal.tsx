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
import {
  generateCertificatePdf,
  renderCertificateToPng,
  type CertificateType,
} from "@/lib/generateCertificatePdf";
import { saveBlob } from "@/lib/saveFile";
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
  /**
   * ⚠ A PNG, NOT A PDF BLOB URL, AND NOT AN IFRAME.
   *
   * This was `<iframe src={URL.createObjectURL(pdfBlob)}>` and it showed
   * "This content is blocked" to every member who pressed View. Two faults:
   *
   *   1. `public/_headers` sets `frame-src 'self' …` with no `blob:`. A blob
   *      URL is not `'self'` for framing purposes, so the browser refused it.
   *   2. Even allowed, an iframe only renders a PDF where the browser HAS a
   *      PDF viewer. An Android WebView has none. Widening the CSP would have
   *      fixed the desktop symptom and left the app broken.
   *
   * The image comes from the same `drawCertificate` routine the PDF does, so
   * the two cannot disagree, and `img-src` already allowed `blob:`/`data:`.
   */
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const renderSeq = useRef(0);

  /**
   * One input builder for both the on-screen render and the download, so the
   * image a member looks at and the file they save can never differ.
   */
  const pdfInput = (sampleTitle?: string) => ({
    recipientName,
    courseTitle: courseTitle || sampleTitle || "Sample Title",
    issueDate: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    certificateId: "preview-only-not-issued",
    displayCertificateId: "PREVIEW-0000",
    type,
  });

  // Reset to requested type each time the modal opens
  useEffect(() => {
    if (open) setType(initialType);
  }, [open, initialType]);

  // Render whenever the modal is open or the selected type changes.
  useEffect(() => {
    if (!open) return;
    // A slow render for one type must never paint over a newer one.
    const seq = ++renderSeq.current;
    const render = async () => {
      setLoading(true);
      try {
        const entry = CERT_TYPE_CATALOG.find((c) => c.value === type);
        const png = await renderCertificateToPng({
          ...pdfInput(entry?.sampleTitle),
        });
        if (seq !== renderSeq.current) return;
        setImgUrl(png);
      } catch {
        if (seq === renderSeq.current) {
          toast({ title: "Preview failed", description: "Could not render certificate.", variant: "destructive" });
        }
      } finally {
        if (seq === renderSeq.current) setLoading(false);
      }
    };
    void render();
    return () => { renderSeq.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type, recipientName, courseTitle]);

  // Drop the rendered image on close so reopening never flashes the last one.
  useEffect(() => {
    if (!open) setImgUrl(null);
  }, [open]);

  /**
   * The download is still a real PDF — only the on-screen preview is an image.
   *
   * ⚠ `saveBlob`, never an <a download> click. This function used to build an
   * anchor and click it, which an Android WebView swallows in silence: the
   * member taps Download, nothing happens, and nothing reports why. Same class
   * of failure as the blocked iframe — it worked on a desktop and nowhere else.
   */
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const entry = CERT_TYPE_CATALOG.find((c) => c.value === type);
      const doc = await generateCertificatePdf({ ...pdfInput(entry?.sampleTitle) });
      await saveBlob(doc.output("blob"), `Sample-Certificate-${type}.pdf`);
    } catch {
      toast({ title: "Download failed", description: "Could not build the certificate PDF.", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
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

        {/* The certificate itself — an image, so it renders in every browser
            and every WebView. See renderCertificateToPng for why not a PDF. */}
        <div className="flex-1 min-h-0 bg-muted/30 relative overflow-auto p-3 md:p-4">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/60 backdrop-blur-sm">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
          {imgUrl && (
            <img
              src={imgUrl}
              alt="Certificate preview"
              className="w-full h-auto max-h-full object-contain mx-auto shadow-lg rounded-sm"
            />
          )}
        </div>

        {/* Footer actions */}
        <div className="p-3 md:p-4 border-t border-border shrink-0 flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            Type: <code className="font-mono text-foreground">{type}</code>
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void handleDownload()} disabled={!imgUrl || loading || downloading}>
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
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
