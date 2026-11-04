/**
 * PHOTO FEED CREDIT HARNESS (development only) — photofeedharness.html.
 *
 * Photo plan Unit A / audit B1 + B2 + M6: "the feed never loads a credited
 * file". This page makes a photo EXACTLY as the uploader does today — the
 * real encoder (`photoSetPhotoEncoder`) and the real names (`photoObjectPath`)
 * of the resumable post upload — and shows it in the REAL feed card
 * (PostCard → PostMedia) with the real CSS.
 *
 * Which stored files carry the credit is decided by their PIXELS, not by their
 * names: the same photo is encoded a second time with an empty credit line,
 * and any copy whose bytes differ from its twin is a credited file. So the
 * check cannot be fooled by a naming rule that is itself wrong.
 *
 * tools/uishot/photo-feed-credit.mjs drives it in Chromium at DPR 1 / 1.5 / 2 / 3,
 * desktop (1280) and phone (390), for three viewers, and fails if the feed
 * card ever requests a credited file.
 *
 *   ?viewer=on    signed in, photo_set_v2 answered ON at once
 *   ?viewer=late  signed in, the switch answer arrives 6 s after the card paints
 *   ?viewer=off   signed in, the switch answered OFF
 *   ?viewer=out   signed out
 *   ?w=phone      a 390 px card (else 560 px, the desktop feed column)
 *   ?src=<url>    the source photo (else a generated 4000×2667 scene)
 *   ?small=1      the generated scene at 1000×667 (the 601–1080 px case)
 *   ?legacy=1     the photo stored in the v2 `-l4` shape written 2 → 3 Nov 2026
 *                 (the URL IS the credited 2048; siblings -r1080 clean when the
 *                 long edge > 1080, -thumb, -r320) — the shape of the 3 live
 *                 posts the rectify unit repoints
 *   ?old=1        an OLD photo (unmarked URL) whose credited copy is found by
 *                 post_photo_credit_for (20261110_0109)
 *   ?admin=1      the viewer is a site admin (user_roles role = admin)
 *   ?app=1        the Android shell (window.Capacitor, set before the app loads)
 *   ?grid=1       also the post's photo grid (#gridwrap), whose tap opens full screen
 *   ?viewer=err   signed out, and the first feed copy requested fails (404):
 *                 the image-error fallback must be clean too (tools side)
 */
import { createRoot } from "react-dom/client";
import { Suspense, lazy, useState } from "react";
import { installFakeBackend, HARNESS_USER_ID, type FakeRoute } from "../fakeBackend";
import { fixtureRoutes } from "../fixtureRoutes";
import "../../index.css";
import { CommentsOverlayProvider } from "@/contexts/CommentsOverlayContext";
import type { UnifiedPost } from "@/types/post";

if (!import.meta.env.DEV) throw new Error("photo feed harness is development-only");

const q = new URLSearchParams(location.search);
const viewer = q.get("viewer") ?? "on";
const phone = q.get("w") === "phone";
const AUTHOR = "22222222-2222-4222-8222-222222222222";
const POST_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const CDN = "https://cdn.harness.test/";

(globalThis as { __harnessFeatures?: string[] }).__harnessFeatures = viewer === "on" || viewer === "late" ? ["photo_set_v2"] : [];
if (q.get("admin") === "1") (globalThis as { __harnessRoles?: string[] }).__harnessRoles = ["admin", "member"];
if (q.get("app") === "1") {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };
}
const legacy = q.get("legacy") === "1";
/**
 * ?old=1 — an OLD photo (posted before the New Photos plan): an UNMARKED clean
 * URL, and its credited copy (v4 small credit) at the derived
 * `posts/credit/<post>-<ord>-<hash>.webp` name, which post_photo_credit_for
 * returns (20261110_0109). Nothing about the post names that copy.
 */
const old = q.get("old") === "1";
let oldCredit: { src: string; credited: string } | null = null;
const oldCreditRoute: FakeRoute = ({ method, path, body }) => {
  if (method !== "POST" || path !== "/rest/v1/rpc/post_photo_credit_for") return undefined;
  const g = globalThis as { __oldCreditCalls?: number };
  g.__oldCreditCalls = (g.__oldCreditCalls ?? 0) + 1;
  const ids = (body as { p_post_ids?: string[] } | null)?.p_post_ids ?? [];
  return { body: oldCredit && ids.includes(POST_ID) ? [{ post_id: POST_ID, ord: 0, src_url: oldCredit.src, credited_url: oldCredit.credited }] : [] };
};
const born = Date.now();
const lateSwitch: FakeRoute = ({ method, path }) => {
  if (viewer !== "late" || method !== "POST" || path !== "/rest/v1/rpc/feature_allowed_me") return undefined;
  // Answer OFF until 6 s after the page started: the card paints first (cold start).
  return Date.now() - born < 6000 ? { body: false } : undefined;
};
installFakeBackend({ routes: [lateSwitch, oldCreditRoute, ...fixtureRoutes], signedIn: viewer !== "out" && viewer !== "err" });

/** A detailed, file-free scene (sky, hills, a lit window) — JPEG, as a phone hands it over. */
async function generatedPhoto(small: boolean): Promise<File> {
  const W = small ? 1000 : 4000;
  const H = small ? 667 : 2667;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#1d3557"); sky.addColorStop(0.55, "#e0a96d"); sky.addColorStop(1, "#3a2e2a");
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = `hsl(${20 + i * 8} 25% ${18 + i * 6}%)`;
    g.beginPath(); g.moveTo(0, H * (0.6 + i * 0.07));
    for (let x = 0; x <= W; x += W / 40) g.lineTo(x, H * (0.6 + i * 0.07) - Math.sin(x / (W / 7) + i) * H * 0.05);
    g.lineTo(W, H); g.lineTo(0, H); g.fill();
  }
  g.fillStyle = "#ffd27a"; g.fillRect(W * 0.62, H * 0.52, W * 0.05, H * 0.06);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.9));
  return new File([blob], "IMG_0001.jpg", { type: "image/jpeg" });
}

async function sourcePhoto(): Promise<File> {
  const src = q.get("src");
  if (!src) return generatedPhoto(q.get("small") === "1");
  const blob = await (await fetch(src)).blob();
  return new File([blob], "IMG_0001.jpg", { type: blob.type || "image/jpeg" });
}

const b64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const same = async (a: Blob, b: Blob) => {
  const x = new Uint8Array(await a.arrayBuffer());
  const y = new Uint8Array(await b.arrayBuffer());
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};

interface Stored { url: string; b64: string; credited: boolean; type: string; /** the clean twin (credited files only) — the tool measures the credit against it */ twin?: string }
declare global {
  interface Window {
    __photoStore?: Record<string, Stored>; __photoUrl?: string; __photoReady?: boolean;
    /** Exposed by tools/uishot/photo-feed-credit.mjs: the REAL server renderer (credit-render.mjs) on these bytes. */
    __serverCredit?: (b64: string) => Promise<string>;
  }
}

async function main() {
  const { photoSetPhotoEncoder } = await import("@/lib/photoSetUpload");
  const { photoObjectPath } = await import("@/lib/upload/photoJobs");
  const { rungPath } = await import("@/lib/imageLadder");
  const file = await sourcePhoto();
  // The uploader's clean files (it draws no credit: credit U3); the credited 2048
  // is what the server's renderer makes from the private clean 2048.
  const clean = await photoSetPhotoEncoder()(file);
  const k2048 = clean.clean as Blob;
  const c2048 = window.__serverCredit
    ? new Blob([Uint8Array.from(atob(await window.__serverCredit(await b64(k2048))), (ch) => ch.charCodeAt(0))], { type: "image/webp" })
    : k2048;
  type Rung = { rung: number; blob: Blob; suffix?: string };
  let full: string;
  let pairs: Array<[string, Blob, Blob]>;
  let thumbPath: string | null = null;
  if (old) {
    // The old original: a clean WebP at an unmarked name. Its credited copy: the
    // same pixels with the small credit (the uploader's own 2048 pair).
    full = `post-images/${AUTHOR}/posts/1700000000000-IMG_0001.webp`;
    const copy = `post-images/${AUTHOR}/posts/credit/${POST_ID}-0-0123456789ab.webp`;
    pairs = [[full, k2048, k2048], [copy, c2048, k2048]];
    thumbPath = full;
    oldCredit = { src: `${CDN}${full}`, credited: `${CDN}${copy}` };
  } else if (!legacy) {
    full = photoObjectPath(AUTHOR, "1762160000000-job", 0, clean.full.width, clean.full.height, true, clean.marker);
    const pathOf = (r: Rung) => (r.suffix ? full.replace(/\.webp$/, `${r.suffix}.webp`) : rungPath(full, r.rung));
    pairs = [
      [full, clean.full.blob, clean.full.blob],
      [full.replace(/\.webp$/, "-thumb.webp"), clean.thumb, clean.thumb],
      [full.replace(/\.webp$/, "-r2048c.webp"), c2048, k2048],
      ...(clean.rungs as Rung[]).map((r): [string, Blob, Blob] => [pathOf(r), r.blob, r.blob]),
    ];
  } else {
    // The v2 `-l4` shape, built from the same encoded copies: the URL is the
    // credited 2048 (its W×H in the name), `-r1080` the clean 1080 (only when
    // the long edge > 1080), `-thumb`, `-r320`.
    const bmp = await createImageBitmap(c2048);
    const W = bmp.width, H = bmp.height;
    bmp.close();
    full = `post-images/${AUTHOR}/posts/1762160000000-job-0-w${W}h${H}-l4.webp`;
    const at = (s: string) => full.replace(/\.webp$/, `${s}.webp`);
    pairs = [
      [full, c2048, k2048],
      [at("-thumb"), clean.thumb, clean.thumb],
      ...(Math.max(W, H) > 1080 ? [[at("-r1080"), clean.full.blob, clean.full.blob] as [string, Blob, Blob]] : []),
      ...(clean.rungs as Rung[]).filter((r) => r.suffix === "-r320").map((r): [string, Blob, Blob] => [at("-r320"), r.blob, (clean.rungs as Rung[]).find((x) => x.suffix === "-r320")!.blob]),
    ];
  }
  const store: Record<string, Stored> = {};
  for (const [path, blob, twin] of pairs) {
    const url = `${CDN}${path}`;
    { const credited = !(await same(blob, twin)); store[url] = { url, b64: await b64(blob), credited, type: blob.type || "image/webp", ...(credited ? { twin: await b64(twin) } : {}) }; }
  }
  window.__photoStore = store;
  const url = `${CDN}${full}`;
  window.__photoUrl = url;

  const post = {
    id: POST_ID, user_id: AUTHOR, content: "Evening over the hills", image_url: url, image_urls: [url],
    thumbnail_urls: [`${CDN}${thumbPath ?? full.replace(/\.webp$/, "-thumb.webp")}`],
    created_at: new Date(Date.now() - 21 * 60_000).toISOString(), privacy: "public", like_count: 12, comment_count: 3, share_count: 0,
    author_name: "Dipannita Sen", author_handle: "dipannita", author_avatar: null, user_reaction: null, reaction_counts: { like: 12 }, tagged_people: [],
  } as unknown as UnifiedPost;

  const AppShell = lazy(() => import("../AppShell"));
  const PostCard = lazy(() => import("@/components/post/PostCard"));
  const FacebookPhotoGrid = lazy(() => import("@/components/FacebookPhotoGrid"));
  /** The card keeps its own like state, as the feed does — so a double-tap shows the like land (feed gestures, 4 Nov 2026). */
  const Card = () => {
    const [p, setP] = useState(post);
    return (
      <PostCard
        post={p}
        currentUserId={viewer === "out" ? undefined : HARNESS_USER_ID}
        onReact={(_, type) => setP((c) => ({ ...c, user_reaction: type, like_count: c.like_count + 1, reaction_counts: { ...c.reaction_counts, [type]: (c.reaction_counts[type] ?? 0) + 1 } }))}
        onUnreact={() => setP(post)}
      />
    );
  };
  createRoot(document.getElementById("root")!).render(
    <Suspense fallback={<p>loading…</p>}>
      <AppShell route="/feed" path="/feed" withLayout={false}>
        <CommentsOverlayProvider>
          <div id="cardwrap" style={{ width: phone ? 390 : 560, margin: phone ? "0" : "16px auto", background: "hsl(var(--card))" }}>
            <Card />
          </div>
          {/* ?grid=1: the post's photo grid, the full-screen path photo-feed-credit.mjs checks (the feed photo opens no viewer since 4 Nov 2026). */}
          {q.get("grid") === "1" && (
            <div id="gridwrap" style={{ width: phone ? 390 : 560, margin: phone ? "0" : "16px auto" }}>
              <FacebookPhotoGrid urls={[url]} />
            </div>
          )}
        </CommentsOverlayProvider>
      </AppShell>
    </Suspense>,
  );
  window.__photoReady = true;
}

void main().catch((e) => {
  document.body.textContent = `harness failed: ${e instanceof Error ? e.message : String(e)}`;
});
