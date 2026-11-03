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
 */
import { createRoot } from "react-dom/client";
import { Suspense, lazy } from "react";
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
const born = Date.now();
const lateSwitch: FakeRoute = ({ method, path }) => {
  if (viewer !== "late" || method !== "POST" || path !== "/rest/v1/rpc/feature_allowed_me") return undefined;
  // Answer OFF until 6 s after the page started: the card paints first (cold start).
  return Date.now() - born < 6000 ? { body: false } : undefined;
};
installFakeBackend({ routes: [lateSwitch, ...fixtureRoutes], signedIn: viewer !== "out" });

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

interface Stored { url: string; b64: string; credited: boolean; type: string }
declare global {
  interface Window { __photoStore?: Record<string, Stored>; __photoUrl?: string; __photoReady?: boolean }
}

async function main() {
  const { photoSetPhotoEncoder } = await import("@/lib/photoSetUpload");
  const { photoObjectPath } = await import("@/lib/upload/photoJobs");
  const { rungPath } = await import("@/lib/imageLadder");
  const { creditText } = await import("@/lib/photoCredit");
  const file = await sourcePhoto();
  const credited = await photoSetPhotoEncoder(creditText("Dipannita Sen"))(file);
  const clean = await photoSetPhotoEncoder("")(file);
  const full = photoObjectPath(AUTHOR, "1762160000000-job", 0, credited.full.width, credited.full.height, true, credited.marker);
  type Rung = { rung: number; blob: Blob; suffix?: string };
  const pathOf = (r: Rung) => (r.suffix ? full.replace(/\.webp$/, `${r.suffix}.webp`) : rungPath(full, r.rung));
  const pairs: Array<[string, Blob, Blob]> = [
    [full, credited.full.blob, clean.full.blob],
    [full.replace(/\.webp$/, "-thumb.webp"), credited.thumb, clean.thumb],
    ...(credited.rungs as Rung[]).map((r, i): [string, Blob, Blob] => [pathOf(r), r.blob, (clean.rungs as Rung[])[i].blob]),
  ];
  const store: Record<string, Stored> = {};
  for (const [path, blob, twin] of pairs) {
    const url = `${CDN}${path}`;
    store[url] = { url, b64: await b64(blob), credited: !(await same(blob, twin)), type: blob.type || "image/webp" };
  }
  window.__photoStore = store;
  const url = `${CDN}${full}`;
  window.__photoUrl = url;

  const post = {
    id: POST_ID, user_id: AUTHOR, content: "Evening over the hills", image_url: url, image_urls: [url],
    thumbnail_urls: [`${CDN}${full.replace(/\.webp$/, "-thumb.webp")}`],
    created_at: new Date(Date.now() - 21 * 60_000).toISOString(), privacy: "public", like_count: 12, comment_count: 3, share_count: 0,
    author_name: "Dipannita Sen", author_handle: "dipannita", author_avatar: null, user_reaction: null, reaction_counts: { like: 12 }, tagged_people: [],
  } as unknown as UnifiedPost;

  const AppShell = lazy(() => import("../AppShell"));
  const PostCard = lazy(() => import("@/components/post/PostCard"));
  createRoot(document.getElementById("root")!).render(
    <Suspense fallback={<p>loading…</p>}>
      <AppShell route="/feed" path="/feed" withLayout={false}>
        <CommentsOverlayProvider>
          <div id="cardwrap" style={{ width: phone ? 390 : 560, margin: phone ? "0" : "16px auto", background: "hsl(var(--card))" }}>
            <PostCard post={post} currentUserId={viewer === "out" ? undefined : HARNESS_USER_ID} onReact={() => {}} onUnreact={() => {}} />
          </div>
        </CommentsOverlayProvider>
      </AppShell>
    </Suspense>,
  );
  window.__photoReady = true;
}

void main().catch((e) => {
  document.body.textContent = `harness failed: ${e instanceof Error ? e.message : String(e)}`;
});
