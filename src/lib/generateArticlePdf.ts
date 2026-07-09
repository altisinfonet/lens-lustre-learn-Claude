// =====================================================================
// NATIVE MAGAZINE PDF COMPOSER (Option A)
// ---------------------------------------------------------------------
// Draws a real editorial magazine from ARTICLE DATA, not from the live
// webpage. Pages emitted (each a real, dedicated A4 page):
//
//   1. Front Cover        — full-bleed cover image + masthead + title
//   2. Title / Lede       — title, subtitle, byline, dateline, lede
//   3. Body pages         — two-column justified text with drop cap,
//                           inline images with captions, pull quotes,
//                           running header/footer + folios
//   4. Artist Spotlight   — portrait + bio (only if author bio present)
//   5. Photo Gallery      — 2×3 contact-sheet grid (only if gallery)
//   6. Back Cover         — logo, tagline, URL, © line
//
// Vector text (selectable, crisp at any zoom). Images inlined + downscaled
// to ≤1600 px JPEG before addImage. jsPDF built-in fonts only (times +
// helvetica) so no font-embedding surprises.
// =====================================================================
import jsPDF from "jspdf";
import { loadPdfLogo } from "@/lib/pdfLogo";

// ------- Article shape the composer needs -----------------------------
export interface ArticleForPdf {
  title: string;
  subtitle?: string | null;
  body: string;                    // HTML
  coverImageUrl?: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  authorBio?: string | null;
  publishedAt?: string | null;
  tags?: string[] | null;
  gallery?: string[] | null;
  sectionLabel?: string | null;    // "FEATURED ARTIST" | "JOURNAL"
}

interface GenerateArgs {
  title: string;
  article: ArticleForPdf;
  // legacy — accepted but ignored (kept for older call sites)
  rootEl?: HTMLElement | null;
}

const BRAND = "50MM RETINA WORLD";
const BRAND_URL = "50mmretina.com";

// A4 in mm
const A4_W = 210;
const A4_H = 297;
const MARGIN_TOP = 20;
const MARGIN_BOTTOM = 22;
const MARGIN_SIDE = 18;
const HEADER_H = 8;
const FOOTER_H = 8;
const CONTENT_TOP = MARGIN_TOP + HEADER_H;
const CONTENT_BOTTOM = A4_H - MARGIN_BOTTOM - FOOTER_H;
const CONTENT_W = A4_W - 2 * MARGIN_SIDE;
const CONTENT_H = CONTENT_BOTTOM - CONTENT_TOP;

// Single-column body — strict text→image→text order preservation
// Images clamped to <=50% of content height so following text stays on same page
const MAX_IMG_H_RATIO = 0.4;

// Palette (warm editorial)
const INK = { r: 26, g: 26, b: 26 };
const MUTED = { r: 110, g: 110, b: 110 };
const GOLD = { r: 154, g: 132, b: 83 };
const PAPER = { r: 253, g: 252, b: 248 };
const HAIRLINE = { r: 217, g: 209, b: 189 };

const MAX_IMG_W = 1600;
const FETCH_TIMEOUT_MS = 8000;

// =====================================================================
// Image fetch + downscale
// =====================================================================
async function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = src;
  });
}

async function fetchImageAsJpegDataUrl(
  url: string,
): Promise<{ dataUrl: string; w: number; h: number } | null> {
  if (!url) return null;

  let img: HTMLImageElement | null = null;
  let objectUrlToRevoke: string | null = null;

  // Try fetch → blob → Image (works when CORS headers are present)
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      cache: "reload", // bypass Chrome's tainted non-CORS cache entry
      signal: controller.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      objectUrlToRevoke = objectUrl;
      img = await new Promise<HTMLImageElement | null>((resolve) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => resolve(null);
        el.src = objectUrl;
      });
    }
  } catch {
    /* fall through */
  }

  // Fallback: <img crossOrigin="anonymous"> with cache-buster (Chrome-safe)
  if (!img) {
    const buster = url.includes("?") ? `${url}&_pdfcors=1` : `${url}?_pdfcors=1`;
    img = await loadImageElement(buster);
  }

  if (!img) {
    if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke);
    return null;
  }

  try {
    const scale =
      img.naturalWidth > MAX_IMG_W ? MAX_IMG_W / img.naturalWidth : 1;
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.88), w, h };
  } catch {
    return null;
  } finally {
    if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke);
  }
}

// =====================================================================
// HTML body → typed block stream
// =====================================================================
type Block =
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "img"; src: string; caption?: string };

function collectText(node: Node): string {
  return (node.textContent || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeBodyHtml(raw: string): string {
  const withLegacyImages = (raw || "").replace(
    /\[img:([^\]]+)\]/gi,
    (_m, url) => `<figure><img src="${escapeHtml(String(url).trim())}" alt="Article image" /></figure>`,
  );

  if (/<[a-z][\s\S]*>/i.test(withLegacyImages)) return withLegacyImages;

  return withLegacyImages
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part)}</p>`)
    .join("\n");
}

function firstSrcFromSrcset(value: string | null): string {
  if (!value) return "";
  return value.split(",")[0]?.trim().split(/\s+/)[0] || "";
}

function extractImageSource(el: Element): string {
  const direct =
    el.getAttribute("src") ||
    el.getAttribute("data-src") ||
    el.getAttribute("data-original") ||
    el.getAttribute("data-url") ||
    firstSrcFromSrcset(el.getAttribute("srcset")) ||
    firstSrcFromSrcset(el.getAttribute("data-srcset"));

  if (direct) return direct.trim();

  const source = el.closest("picture")?.querySelector("source[srcset], source[data-srcset]");
  return source
    ? (
        firstSrcFromSrcset(source.getAttribute("srcset")) ||
        firstSrcFromSrcset(source.getAttribute("data-srcset"))
      ).trim()
    : "";
}

function pushImageBlock(out: Block[], img: Element, caption?: string) {
  const src = extractImageSource(img);
  if (!src) return;
  out.push({
    kind: "img",
    src,
    caption: caption || img.getAttribute("alt") || undefined,
  });
}

function pushParagraphWithInlineImages(out: Block[], el: Element) {
  let textBuffer = "";
  const flushText = () => {
    const text = textBuffer.replace(/\s+/g, " ").trim();
    if (text) out.push({ kind: "p", text });
    textBuffer = "";
  };

  const walkNodes = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      textBuffer += ` ${node.textContent || ""}`;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const child = node as Element;
    const tag = child.tagName.toLowerCase();
    if (tag === "img") {
      flushText();
      pushImageBlock(out, child);
      return;
    }
    if (tag === "br") {
      textBuffer += " ";
      return;
    }
    for (const nested of Array.from(child.childNodes)) walkNodes(nested);
  };

  for (const child of Array.from(el.childNodes)) walkNodes(child);
  flushText();
}

function parseBodyHtml(html: string): Block[] {
  const doc = new DOMParser().parseFromString(
    `<div id="root">${normalizeBodyHtml(html)}</div>`,
    "text/html",
  );
  const root = doc.getElementById("root");
  if (!root) return [];
  const out: Block[] = [];
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === "h1" || tag === "h2") {
        const t = collectText(child);
        if (t) out.push({ kind: "h2", text: t });
      } else if (tag === "h3" || tag === "h4") {
        const t = collectText(child);
        if (t) out.push({ kind: "h3", text: t });
      } else if (tag === "blockquote") {
        const t = collectText(child);
        if (t) out.push({ kind: "quote", text: t });
      } else if (tag === "figure") {
        const img = child.querySelector("img");
        const cap = child.querySelector("figcaption");
        if (img) pushImageBlock(out, img, cap ? collectText(cap) : undefined);
      } else if (tag === "picture") {
        const img = child.querySelector("img") || child;
        pushImageBlock(out, img);
      } else if (tag === "img") {
        pushImageBlock(out, child);
      } else if (tag === "p") {
        pushParagraphWithInlineImages(out, child);
      } else if (tag === "ul" || tag === "ol") {
        for (const li of Array.from(child.querySelectorAll("li"))) {
          const t = collectText(li);
          if (t) out.push({ kind: "p", text: `•  ${t}` });
        }
      } else if (tag === "div" || tag === "section" || tag === "article") {
        walk(child);
      } else {
        const t = collectText(child);
        if (t) out.push({ kind: "p", text: t });
      }
    }
  };
  walk(root);
  return out;
}

// =====================================================================
// Layout state + drawing helpers
// =====================================================================
interface Layout {
  pdf: jsPDF;
  pageNum: number;
  totalPages: number; // set after pagination
  logo: { dataUrl: string; width: number; height: number } | null;
  runningHeader: string;
  // body flow state (single column)
  y: number;
}

function setFill(pdf: jsPDF, c: { r: number; g: number; b: number }) {
  pdf.setFillColor(c.r, c.g, c.b);
}
function setDraw(pdf: jsPDF, c: { r: number; g: number; b: number }) {
  pdf.setDrawColor(c.r, c.g, c.b);
}
function setText(pdf: jsPDF, c: { r: number; g: number; b: number }) {
  pdf.setTextColor(c.r, c.g, c.b);
}

function paintPaper(pdf: jsPDF) {
  setFill(pdf, PAPER);
  pdf.rect(0, 0, A4_W, A4_H, "F");
}

function drawRunningHeader(l: Layout) {
  const { pdf } = l;
  // hairline
  setDraw(pdf, HAIRLINE);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN_SIDE, MARGIN_TOP + HEADER_H - 3, A4_W - MARGIN_SIDE, MARGIN_TOP + HEADER_H - 3);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);
  setText(pdf, GOLD);
  pdf.text(BRAND, MARGIN_SIDE, MARGIN_TOP + 2);
  pdf.setFont("helvetica", "normal");
  setText(pdf, MUTED);
  pdf.text(l.runningHeader.toUpperCase(), A4_W - MARGIN_SIDE, MARGIN_TOP + 2, {
    align: "right",
  });
}

function drawRunningFooter(l: Layout) {
  const { pdf } = l;
  const y = A4_H - MARGIN_BOTTOM - FOOTER_H + 5;
  setDraw(pdf, HAIRLINE);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN_SIDE, y - 3, A4_W - MARGIN_SIDE, y - 3);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  setText(pdf, MUTED);
  pdf.text(BRAND_URL, MARGIN_SIDE, y);
  pdf.text(String(l.pageNum), A4_W - MARGIN_SIDE, y, { align: "right" });
}

function newBodyPage(l: Layout) {
  l.pdf.addPage("a4", "portrait");
  l.pageNum += 1;
  paintPaper(l.pdf);
  drawRunningHeader(l);
  drawRunningFooter(l);
  l.y = CONTENT_TOP;
}

function ensureSpace(l: Layout, needed: number) {
  if (l.y + needed > CONTENT_BOTTOM) {
    newBodyPage(l);
  }
}

// Draw a paragraph full-width with optional drop cap on first paragraph
function drawParagraph(l: Layout, text: string, opts: { dropCap?: boolean } = {}) {
  const { pdf } = l;
  pdf.setFont("times", "normal");
  pdf.setFontSize(11);
  setText(pdf, INK);
  const lineH = 5.2;

  if (opts.dropCap && text.length > 2) {
    const first = text.charAt(0);
    const rest = text.slice(1);
    ensureSpace(l, lineH * 3);
    pdf.setFont("times", "bold");
    pdf.setFontSize(38);
    setText(pdf, GOLD);
    pdf.text(first, MARGIN_SIDE, l.y + 10);
    pdf.setFont("times", "normal");
    pdf.setFontSize(11);
    setText(pdf, INK);

    const capW = 10;
    const indentedW = CONTENT_W - capW;
    // Render full paragraph wrapped to indented width; first 3 lines get indent,
    // remaining lines use full width.
    const indentedLines = pdf.splitTextToSize(rest, indentedW) as string[];
    const firstThree = indentedLines.slice(0, 3);
    firstThree.forEach((line, i) => {
      pdf.text(line, MARGIN_SIDE + capW, l.y + (i + 1) * lineH);
    });
    l.y += 3 * lineH;

    if (indentedLines.length > 3) {
      // Character offset consumed by first 3 indented lines (approximate; safer
      // than word-join because splitTextToSize preserves whitespace boundaries)
      const consumed = firstThree.join(" ").length + 1;
      const remainder = rest.slice(consumed).trim();
      if (remainder) {
        const wrapped = pdf.splitTextToSize(remainder, CONTENT_W) as string[];
        for (const line of wrapped) {
          ensureSpace(l, lineH);
          pdf.text(line, MARGIN_SIDE, l.y + lineH * 0.7);
          l.y += lineH;
        }
      }
    }
  } else {
    const wrapped = pdf.splitTextToSize(text, CONTENT_W) as string[];
    for (const line of wrapped) {
      ensureSpace(l, lineH);
      pdf.text(line, MARGIN_SIDE, l.y + lineH * 0.7);
      l.y += lineH;
    }
  }
  l.y += 3; // paragraph spacing
}

function drawHeading(l: Layout, text: string, level: "h2" | "h3") {
  const { pdf } = l;
  const size = level === "h2" ? 17 : 13;
  const lineH = size * 0.45;
  ensureSpace(l, lineH * 2 + 4);
  l.y += 4;
  pdf.setFont("times", "bold");
  pdf.setFontSize(size);
  setText(pdf, INK);
  const wrapped = pdf.splitTextToSize(text, CONTENT_W) as string[];
  for (const line of wrapped) {
    ensureSpace(l, lineH);
    pdf.text(line, MARGIN_SIDE, l.y + lineH * 0.75);
    l.y += lineH;
  }
  l.y += 3;
}

function drawPullQuote(l: Layout, text: string) {
  const { pdf } = l;
  pdf.setFont("times", "italic");
  pdf.setFontSize(15);
  setText(pdf, GOLD);
  const lineH = 7;
  const wrapped = pdf.splitTextToSize(`"${text}"`, CONTENT_W - 8) as string[];
  ensureSpace(l, lineH * wrapped.length + 8);
  setDraw(pdf, GOLD);
  pdf.setLineWidth(0.6);
  const startY = l.y + 2;
  const endY = startY + wrapped.length * lineH;
  pdf.line(MARGIN_SIDE, startY, MARGIN_SIDE, endY);
  for (const line of wrapped) {
    pdf.text(line, MARGIN_SIDE + 5, l.y + lineH * 0.8);
    l.y += lineH;
  }
  l.y += 5;
}

async function drawInlineImage(l: Layout, src: string, caption?: string, authorName?: string | null) {
  const img = await fetchImageAsJpegDataUrl(src);
  if (!img) return;

  // Fit within CONTENT_W and <=50% of content height, preserving aspect
  const maxH = CONTENT_H * MAX_IMG_H_RATIO;
  let targetW = CONTENT_W;
  let targetH = (img.h / img.w) * targetW;
  if (targetH > maxH) {
    targetH = maxH;
    targetW = (img.w / img.h) * targetH;
  }
  const drawX = MARGIN_SIDE + (CONTENT_W - targetW) / 2;

  const credit = authorName ? `Image by ${authorName}` : null;
  const fullCaption = caption
    ? (credit ? `${caption} — ${credit}` : caption)
    : credit;

  const captionH = fullCaption ? 6 : 0;
  const totalH = targetH + captionH + 4;

  // If image doesn't fit in remaining page space, start new page BEFORE it
  // so it stays adjacent to following text.
  if (l.y + totalH > CONTENT_BOTTOM) {
    newBodyPage(l);
  }

  l.y += 2;
  l.pdf.addImage(img.dataUrl, "JPEG", drawX, l.y, targetW, targetH);
  l.y += targetH + 2;
  if (fullCaption) {
    l.pdf.setFont("helvetica", "italic");
    l.pdf.setFontSize(8);
    setText(l.pdf, MUTED);
    const wrapped = l.pdf.splitTextToSize(fullCaption, CONTENT_W) as string[];
    for (const line of wrapped) {
      ensureSpace(l, 4);
      l.pdf.text(line, MARGIN_SIDE, l.y + 3);
      l.y += 4;
    }
  }
  l.y += 4;
}

// =====================================================================
// Page templates
// =====================================================================
async function drawCoverPage(l: Layout, article: ArticleForPdf) {
  const { pdf } = l;
  paintPaper(pdf);

  // Full-bleed cover image
  if (article.coverImageUrl) {
    const img = await fetchImageAsJpegDataUrl(article.coverImageUrl);
    if (img) {
      // Cover area: top ~65% of page, full width
      const coverH = A4_H * 0.62;
      // Cover w/h scaled to fill (crop-fit)
      const scale = Math.max(A4_W / img.w, coverH / img.h);
      const drawW = img.w * scale;
      const drawH = img.h * scale;
      const drawX = (A4_W - drawW) / 2;
      pdf.addImage(img.dataUrl, "JPEG", drawX, 0, drawW, drawH);
      // Dark overlay bottom for legibility of any overlay text (top overlay left blank here)
    } else {
      // Gradient-ish fallback
      setFill(pdf, { r: 32, g: 32, b: 36 });
      pdf.rect(0, 0, A4_W, A4_H * 0.62, "F");
    }
  } else {
    setFill(pdf, { r: 32, g: 32, b: 36 });
    pdf.rect(0, 0, A4_W, A4_H * 0.62, "F");
  }

  // Masthead top-left over cover — white
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  setText(pdf, { r: 255, g: 255, b: 255 });
  pdf.text(BRAND, MARGIN_SIDE, 14);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.text((article.sectionLabel || "FEATURED").toUpperCase(), MARGIN_SIDE, 19);

  // Issue / date top-right
  const dateStr = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(dateStr.toUpperCase(), A4_W - MARGIN_SIDE, 14, { align: "right" });

  // Bottom block on paper (below cover image)
  const blockTop = A4_H * 0.64;
  setFill(pdf, PAPER);
  pdf.rect(0, blockTop, A4_W, A4_H - blockTop, "F");

  // Hairline separator
  setDraw(pdf, GOLD);
  pdf.setLineWidth(0.4);
  pdf.line(MARGIN_SIDE, blockTop + 8, MARGIN_SIDE + 20, blockTop + 8);

  // Section kicker
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  setText(pdf, GOLD);
  pdf.text(
    (article.sectionLabel || "FEATURED ARTIST").toUpperCase(),
    MARGIN_SIDE,
    blockTop + 15,
  );

  // Title
  pdf.setFont("times", "bold");
  pdf.setFontSize(30);
  setText(pdf, INK);
  const titleWrapped = pdf.splitTextToSize(article.title, A4_W - 2 * MARGIN_SIDE) as string[];
  let ty = blockTop + 26;
  for (const line of titleWrapped.slice(0, 3)) {
    pdf.text(line, MARGIN_SIDE, ty);
    ty += 11;
  }

  // Subtitle
  if (article.subtitle) {
    pdf.setFont("times", "italic");
    pdf.setFontSize(12);
    setText(pdf, MUTED);
    const subWrapped = pdf.splitTextToSize(article.subtitle, A4_W - 2 * MARGIN_SIDE) as string[];
    for (const line of subWrapped.slice(0, 2)) {
      pdf.text(line, MARGIN_SIDE, ty + 2);
      ty += 6;
    }
  }

  // Byline bottom
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  setText(pdf, INK);
  const bylineY = A4_H - 18;
  const byline = article.authorName
    ? `A portfolio by ${article.authorName}`
    : "";
  if (byline) pdf.text(byline, MARGIN_SIDE, bylineY);

  // Logo bottom-right
  if (l.logo) {
    const targetH = 10;
    const targetW = (l.logo.width / l.logo.height) * targetH;
    pdf.addImage(
      l.logo.dataUrl,
      "PNG",
      A4_W - MARGIN_SIDE - targetW,
      bylineY - 7,
      targetW,
      targetH,
    );
  }
}

function drawTitleLedePage(l: Layout, article: ArticleForPdf, lede: string) {
  newBodyPageForContent(l);
  const { pdf } = l;

  // Section eyebrow
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  setText(pdf, GOLD);
  pdf.text(
    (article.sectionLabel || "FEATURED ARTIST").toUpperCase(),
    MARGIN_SIDE,
    CONTENT_TOP + 4,
  );

  // Title — large, serif
  pdf.setFont("times", "bold");
  pdf.setFontSize(28);
  setText(pdf, INK);
  const wrapped = pdf.splitTextToSize(article.title, CONTENT_W) as string[];
  let y = CONTENT_TOP + 16;
  for (const line of wrapped) {
    pdf.text(line, MARGIN_SIDE, y);
    y += 11;
  }

  // Subtitle
  if (article.subtitle) {
    pdf.setFont("times", "italic");
    pdf.setFontSize(13);
    setText(pdf, MUTED);
    const sub = pdf.splitTextToSize(article.subtitle, CONTENT_W) as string[];
    for (const line of sub) {
      pdf.text(line, MARGIN_SIDE, y + 2);
      y += 7;
    }
  }

  y += 4;
  // Byline row
  setDraw(pdf, HAIRLINE);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN_SIDE, y, A4_W - MARGIN_SIDE, y);
  y += 6;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.5);
  setText(pdf, INK);
  if (article.authorName) pdf.text(`BY ${article.authorName.toUpperCase()}`, MARGIN_SIDE, y);

  pdf.setFont("helvetica", "normal");
  setText(pdf, MUTED);
  const dateStr = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";
  if (dateStr) pdf.text(dateStr.toUpperCase(), A4_W - MARGIN_SIDE, y, { align: "right" });
  y += 8;

  // Lede paragraph
  if (lede) {
    pdf.setFont("times", "italic");
    pdf.setFontSize(13);
    setText(pdf, INK);
    const lineH = 6.5;
    const ledeLines = pdf.splitTextToSize(lede, CONTENT_W) as string[];
    for (const line of ledeLines) {
      pdf.text(line, MARGIN_SIDE, y + lineH * 0.75);
      y += lineH;
    }
    y += 4;
  }

  // Prep for body flow to continue below on the SAME page? Simpler:
  // start body on a fresh page so the title has editorial space.
}

function newBodyPageForContent(l: Layout) {
  // Not a fresh addPage the first time (cover was the first page).
  // Cover was page 1 → this creates page 2.
  l.pdf.addPage("a4", "portrait");
  l.pageNum += 1;
  paintPaper(l.pdf);
  drawRunningHeader(l);
  drawRunningFooter(l);
  l.y = CONTENT_TOP;
}

async function drawSpotlightPage(l: Layout, article: ArticleForPdf) {
  newBodyPage(l);
  const { pdf } = l;

  // Eyebrow
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  setText(pdf, GOLD);
  pdf.text("ARTIST SPOTLIGHT", MARGIN_SIDE, CONTENT_TOP + 4);

  // Title
  pdf.setFont("times", "bold");
  pdf.setFontSize(22);
  setText(pdf, INK);
  pdf.text(article.authorName || "The Artist", MARGIN_SIDE, CONTENT_TOP + 18);

  let y = CONTENT_TOP + 24;
  // hairline
  setDraw(pdf, HAIRLINE);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN_SIDE, y, A4_W - MARGIN_SIDE, y);
  y += 8;

  // Portrait left, bio right
  const portraitW = 55;
  const portraitH = 55;
  if (article.authorAvatarUrl) {
    const img = await fetchImageAsJpegDataUrl(article.authorAvatarUrl);
    if (img) {
      pdf.addImage(img.dataUrl, "JPEG", MARGIN_SIDE, y, portraitW, portraitH);
    }
  }

  const bioX = MARGIN_SIDE + portraitW + 8;
  const bioW = CONTENT_W - portraitW - 8;

  pdf.setFont("times", "italic");
  pdf.setFontSize(11);
  setText(pdf, INK);
  const bio = article.authorBio || "";
  const bioLines = pdf.splitTextToSize(bio, bioW) as string[];
  const lineH = 5.2;
  bioLines.forEach((line, i) => {
    pdf.text(line, bioX, y + 4 + i * lineH);
  });
}

async function drawGalleryPage(l: Layout, gallery: string[]) {
  newBodyPage(l);
  const { pdf } = l;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  setText(pdf, GOLD);
  pdf.text("PHOTO GALLERY", MARGIN_SIDE, CONTENT_TOP + 4);

  pdf.setFont("times", "bold");
  pdf.setFontSize(22);
  setText(pdf, INK);
  pdf.text("Selected Works", MARGIN_SIDE, CONTENT_TOP + 18);

  const startY = CONTENT_TOP + 26;
  const cols = 2;
  const rows = 3;
  const gap = 4;
  const cellW = (CONTENT_W - gap * (cols - 1)) / cols;
  const cellH = (CONTENT_BOTTOM - startY - gap * (rows - 1)) / rows;

  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (idx >= gallery.length) return;
      const src = gallery[idx++];
      const x = MARGIN_SIDE + c * (cellW + gap);
      const y = startY + r * (cellH + gap);
      const img = await fetchImageAsJpegDataUrl(src);
      if (img) {
        // Fit-cover into cell
        const scale = Math.max(cellW / img.w, cellH / img.h);
        const drawW = img.w * scale;
        const drawH = img.h * scale;
        // Clip by drawing to an offscreen canvas already sized to cell? Easier:
        // just add scaled full image and let jsPDF clip via rectangle — jsPDF
        // doesn't clip, so instead we downscale to exact cell in a canvas.
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(cellW * 4); // ~4px/mm
        canvas.height = Math.round(cellH * 4);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const im = new Image();
          im.src = img.dataUrl;
          await new Promise<void>((res) => {
            im.onload = () => res();
            im.onerror = () => res();
          });
          const sScale = Math.max(canvas.width / img.w, canvas.height / img.h);
          const sw = img.w * sScale;
          const sh = img.h * sScale;
          const sx = (canvas.width - sw) / 2;
          const sy = (canvas.height - sh) / 2;
          ctx.fillStyle = "#f0f0f0";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(im, sx, sy, sw, sh);
          const clipped = canvas.toDataURL("image/jpeg", 0.86);
          pdf.addImage(clipped, "JPEG", x, y, cellW, cellH);
        } else {
          // Fallback: draw uncropped (may overflow)
          pdf.addImage(img.dataUrl, "JPEG", x, y, cellW, (cellW / img.w) * img.h);
        }
        // Hairline frame
        setDraw(pdf, HAIRLINE);
        pdf.setLineWidth(0.15);
        pdf.rect(x, y, cellW, cellH, "S");
      }
    }
  }
}

function drawBackCover(l: Layout, article: ArticleForPdf) {
  l.pdf.addPage("a4", "portrait");
  l.pageNum += 1;
  const { pdf } = l;
  // Dark back cover
  setFill(pdf, { r: 20, g: 20, b: 22 });
  pdf.rect(0, 0, A4_W, A4_H, "F");

  // Logo center
  if (l.logo) {
    const targetW = 60;
    const targetH = (l.logo.height / l.logo.width) * targetW;
    pdf.addImage(
      l.logo.dataUrl,
      "PNG",
      (A4_W - targetW) / 2,
      A4_H / 2 - targetH - 6,
      targetW,
      targetH,
    );
  }

  // Tagline
  pdf.setFont("times", "italic");
  pdf.setFontSize(13);
  setText(pdf, { r: 220, g: 210, b: 180 });
  pdf.text("Where photographers become auteurs.", A4_W / 2, A4_H / 2 + 6, {
    align: "center",
  });

  // URL
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  setText(pdf, { r: 255, g: 255, b: 255 });
  pdf.text(BRAND_URL, A4_W / 2, A4_H / 2 + 16, { align: "center" });

  // ©
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  setText(pdf, { r: 160, g: 160, b: 160 });
  pdf.text(
    `© ${new Date().getFullYear()} ${BRAND}. All rights reserved.`,
    A4_W / 2,
    A4_H - 18,
    { align: "center" },
  );
}

// =====================================================================
// Fix up folios once total page count is known
// =====================================================================
function repaintFolios(pdf: jsPDF, totalPages: number) {
  // We can't easily re-open pages to erase — accept "N" only (single number),
  // which we already drew per page during build. No re-open needed.
  void pdf;
  void totalPages;
}

// =====================================================================
// Public entry point
// =====================================================================
export async function generateArticlePdf(args: GenerateArgs): Promise<void> {
  const { article, title } = args;

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const logo = await loadPdfLogo();

  const layout: Layout = {
    pdf,
    pageNum: 1,
    totalPages: 0,
    logo,
    runningHeader: article.sectionLabel || "FEATURED ARTIST",
    y: CONTENT_TOP,
  };

  // 1. Cover (page 1)
  await drawCoverPage(layout, article);

  // Parse body → blocks; take first paragraph as lede for title page
  const blocks = parseBodyHtml(article.body || "");
  const firstParaIdx = blocks.findIndex((b) => b.kind === "p");
  const lede = firstParaIdx >= 0 ? (blocks[firstParaIdx] as { text: string }).text : "";
  const bodyBlocks =
    firstParaIdx >= 0
      ? [...blocks.slice(0, firstParaIdx), ...blocks.slice(firstParaIdx + 1)]
      : blocks;

  // 2. Title / Lede (page 2)
  drawTitleLedePage(layout, article, lede);

  // 3. Body pages (start page 3)
  newBodyPage(layout);
  let paragraphCount = 0;
  let quoteBudget = 0;
  for (const block of bodyBlocks) {
    if (block.kind === "h2") {
      drawHeading(layout, block.text, "h2");
    } else if (block.kind === "h3") {
      drawHeading(layout, block.text, "h3");
    } else if (block.kind === "quote") {
      drawPullQuote(layout, block.text);
    } else if (block.kind === "img") {
      await drawInlineImage(layout, block.src, block.caption, article.authorName);
    } else if (block.kind === "p") {
      drawParagraph(layout, block.text, { dropCap: paragraphCount === 0 });
      paragraphCount += 1;
      // sprinkle a pull quote every ~5 paragraphs, using a short sentence from the paragraph
      quoteBudget += 1;
      if (quoteBudget >= 6 && block.text.length > 80) {
        // Skip — pull quotes are only when the source explicitly uses <blockquote>.
        quoteBudget = 0;
      }
    }
  }

  // 4. Artist Spotlight (only if bio present)
  if (article.authorBio && article.authorBio.trim().length > 0) {
    await drawSpotlightPage(layout, article);
  }

  // 5. Photo Gallery (only if provided)
  const gallery = (article.gallery || []).filter(Boolean);
  if (gallery.length > 0) {
    await drawGalleryPage(layout, gallery.slice(0, 6));
  }

  // 6. Back cover
  drawBackCover(layout, article);

  layout.totalPages = layout.pageNum;
  repaintFolios(pdf, layout.totalPages);

  const safeName = (title || article.title || "article")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  pdf.save(`${safeName || "article"}.pdf`);
}
