/**
 * CARD INK — what the EYE sees under a post's photo, in CSS px.
 *
 * Owner report 3 Nov 2026 (two screenshots): too much space photo → Like /
 * Comment / Share and icons → caption, and the left edges of the camera icon,
 * the camera line's 2nd line, the Like icon and the caption do not line up.
 * #846 had measured the gap between the photo frame and the action row
 * ELEMENT (0 px) — the boxes touched, yet the eye saw 13 px of empty card,
 * because the 48 px row centres a 24 px icon. Boxes are not what the Owner
 * sees; ink is.
 *
 * So this measures INK: the card is photographed, and inside the box of each
 * part (photo frame, camera icon, camera line text, 2nd line, the row's icons,
 * the caption) it finds the pixels that differ from that box's background
 * (its most common colour). It works on the live site (any recent PostCard)
 * and on the harness, and needs no image library: the browser decodes the
 * screenshot itself.
 *
 *   const ink = await measureCardInk(page, cardHandle);
 *   ink.gaps   → { photoToIcons, photoToCamera, cameraToIcons, iconsToCaption }
 *   ink.lefts  → { photo, cameraIcon, cameraLine2, like, caption } (x from the card's left edge)
 */

/** A pixel is ink when one channel moves more than this from the box's background. */
const INK = 48;

export async function measureCardInk(page, card) {
  const boxes = await card.evaluate((el) => {
    const c = el.getBoundingClientRect();
    const rel = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
    };
    const frame = el.querySelector(".cursor-zoom-in");
    const line = el.querySelector("[data-camera-line]");
    const camIcon = line?.querySelector("svg.lucide-camera");
    // The 2nd line (admins, opened): the panel that slid open under the button.
    const panel = line?.querySelector("[aria-hidden='false'] p") ?? null;
    // Line 1's text = the summary without its icon: the first item after the icon.
    const firstWord = line?.querySelector(".camW:nth-of-type(2)") ?? null;
    const like = el.querySelector("svg.lucide-thumbs-up") ?? el.querySelector("[aria-label*='eact' i] span.h-6");
    const icons = [...el.querySelectorAll("svg.lucide-thumbs-up, svg.lucide-message-circle, svg.lucide-send")];
    const caption = el.querySelector("[data-post-caption]") ?? el.querySelector("p.leading-relaxed");
    return {
      card: { w: c.width, h: c.height },
      frame: rel(frame),
      line: rel(line),
      camIcon: rel(camIcon),
      firstWord: rel(firstWord),
      panel: rel(panel),
      like: rel(like),
      icons: icons.map(rel).filter(Boolean),
      caption: rel(caption),
    };
  });
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  const png = await card.screenshot({ animations: "disabled" });
  const regions = {
    line: boxes.line, camIcon: boxes.camIcon, firstWord: boxes.firstWord, panel: boxes.panel,
    like: boxes.like, caption: boxes.caption,
    ...Object.fromEntries(boxes.icons.map((b, i) => [`icon${i}`, b])),
  };
  const ink = await page.evaluate(async ({ b64, regions, dpr, INK }) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const all = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const W = bmp.width;
    const out = {};
    for (const [name, r] of Object.entries(regions)) {
      if (!r) { out[name] = null; continue; }
      const x0 = Math.max(0, Math.floor(r.x * dpr)), y0 = Math.max(0, Math.floor(r.y * dpr));
      const x1 = Math.min(W, Math.ceil((r.x + r.w) * dpr)), y1 = Math.min(bmp.height, Math.ceil((r.y + r.h) * dpr));
      // The box's background: its most common colour.
      const count = new Map();
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        const k = (all[i] << 16) | (all[i + 1] << 8) | all[i + 2];
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      let bg = 0, best = -1;
      for (const [k, n] of count) if (n > best) { best = n; bg = k; }
      const br = (bg >> 16) & 255, bgG = (bg >> 8) & 255, bb = bg & 255;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        if (Math.abs(all[i] - br) > INK || Math.abs(all[i + 1] - bgG) > INK || Math.abs(all[i + 2] - bb) > INK) {
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      out[name] = minX === Infinity ? null
        : { left: minX / dpr, top: minY / dpr, right: (maxX + 1) / dpr, bottom: (maxY + 1) / dpr };
    }
    return out;
  }, { b64: png.toString("base64"), regions, dpr, INK });

  const iconInk = Object.keys(ink).filter((k) => k.startsWith("icon")).map((k) => ink[k]).filter(Boolean);
  const iconsTop = iconInk.length ? Math.min(...iconInk.map((i) => i.top)) : null;
  const iconsBottom = iconInk.length ? Math.max(...iconInk.map((i) => i.bottom)) : null;
  const photoBottom = boxes.frame ? boxes.frame.y + boxes.frame.h : null;
  const line = ink.line;
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const sub = (a, b) => (a == null || b == null ? null : r1(a - b));
  return {
    gaps: {
      photoToIcons: line ? null : sub(iconsTop, photoBottom),
      photoToCamera: line ? sub(line.top, photoBottom) : null,
      cameraToIcons: line ? sub(iconsTop, line.bottom) : null,
      iconsToCaption: sub(ink.caption?.top, iconsBottom),
    },
    lefts: {
      photo: r1(boxes.frame?.x),
      cameraIcon: r1(ink.camIcon?.left),
      cameraLine1Text: r1(ink.firstWord?.left),
      cameraLine2: r1(ink.panel?.left),
      like: r1(ink.like?.left),
      caption: r1(ink.caption?.left),
    },
    ink: { iconsTop: r1(iconsTop), iconsBottom: r1(iconsBottom), photoBottom: r1(photoBottom), line, caption: ink.caption },
    cardWidth: r1(boxes.card.w),
  };
}
