/**
 * THE CERTIFICATE, DRAWN TO A CANVAS INSTEAD OF A PDF.
 *
 * ⚠ WHY THIS FILE EXISTS.
 *
 * The member's "View" opened `<iframe src={blobUrl}>` pointing at the
 * generated PDF, and the browser showed:
 *
 *     This content is blocked. Contact the site owner to fix the issue.
 *
 * Two separate faults, and fixing only the first would have left the app
 * broken while looking fixed on a desktop:
 *
 *   1. `public/_headers` sets `frame-src 'self' …` with no `blob:`. A blob URL
 *      does not match `'self'`, so the frame was refused outright. `img-src`
 *      has carried `blob:` and `data:` all along — it was only frames that
 *      never got it.
 *
 *   2. An iframe renders a PDF only in a browser that HAS a PDF viewer. An
 *      Android WebView does not, and neither do several in-app browsers. On
 *      those, allowing the frame produces a blank box or a download prompt
 *      rather than a certificate.
 *
 * So the preview stopped being a PDF. It is now an image, produced by the SAME
 * `drawCertificate` routine that produces the PDF — see `CertificateSurface`
 * in generateCertificatePdf.ts. An <img> renders in every browser and every
 * WebView, and the CSP did not have to be loosened by a single token.
 *
 * ⚠ RECORD-THEN-REPLAY, AND WHY IT IS NOT OVER-ENGINEERING.
 *
 * Every jsPDF call is synchronous; drawing an image to a canvas is not, because
 * the bitmap has to decode first. If the adapter simply awaited each image
 * inline it could not implement a synchronous interface, and if it deferred all
 * images to the end the watermark — drawn FIRST, deliberately, so the text sits
 * on top of it — would be painted OVER the text. Recording every operation in
 * order and replaying it once the images have decoded is what keeps the z-order
 * of the canvas identical to the z-order of the PDF.
 */
import {
  type CertificateSurface,
  CERT_PAGE_W,
  CERT_PAGE_H,
} from "./generateCertificatePdf";

/** jsPDF page units are millimetres; font sizes are points. 1pt = 1/72in. */
const PT_TO_MM = 25.4 / 72;

/** Canvas pixels per millimetre. 4 gives a 1188×840 image — crisp on a phone. */
const PX_PER_MM = 4;

interface DrawState {
  fill: string;
  stroke: string;
  text: string;
  lineWidthMm: number;
  /** CSS font-style/weight prefix, e.g. "italic bold ". */
  fontPrefix: string;
  fontPt: number;
}

type Op =
  | { k: "text"; s: string; x: number; y: number; align: CanvasTextAlign; st: DrawState }
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; st: DrawState }
  | { k: "circle"; x: number; y: number; r: number; style: string; st: DrawState }
  | { k: "rect"; x: number; y: number; w: number; h: number; style: string; st: DrawState }
  | { k: "tri"; pts: number[]; style: string; st: DrawState }
  | { k: "img"; data: string; x: number; y: number; w: number; h: number };

const rgb = (r: number, g: number, b: number) => `rgb(${r|0}, ${g|0}, ${b|0})`;

/**
 * jsPDF's `setFont("times", style)` maps onto the CSS font shorthand, whose
 * order is style → weight → size → family and is not interchangeable.
 */
function fontPrefixFor(style: string): string {
  switch ((style || "normal").toLowerCase()) {
    case "bold": return "bold ";
    case "italic": return "italic ";
    case "bolditalic":
    case "italicbold": return "italic bold ";
    default: return "";
  }
}

const FAMILY = `"Times New Roman", Times, serif`;

function loadBitmap(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * A recording surface plus the replay that paints it.
 *
 * The measuring context runs at 1px = 1mm, so `measureText` returns
 * millimetres directly and `getTextWidth` needs no conversion — the same unit
 * jsPDF reports, which is what the date underline is sized from.
 */
export function createCanvasSurface() {
  const ops: Op[] = [];

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("Canvas 2D is unavailable in this browser.");

  const st: DrawState = {
    fill: "rgb(0, 0, 0)",
    stroke: "rgb(0, 0, 0)",
    text: "rgb(0, 0, 0)",
    lineWidthMm: 0.2,
    fontPrefix: "",
    fontPt: 12,
  };
  const snap = (): DrawState => ({ ...st });
  const applyMeasureFont = () => {
    measure.font = `${st.fontPrefix}${st.fontPt * PT_TO_MM}px ${FAMILY}`;
  };

  const surface: CertificateSurface = {
    setFillColor: (r, g, b) => { st.fill = rgb(r, g, b); },
    setDrawColor: (r, g, b) => { st.stroke = rgb(r, g, b); },
    setTextColor: (r, g, b) => { st.text = rgb(r, g, b); },
    setLineWidth: (mm) => { st.lineWidthMm = mm; },
    setFont: (_family, style) => { st.fontPrefix = fontPrefixFor(style); },
    setFontSize: (pt) => { st.fontPt = pt; },

    text: (s, x, y, opts) => {
      const align = (opts?.align === "center" ? "center" : opts?.align === "right" ? "right" : "left") as CanvasTextAlign;
      ops.push({ k: "text", s: String(s), x, y, align, st: snap() });
    },
    line: (x1, y1, x2, y2) => { ops.push({ k: "line", x1, y1, x2, y2, st: snap() }); },
    circle: (x, y, r, style = "S") => { ops.push({ k: "circle", x, y, r, style, st: snap() }); },
    rect: (x, y, w, h, style = "S") => { ops.push({ k: "rect", x, y, w, h, style, st: snap() }); },
    triangle: (x1, y1, x2, y2, x3, y3, style = "S") => {
      ops.push({ k: "tri", pts: [x1, y1, x2, y2, x3, y3], style, st: snap() });
    },
    addImage: (data, _format, x, y, w, h) => { ops.push({ k: "img", data, x, y, w, h }); },

    getTextWidth: (t) => { applyMeasureFont(); return measure.measureText(String(t)).width; },

    splitTextToSize: (t, maxWidth) => {
      applyMeasureFont();
      const words = String(t).split(/\s+/).filter(Boolean);
      if (words.length === 0) return [""];
      const out: string[] = [];
      let line = words[0];
      for (let i = 1; i < words.length; i++) {
        const next = `${line} ${words[i]}`;
        if (measure.measureText(next).width <= maxWidth) line = next;
        else { out.push(line); line = words[i]; }
      }
      out.push(line);
      return out;
    },
  };

  /** Paint everything that was recorded, in order, and return a PNG data URL. */
  async function toPngDataUrl(): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(CERT_PAGE_W * PX_PER_MM);
    canvas.height = Math.round(CERT_PAGE_H * PX_PER_MM);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is unavailable in this browser.");

    const S = PX_PER_MM;
    ctx.textBaseline = "alphabetic"; // jsPDF's y is the baseline, same as this

    for (const op of ops) {
      if (op.k === "img") {
        // A missing logo or signature must not cost the member their preview.
        try {
          const bmp = await loadBitmap(op.data);
          ctx.drawImage(bmp, op.x * S, op.y * S, op.w * S, op.h * S);
        } catch { /* asset unavailable — the PDF tolerates this too */ }
        continue;
      }

      ctx.fillStyle = op.st.fill;
      ctx.strokeStyle = op.st.stroke;
      ctx.lineWidth = Math.max(op.st.lineWidthMm * S, 0.5);

      if (op.k === "text") {
        ctx.fillStyle = op.st.text;
        ctx.font = `${op.st.fontPrefix}${op.st.fontPt * PT_TO_MM * S}px ${FAMILY}`;
        ctx.textAlign = op.align;
        ctx.fillText(op.s, op.x * S, op.y * S);
        continue;
      }
      if (op.k === "line") {
        ctx.beginPath();
        ctx.moveTo(op.x1 * S, op.y1 * S);
        ctx.lineTo(op.x2 * S, op.y2 * S);
        ctx.stroke();
        continue;
      }
      if (op.k === "circle") {
        ctx.beginPath();
        ctx.arc(op.x * S, op.y * S, op.r * S, 0, Math.PI * 2);
        paint(ctx, op.style);
        continue;
      }
      if (op.k === "rect") {
        ctx.beginPath();
        ctx.rect(op.x * S, op.y * S, op.w * S, op.h * S);
        paint(ctx, op.style);
        continue;
      }
      // triangle
      ctx.beginPath();
      ctx.moveTo(op.pts[0] * S, op.pts[1] * S);
      ctx.lineTo(op.pts[2] * S, op.pts[3] * S);
      ctx.lineTo(op.pts[4] * S, op.pts[5] * S);
      ctx.closePath();
      paint(ctx, op.style);
    }

    return canvas.toDataURL("image/png");
  }

  return { surface, toPngDataUrl };
}

/**
 * jsPDF style codes, and jsPDF's default when the argument is omitted is a
 * stroke — which is what `doc.rect(margin, ...)` relies on for the gold border.
 *   "F"        fill only
 *   "S"        stroke only  (the default)
 *   "FD"/"DF"  both
 */
function paint(ctx: CanvasRenderingContext2D, style: string) {
  const s = (style || "S").toUpperCase();
  const both = s === "FD" || s === "DF";
  if (both || s === "F") ctx.fill();
  if (both || s === "S") ctx.stroke();
}
