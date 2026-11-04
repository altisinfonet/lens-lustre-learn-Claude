/**
 * COMMENTS HARNESS (development only) — commentsharness.html.
 *
 * The REAL comments surfaces with the REAL CSS, against the harness fake
 * backend, for tools/uishot/comments-compact.mjs (Owner report 4 Nov 2026:
 * "huge gap from each comment / reply — follow Instagram style, more compact").
 *
 *   ?surface=panel   (default) the REAL CommentsOverlay opened on a post, exactly
 *                    as a feed card opens it: the desktop side panel beside the
 *                    photo at ≥ 768 px, the bottom sheet below that. Its thread
 *                    is read through the real usePostComments → post_comments.
 *   ?surface=entry   the REAL CommentsSection (competition entry / journal
 *                    article), reading the `comments` table — the surface that
 *                    used to draw its own bubble row.
 *   ?surface=image   the REAL ImageEngagement (EntryCard, EntryDetail, Lightbox,
 *                    MyPhotos), reading `image_comments`
 *   ?surface=lightbox  the REAL CompetitionLightbox with its comments panel
 *                    (the panel shows in the "result" phase only)
 *   ?thread=owner|replies|long   which comments (see THREADS below)
 *   ?app=1           the Android shell (window.Capacitor, set before the app loads)
 */
import { createRoot } from "react-dom/client";
import { Suspense, lazy, useEffect, type ComponentProps } from "react";
import { installFakeBackend, HARNESS_USER_ID, type FakeRoute } from "../fakeBackend";
import { fixtureRoutes } from "../fixtureRoutes";
import "../../index.css";
import { CommentsOverlayProvider, useCommentsOverlay } from "@/contexts/CommentsOverlayContext";
import type { UnifiedPost } from "@/types/post";

if (!import.meta.env.DEV) throw new Error("comments harness is development-only");

const q = new URLSearchParams(location.search);
if (q.get("app") === "1") {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };
}

const POST_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const ENTRY_ID = "eeeeeeee-0000-4000-8000-000000000001";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const WEEKS = (n: number) => new Date(Date.now() - n * 7 * 86_400_000).toISOString();

/** Authors. Ids are fixed so a run is repeatable. */
const A = {
  amit: { id: "a0000000-0000-4000-8000-000000000001", full_name: "Amit Baran Sen", custom_url: "amitbaransen" },
  monojit: { id: "a0000000-0000-4000-8000-000000000002", full_name: "Monojit Dutta", custom_url: "monojitdutta" },
  neil: { id: "a0000000-0000-4000-8000-000000000003", full_name: "Neil Basu", custom_url: "neilbasu" },
  somnath: { id: "a0000000-0000-4000-8000-000000000004", full_name: "Somnath Roy", custom_url: "somnath_photolover22" },
  framo: { id: "a0000000-0000-4000-8000-000000000005", full_name: "Framo Grapher", custom_url: "framo_grapher" },
  sandeep: { id: "a0000000-0000-4000-8000-000000000006", full_name: "Sandeep Kale", custom_url: "sandeep.artist" },
  long: { id: "a0000000-0000-4000-8000-000000000007", full_name: "Shri Venkata Subramanian Ramakrishnan Iyer", custom_url: "venkata.subramanian.ramakrishnan" },
} as const;
const VERIFIED = new Set<string>([A.monojit.id, A.long.id]);

interface Row {
  id: string; user_id: string; content: string; created_at: string; parent_id: string | null; likes: number; mine?: boolean;
}
let seq = 0;
const row = (author: { id: string }, content: string, weeks: number, likes = 0, parent: string | null = null, mine = false): Row => ({
  id: `c0000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, user_id: author.id, content, created_at: WEEKS(weeks), parent_id: parent, likes, mine,
});

/**
 * owner    the Owner's screenshot: two comments, one liked once, one verified with an emoji
 * replies  a comment with two replies (one opens with an @mention, as every reply does)
 * long     a long name + verified, a long two-paragraph comment with a long link, likes vs none
 */
function thread(kind: string): Row[] {
  if (kind === "replies") {
    const p = row(A.neil, "Congratulations", 5, 3);
    return [
      p,
      row(A.somnath, `@[Neil Basu](${A.neil.id}) Thank you for all your support`, 4, 0, p.id),
      row(A.framo, "Agreed, the light on the headdresses is superb", 4, 1, p.id),
      row(A.sandeep, "❤️ congratulations", 5, 1),
      row(A.amit, "Wonderful frame", 3, 0),
    ];
  }
  if (kind === "long") {
    const p = row(A.long, "Beautiful capture of the Kathi Holi. The light on the headdresses is superb and the colours hold even in the shadows.\nWhich lens did you use for this? https://www.50mmretina.com/journal/a-very-long-article-address-that-keeps-going", 6, 12, null, true);
    return [p, row(A.amit, "Outstanding picture", 9, 0), row(A.monojit, "Lovely Shot ❤️", 5, 1)];
  }
  return [row(A.amit, "Outstanding picture", 9, 1), row(A.monojit, "Lovely Shot ❤️", 5, 0)];
}
const ROWS = thread(q.get("thread") ?? "owner");
const PEOPLE = Object.values(A);

const idsIn = (params: URLSearchParams, key: string): Set<string> | null => {
  const raw = params.get(key);
  if (!raw?.startsWith("in.(")) return null;
  return new Set(raw.slice(4, -1).split(",").map((s) => s.replace(/"/g, "")));
};
const reactionsOf = (r: Row) => [
  ...Array.from({ length: r.likes - (r.mine ? 1 : 0) }, (_, i) => ({ user_id: `r${i}-${r.id}`, reaction_type: "like" })),
  ...(r.mine ? [{ user_id: HARNESS_USER_ID, reaction_type: "like" }] : []),
];

const comments: FakeRoute = ({ method, path, params }) => {
  if (method !== "GET" && method !== "HEAD") return undefined;
  if (path === "/rest/v1/post_comments") {
    return {
      body: ROWS.map((r) => ({
        id: r.id, user_id: r.user_id, content: r.content, created_at: r.created_at, updated_at: r.created_at,
        parent_id: r.parent_id, is_pinned: false, post_id: POST_ID, post_comment_reactions: reactionsOf(r),
      })),
    };
  }
  if (path === "/rest/v1/post_comment_reactions") {
    return { body: ROWS.flatMap((r) => reactionsOf(r).map((x) => ({ comment_id: r.id, ...x }))) };
  }
  // The entry / article thread (CommentsSection): `comments` + `comment_reactions`.
  if (path === "/rest/v1/comments") {
    return {
      body: ROWS.map((r) => ({
        id: r.id, user_id: r.user_id, content: r.content, created_at: r.created_at, updated_at: r.created_at,
        parent_id: r.parent_id, is_pinned: false,
      })),
    };
  }
  if (path === "/rest/v1/comment_reactions") {
    const mineOnly = params.get("user_id")?.startsWith("eq.");
    return {
      body: ROWS.flatMap((r) => reactionsOf(r).map((x) => ({ comment_id: r.id, ...x })))
        .filter((x) => !mineOnly || x.user_id === HARNESS_USER_ID),
    };
  }
  // A photograph's thread (ImageEngagement): `image_comments`, no per-comment likes.
  if (path === "/rest/v1/image_comments") {
    return {
      body: ROWS.map((r) => ({
        id: r.id, user_id: r.user_id, content: r.content, created_at: r.created_at, parent_id: r.parent_id, is_pinned: false, is_admin_seed: false,
      })),
    };
  }
  if (path === "/rest/v1/image_reactions") return { body: [] };
  if (path === "/rest/v1/profiles_public_data") {
    const want = idsIn(params, "id");
    const mine = PEOPLE.filter((p) => !want || want.has(p.id));
    if (want && mine.length === 0) return undefined; // someone else's lookup — the fixtures answer it
    return { body: mine.map((p) => ({ ...p, avatar_url: null, last_active_at: null })) };
  }
  if (path === "/rest/v1/user_badges") {
    const want = idsIn(params, "user_id");
    const mine = PEOPLE.filter((p) => VERIFIED.has(p.id) && (!want || want.has(p.id)));
    if (want && ![...want].some((id) => PEOPLE.some((p) => p.id === id))) return undefined;
    return { body: mine.map((p) => ({ user_id: p.id, badge_type: "verified" })) };
  }
  return undefined;
};
installFakeBackend({ routes: [comments, ...fixtureRoutes], signedIn: true });

/** A fixed, file-free "photo" for the side panel (the Owner's screenshot has the post's photo on the left). */
const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#4b5a3c"/><stop offset="1" stop-color="#1d2617"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><path d="M640 0 L760 800 L560 800 Z" fill="#8a7a55" opacity="0.6"/></svg>`,
)}`;

const post = {
  id: POST_ID, user_id: OWNER_ID, content: "Mossy Roots #aug_gallerycontest", image_url: PHOTO, image_urls: [PHOTO], thumbnail_urls: [PHOTO],
  created_at: WEEKS(10), privacy: "public", like_count: 12, comment_count: ROWS.length, share_count: 0,
  author_name: "Dipannita Sen", author_handle: "dipannita", author_avatar: null, user_reaction: null,
  reaction_counts: {}, tagged_people: [],
} as unknown as UnifiedPost;

const AppShell = lazy(() => import("../AppShell"));
const CommentsOverlay = lazy(() => import("@/components/comments/CommentsOverlay"));
const CommentsSection = lazy(() => import("@/components/CommentsSection"));
const ImageEngagement = lazy(() => import("@/components/ImageEngagement"));
const CompetitionLightbox = lazy(() => import("@/components/CompetitionLightbox"));

const LIGHTBOX_PHOTOS = [{
  entryId: ENTRY_ID, entryTitle: "Mossy Roots", photographerName: "Dipannita Sen", photographerHandle: "dipannita",
  photoUrl: PHOTO, thumbnailUrl: PHOTO, photoIndex: 0, totalPhotos: 1, voteCount: 12, userVoted: false, userId: OWNER_ID,
}] satisfies ComponentProps<typeof CompetitionLightbox>["images"];
const nothing = () => {};

/** Opens the overlay the way a feed card's comment button does. */
function OpenOnMount() {
  const { openPostComments } = useCommentsOverlay();
  useEffect(() => { openPostComments(post); }, [openPostComments]);
  return null;
}

const surface = q.get("surface") ?? "panel";

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<p>loading…</p>}>
    <AppShell route="/feed" path="/feed" withLayout={false}>
      <CommentsOverlayProvider>
        {surface === "lightbox" ? (
          <CompetitionLightbox
            images={LIGHTBOX_PHOTOS} currentIndex={0} isOpen onClose={nothing} onPrev={nothing} onNext={nothing} onVote={nothing}
            competitionPhase="result"
          />
        ) : surface === "image" ? (
          <div id="entrywrap" style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
            <ImageEngagement imageType="competition_entry" imageId={ENTRY_ID} />
          </div>
        ) : surface === "entry" ? (
          <div id="entrywrap" style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
            <CommentsSection entryId={ENTRY_ID} />
          </div>
        ) : (
          <>
            <OpenOnMount />
            <CommentsOverlay />
          </>
        )}
      </CommentsOverlayProvider>
    </AppShell>
  </Suspense>,
);
