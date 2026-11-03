/**
 * CARD HITS — which control a finger REALLY gets, at every 2 px under the photo.
 *
 * Review of #867 (BLOCKING): the tight row kept 44 px targets by letting hit
 * areas reach past the boxes, and two of them overlapped — the admin camera
 * button's reached over the like / share counts, and the row's reached up over
 * the camera line (a tap on the line's lower half Liked the post). Boxes and
 * ink cannot show that; elementFromPoint can.
 *
 * THE AGREED BANDS (one fixed spec, from the visible layout — not from the CSS
 * that implements it). P = the photo's bottom edge.
 *   caption        everything from the caption's top down (name, text, See more)
 *   camera line    from P (members) / P - 10 (admins: the button reaches 10 px
 *                  into the photo, full width) down to the row's top
 *   row controls   each control owns its own column (its box's x-range), from
 *                  the row's top — or, with NO camera line, from P - 12 (the
 *                  Like / Comment / Share / count targets take the bottom 12 px
 *                  of the photo in their own columns only, so each stays 44 px
 *                  tall; the photo's zoom keeps every other pixel) — down to the
 *                  caption's top
 *   the photo      everything above, elsewhere
 *   nothing        row gaps between controls (below P)
 * A point within 1.5 px of a band edge is not judged (sub-pixel rounding).
 */
export async function checkCardHits(page) {
  return page.evaluate(() => {
    const card = document.querySelector("#cardwrap [data-post-id]");
    if (!card) return { points: 0, mismatches: ["no card"] };
    const kids = [...card.children];
    const media = card.querySelector('[class~="group/media"]');
    const rowRoot = kids.find((k) => k.querySelector("svg.lucide-thumbs-up, [aria-label*='reaction' i]"));
    const capRoot = kids.find((k) => k.querySelector("p.leading-relaxed"));
    const cam = card.querySelector("[data-camera-line], [data-camera-line-reserve]");
    const admin = !!cam?.querySelector("button");
    if (!media || !rowRoot || !capRoot) return { points: 0, mismatches: ["card parts not found"] };
    rowRoot.scrollIntoView({ block: "center" });
    const P = media.getBoundingClientRect().bottom;
    const rowTop = rowRoot.getBoundingClientRect().top;
    const capTop = capRoot.getBoundingClientRect().top;
    const W = card.getBoundingClientRect();
    const items = [...rowRoot.querySelectorAll("button")].map((b, i) => {
      const r = b.getBoundingClientRect();
      return { el: b, i, l: r.left, r: r.right, name: b.getAttribute("aria-label") || `button ${i}` };
    }).filter((it) => it.r > it.l);
    const camTop = cam ? (admin ? P - 10 : P) : null;
    const itemsTop = cam ? rowTop : P - 12;
    const yEdges = [P, capTop, itemsTop, ...(cam ? [camTop, rowTop] : [])];
    const xEdges = items.flatMap((it) => [it.l, it.r]);
    const near = (v, edges) => edges.some((e) => Math.abs(v - e) < 1.5);
    const expected = (x, y) => {
      if (y >= capTop) return "caption";
      if (cam && y >= camTop && y < rowTop) return "camera";
      if (y >= itemsTop) {
        const it = items.find((t) => x >= t.l && x < t.r);
        if (it) return `row:${it.name}`;
      }
      return y < P ? "photo" : "nothing";
    };
    const actual = (e) => {
      if (!e) return "null";
      if (e.closest("[data-camera-line], [data-camera-line-reserve]")) return "camera";
      if (capRoot.contains(e)) return "caption";
      if (rowRoot.contains(e)) {
        const b = e.closest("button");
        const it = b && items.find((t) => t.el === b);
        return it ? `row:${it.name}` : "nothing";
      }
      if (media.contains(e)) return "photo";
      if (e === card || e === rowRoot) return "nothing";
      return `other:${e.tagName.toLowerCase()}`;
    };
    const mismatches = [];
    let points = 0;
    for (let y = Math.ceil(P - 20); y < capTop + 16; y += 2) {
      if (near(y, yEdges)) continue;
      for (let x = Math.ceil(W.left) + 1; x < W.right - 1; x += 2) {
        if (near(x, xEdges)) continue;
        points++;
        const want = expected(x, y);
        const got = actual(document.elementFromPoint(x, y));
        if (want !== got) mismatches.push({ x: Math.round(x - W.left), y: Math.round(y - P), want, got });
      }
    }
    // One line per kind of mismatch, with how many points and the first one.
    const kinds = new Map();
    for (const m of mismatches) {
      const k = `${m.want} → ${m.got}`;
      const v = kinds.get(k) ?? { n: 0, at: `x ${m.x}, P${m.y >= 0 ? "+" : ""}${m.y}` };
      v.n++;
      kinds.set(k, v);
    }
    return { points, mismatches: [...kinds].map(([k, v]) => `${k}: ${v.n} points (first at ${v.at})`) };
  });
}
