/**
 * CARD HITS — which control a finger REALLY gets under the photo.
 *
 * Review of #867 (BLOCKING, twice): the tight row kept 44 px targets by letting
 * hit areas reach past the boxes. First two of them overlapped (the admin
 * camera button over the counts; the row over the camera line); then, with
 * the overlap fixed by layering, the camera line covered the row's reach-up
 * and Like / Comment / Share were only 32 px tall to a finger whenever a
 * camera line was shown. Boxes and ink cannot show either; elementFromPoint can.
 *
 * TWO CHECKS.
 *
 * (A) EVERY POINT, every 2 px, against one fixed spec of bands. P = the
 *     photo's bottom edge; R = the row's top.
 *   caption          everything from the caption's top down (name, text, See more)
 *   row controls     each control owns its own column (its box's x-range) from
 *                    R - 12 down to the caption — over the photo's bottom 12 px
 *                    when there is no camera line, over the camera line's lower
 *                    half when there is one (members: the line is plain text,
 *                    nothing to tap; admins: see below)
 *   admin toggle     (the camera line's arrow button, admins only) from P - 10
 *                    (its box sits 10 px in the photo) down to 32 px below its
 *                    box, in every column the row controls do not own — so it
 *                    is 44 px+ tall in the row's empty columns (the gap before
 *                    the reaction break-up, the row's end) and keeps the line's
 *                    upper part everywhere
 *   the photo        everything above, elsewhere
 *   nothing          everything else (the members' camera line outside the row
 *                    columns, row gaps)
 *   A point within 1.5 px of a band edge is not judged (sub-pixel rounding).
 *
 * (B) HARD SIZE, read from the browser only (no band involved, so a shrinking
 *     control cannot pass): for every row control (Like, like count, Comment,
 *     Share, share count, reaction break-up) the longest vertical run, in any
 *     1 px column of its own box, where elementFromPoint returns THAT control,
 *     sampled every 1 px, must be >= 44 px. For the admin toggle: its longest
 *     run in any column of the card must be >= 44 px.
 */
export async function checkCardHits(page) {
  return page.evaluate(() => {
    const card = document.querySelector("#cardwrap [data-post-id]");
    if (!card) return { points: 0, mismatches: ["no card"], short: ["no card"] };
    const kids = [...card.children];
    const media = card.querySelector('[class~="group/media"]');
    const rowRoot = kids.find((k) => k.querySelector("svg.lucide-thumbs-up, [aria-label*='reaction' i]"));
    const capRoot = kids.find((k) => k.querySelector("p.leading-relaxed"));
    const cam = card.querySelector("[data-camera-line], [data-camera-line-reserve]");
    const toggle = cam?.querySelector("button") ?? null;
    if (!media || !rowRoot || !capRoot) return { points: 0, mismatches: ["card parts not found"], short: ["card parts not found"] };
    rowRoot.scrollIntoView({ block: "center" });
    const P = media.getBoundingClientRect().bottom;
    const R = rowRoot.getBoundingClientRect().top;
    const capTop = capRoot.getBoundingClientRect().top;
    const W = card.getBoundingClientRect();
    const items = [...rowRoot.querySelectorAll("button")].map((b, i) => {
      const r = b.getBoundingClientRect();
      return { el: b, i, l: r.left, r: r.right, name: b.getAttribute("aria-label") || `button ${i}` };
    }).filter((it) => it.r > it.l);
    const togBottom = toggle ? toggle.getBoundingClientRect().bottom + 32 : null;
    const yEdges = [P, capTop, R - 12, ...(toggle ? [P - 10, togBottom] : [])];
    const xEdges = items.flatMap((it) => [it.l, it.r]);
    const near = (v, edges) => edges.some((e) => Math.abs(v - e) < 1.5);
    const expected = (x, y) => {
      if (y >= capTop) return "caption";
      const it = items.find((t) => x >= t.l && x < t.r);
      if (it && y >= R - 12) return `row:${it.name}`;
      if (toggle && y >= P - 10 && y < togBottom) return "camera toggle";
      return y < P ? "photo" : "nothing";
    };
    const actual = (e) => {
      if (!e) return "null";
      if (toggle && toggle.contains(e)) return "camera toggle";
      if (e.closest("[data-camera-line], [data-camera-line-reserve]")) return "camera line (not a control)";
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
    // (A)
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
    const kinds = new Map();
    for (const m of mismatches) {
      const k = `${m.want} → ${m.got}`;
      const v = kinds.get(k) ?? { n: 0, at: `x ${m.x}, P${m.y >= 0 ? "+" : ""}${m.y}` };
      v.n++;
      kinds.set(k, v);
    }
    // (B) longest run, 1 px steps, from the browser alone.
    const yTop = Math.floor(P - 60), yBot = Math.ceil(capTop + 60);
    const longest = (x, target) => {
      let best = 0, run = 0;
      for (let y = yTop + 0.5; y < yBot; y += 1) {
        const e = document.elementFromPoint(x, y);
        const hit = !!e && (e === target || target.contains(e) || (target === toggle ? false : e.closest("button") === target));
        run = hit ? run + 1 : 0;
        if (run > best) best = run;
      }
      return best;
    };
    const runs = [];
    for (const it of items) {
      let best = 0;
      for (let x = Math.ceil(it.l) + 0.5; x < it.r; x += 1) best = Math.max(best, longest(x, it.el));
      runs.push({ name: `row:${it.name}`, px: best });
    }
    if (toggle) {
      let best = 0;
      for (let x = Math.ceil(W.left) + 0.5; x < W.right; x += 1) best = Math.max(best, longest(x, toggle));
      runs.push({ name: "camera toggle", px: best });
    }
    const short = runs.filter((r) => r.px < 44).map((r) => `${r.name} ${r.px} px tall to a finger`);
    return {
      points,
      mismatches: [...kinds].map(([k, v]) => `${k}: ${v.n} points (first at ${v.at})`),
      runs: runs.map((r) => `${r.name} ${r.px}`).join(", "),
      short,
    };
  });
}
