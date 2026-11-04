/**
 * ROW INK — the SIDE-TO-SIDE spaces the eye sees in the Like / Comment / Share
 * row, in CSS px.
 *
 * Owner report 4 Nov 2026 (screenshot of the live row, with Instagram open
 * beside it): the space between an icon and its count, and between one group
 * and the next, is far too wide. Instagram's row is "auto fitting space based
 * on the count": the count hugs its icon (~5 px), the next icon starts a fixed
 * small step after the count (~14–16 px), and an icon with no count sits ~18 px
 * before the next icon — so the row's width follows the digits. Measured from
 * the Owner's Instagram screenshots (1.42 image px per CSS px): icon → count
 * 5.6, count → next icon 14–14.8, icon → icon (no count) 18.4.
 *
 * Like card-ink.mjs this measures INK, not boxes: the card is photographed and,
 * inside the box of each part (the Like / Comment / Share icons, each count),
 * the pixels that differ from that box's background are found. It works on the
 * live site (any PostCard) and on the harness, and needs no image library.
 *
 *   const row = await measureRowInk(page, cardHandle);
 *   row.parts  → [{ part: "like-icon", left, right, text? }, ...] in row order
 *   row.gaps   → [{ from, to, px }, ...] between neighbours, in row order
 */

/** A pixel is ink when one channel moves more than this from the box's background. */
const INK = 48;

export async function measureRowInk(page, card) {
  const boxes = await card.evaluate((el) => {
    const c = el.getBoundingClientRect();
    const rel = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
    };
    /** The row: the card child holding the Like control. */
    const row = [...el.children].find((k) => k.querySelector("svg.lucide-thumbs-up, button[aria-pressed]"));
    if (!row) return null;
    const likeBtn = row.querySelector("button[aria-pressed]");
    // The icon is an svg (not reacted) or the reaction's emoji in a 24 px box.
    const likeIcon = likeBtn?.querySelector("svg") ?? likeBtn?.querySelector("span");
    const breakdown = row.querySelector(".ml-auto");
    const likeCountBtn = [...row.querySelectorAll("button[aria-label^='See who reacted']")]
      .find((b) => !breakdown || !breakdown.contains(b));
    const likeCount = likeCountBtn ? (likeCountBtn.querySelector("span") ?? likeCountBtn) : null;
    const commentIcon = row.querySelector("svg.lucide-message-circle");
    const commentBtn = commentIcon?.closest("button") ?? null;
    const commentCount = commentBtn?.querySelector("span") ?? null;
    const shareIcon = row.querySelector("svg.lucide-send");
    // The share count: the share summary trigger (posts) or the plain number (ads).
    const shareCountBtn = row.querySelector("button[aria-label^='See who shared']");
    const shareGroup = shareIcon?.closest("button")?.parentElement ?? null;
    const shareCount = shareCountBtn
      ? (shareCountBtn.querySelector("span") ?? shareCountBtn)
      : (shareGroup ? [...shareGroup.children].find((k) => k.tagName === "SPAN") ?? null : null);
    const parts = [
      ["like-icon", likeIcon], ["like-count", likeCount],
      ["comment-icon", commentIcon], ["comment-count", commentCount],
      ["share-icon", shareIcon], ["share-count", shareCount],
    ].filter(([, e]) => !!e).map(([part, e]) => ({ part, box: rel(e), text: part.endsWith("count") ? e.textContent.trim() : undefined }));
    return { parts: parts.filter((p) => p.box), row: rel(row) };
  });
  if (!boxes) return { parts: [], gaps: [], error: "row not found" };
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  const png = await card.screenshot({ animations: "disabled" });
  const ink = await page.evaluate(async ({ b64, regions, dpr, INK }) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const all = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const W = bmp.width;
    return regions.map((r) => {
      const x0 = Math.max(0, Math.floor(r.x * dpr)), y0 = Math.max(0, Math.floor(r.y * dpr));
      const x1 = Math.min(W, Math.ceil((r.x + r.w) * dpr)), y1 = Math.min(bmp.height, Math.ceil((r.y + r.h) * dpr));
      const count = new Map();
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        const k = (all[i] << 16) | (all[i + 1] << 8) | all[i + 2];
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      let bg = 0, best = -1;
      for (const [k, n] of count) if (n > best) { best = n; bg = k; }
      const br = (bg >> 16) & 255, bgG = (bg >> 8) & 255, bb = bg & 255;
      let minX = Infinity, maxX = -Infinity;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        if (Math.abs(all[i] - br) > INK || Math.abs(all[i + 1] - bgG) > INK || Math.abs(all[i + 2] - bb) > INK) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
        }
      }
      return minX === Infinity ? null : { left: minX / dpr, right: (maxX + 1) / dpr };
    });
  }, { b64: png.toString("base64"), regions: boxes.parts.map((p) => p.box), dpr, INK });
  const r1 = (v) => Math.round(v * 10) / 10;
  const parts = boxes.parts.map((p, i) => ink[i]
    ? { part: p.part, left: r1(ink[i].left), right: r1(ink[i].right), ...(p.text !== undefined ? { text: p.text } : {}) }
    : null).filter(Boolean);
  const gaps = parts.slice(1).map((p, i) => ({ from: parts[i].part, to: p.part, px: r1(p.left - parts[i].right) }));
  return { parts, gaps };
}

/**
 * THE OWNER'S SPACING (4 Nov 2026), on ink. Returns [ok, what] pairs.
 *   icon → its own count           3–7 px    (Instagram 5.6)
 *   count → the next icon          14–18 px  (Instagram 14–14.8; the supervisor's read 16)
 *   icon (no count) → next icon    15–20 px  (Instagram 18.4)
 * One exception, written down rather than hidden: a ONE-digit like count is
 * its own control (it opens the Reactions list) and must stay >= 32 px wide to
 * a finger (the gate's floor, capture.mjs: long >= 44, short >= 32). Between
 * the Like icon and the Comment icon there is not room for both at 5 + 16 px,
 * so after a one-digit like count the step may be up to 23 px.
 */
export function rowInkChecks(row) {
  const out = [];
  if (!row.parts.length) return [[false, `row ink not found${row.error ? `: ${row.error}` : ""}`]];
  const textOf = (part) => row.parts.find((p) => p.part === part)?.text ?? "";
  for (const g of row.gaps) {
    const fromIcon = g.from.endsWith("icon"), toCount = g.to.endsWith("count");
    const label = `${g.from} → ${g.to}, visible: ${g.px} px`;
    if (fromIcon && toCount) out.push([g.px >= 3 && g.px <= 7, `${label} (3–7)`]);
    else if (!fromIcon && !toCount) {
      const oneDigitLike = g.from === "like-count" && textOf("like-count").length === 1;
      const hi = oneDigitLike ? 23 : 18;
      out.push([g.px >= 14 && g.px <= hi, `${label} (14–${hi}${oneDigitLike ? ", one-digit like count: 32 px tap floor" : ""})`]);
    } else if (fromIcon && !toCount) out.push([g.px >= 15 && g.px <= 20, `${label} (no count: 15–20)`]);
    else out.push([false, `${label} (count → count: never two counts side by side)`]);
  }
  return out;
}
