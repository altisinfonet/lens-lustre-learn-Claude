/**
 * STORIES v2 — THE ONE STORY VIEWER (Owner, 6 Nov 2026: "go stories … exact
 * matching of your screen"). Feed row, profile, highlights and notifications
 * all open stories here; do not make a second viewer.
 *
 * Approved screens (pixel reference):
 *   _control/out/OWNER/stories-sample/approved-2026-11-06/new-2-viewer-phone.png
 *   …/new-3-own-phone.png · …/new-4-viewer-desktop.png
 * Every size, gap and colour below is copied from that prototype; a visual
 * change here needs the Owner's yes on a new screenshot.
 *
 * Phone: full black screen; the photo whole (object-contain) over a blurred
 * copy of itself; progress bars; tap right/left = next/previous, hold = pause,
 * swipe down = close, swipe sideways = next/previous person. Computer: the
 * story as a 9:16 card in the middle, previous / next person at the sides.
 * Comments float over the bottom like Facebook Live.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type TouchEvent as RTouchEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  X, MoreHorizontal, Pause, Play, Globe, Heart, Send, Eye, Star, Trash2, ChevronLeft, ChevronRight,
  ArrowUpRight, Users, MessageCircle, Image as ImageIcon,
} from "lucide-react";
import { memberPhotoSrc } from "@/lib/photoProtection";
import FeedVideoCard from "@/components/video/FeedVideoCard";
import { postMedia } from "@/lib/posts/subjectMedia";
import OptimizedImage from "@/components/OptimizedImage";
import { toast } from "@/hooks/core/use-toast";
import { logger } from "@/lib/logger";
import { fetchUserStories, type StoryComment, type StoryPerson, type StorySlide } from "@/lib/stories/storyData";
import {
  addStoryComment, deleteOwnStory, fetchOlderStoryComments, fetchStoryComments, fetchStoryViewers, markStorySeen, setStoryLike, slidesOf,
  type StoryViewerRow,
} from "@/lib/stories/storyViewerData";
import { STORY_RULES } from "@/lib/stories/storyRules";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { memberPath } from "@/lib/urlHelpers";
import StoryHighlightPicker from "./StoryHighlightPicker";
import { CommentFloatList } from "@/components/comments/CommentThread";

const FILE = "src/components/stories/StoryViewer.tsx";
const hf = { fontFamily: "var(--font-heading)" };
const HOLD_MS = 220;
const SWIPE_PX = 70;

/**
 * Handlers for a scrolling comment list (Owner 7 Nov: "700 comments"): reaching
 * the top (column-reverse: scrollTop goes negative upwards) loads older ones,
 * and a touch in the list never reaches the viewer's swipe-to-close.
 */
const scrollOlder = (onTop: () => void) => ({
  onTouchStart: (e: RTouchEvent) => e.stopPropagation(),
  onTouchEnd: (e: RTouchEvent) => e.stopPropagation(),
  onScroll: (e: { currentTarget: HTMLDivElement }) => {
    const el = e.currentTarget;
    if (el.scrollHeight + el.scrollTop - el.clientHeight < 24) onTop();
  },
});

export function storyAge(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
}

/** The thin bars at the top: done, running, waiting. */
export function StoryBars({ n, at, part }: { n: number; at: number; part: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
          <div className="h-full bg-white" style={{ width: i < at ? "100%" : i === at ? `${part}%` : "0%" }} />
        </div>
      ))}
    </div>
  );
}

interface FrameProps {
  person: StoryPerson;
  slide: StorySlide | null;
  count: number;
  at: number;
  part: number;
  desktop: boolean;
  paused: boolean;
  comments: StoryComment[];
  liked: boolean;
  onClose: () => void;
  onTogglePause: () => void;
  onMenu: () => void;
  onViewPost: () => void;
  onLike: () => void;
  onSend: (text: string) => void;
  onHighlight: () => void;
  onDelete: () => void;
  onInputFocus: (focused: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
  onHold: (held: boolean) => void;
  /** Owner 7 Nov: the owner taps 👁 / 💬 for the full lists */
  onOpenSheet: (which: "viewers" | "comments") => void;
  /** the floating comments reached their top: load older ones */
  onOlder: () => void;
  /** a panel drawn over this story (Seen by / All comments) */
  children?: ReactNode;
  /** a highlight is playing: its title in the header; no likes, comment box or Seen by */
  highlightTitle?: string;
}

/** One story on screen — phone full screen, or the computer's middle card. */
export function StoryFrame(p: FrameProps) {
  const { person, slide, desktop } = p;
  const own = person.isOwn;
  const story = slide?.story ?? null;
  // the one media decision (video, else photographs — never both)
  const media = postMedia({ video: slide?.video ?? null, image_urls: slide?.src ? [slide.src] : [] });
  const src = media.imageUrls[0] ? memberPhotoSrc(media.imageUrls[0], 1080) : null;
  const [text, setText] = useState("");
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);

  const down = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    held.current = false;
    holdTimer.current = window.setTimeout(() => { held.current = true; p.onHold(true); }, HOLD_MS);
  };
  const up = (dir: "prev" | "next") => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    if (held.current) { held.current = false; p.onHold(false); return; }
    if (dir === "prev") p.onPrev(); else p.onNext();
  };
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    p.onSend(t);
  };

  return (
    <div className={`relative overflow-hidden bg-black ${desktop ? "h-[820px] w-[461px] rounded-xl" : "h-full w-full"}`}>
      {src && (
        <div className="absolute inset-0 scale-110 bg-cover bg-center opacity-70 blur-2xl" style={{ backgroundImage: `url("${src}")` }} />
      )}
      {src && <OptimizedImage loading="eager" fetchPriority="high" src={src} alt="" className="absolute inset-0 h-full w-full object-contain" />}
      {media.video && (
        <div className="absolute inset-0 flex items-center">
          <FeedVideoCard video={media.video} fillParent className="h-full w-full" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/75 to-transparent" />

      {/* tap zones: left third back, the rest forward; hold = pause */}
      <div className="absolute inset-x-0 bottom-44 top-20 flex">
        <button type="button" aria-label="Previous" className="h-full w-1/3 cursor-default"
          onPointerDown={down} onPointerUp={() => up("prev")} onPointerLeave={() => holdTimer.current && window.clearTimeout(holdTimer.current)} />
        <button type="button" aria-label="Next" className="h-full w-2/3 cursor-default"
          onPointerDown={down} onPointerUp={() => up("next")} onPointerLeave={() => holdTimer.current && window.clearTimeout(holdTimer.current)} />
      </div>

      <div className="absolute inset-x-3 top-3 space-y-3">
        <StoryBars n={p.count} at={p.at} part={p.part} />
        <div className="flex items-center gap-2 text-white">
          {person.avatar ? (
            <OptimizedImage loading="eager" src={person.avatar} alt="" className="h-9 w-9 rounded-full border border-white/60 object-cover" />
          ) : (
            <div className="h-9 w-9 rounded-full border border-white/60 bg-white/20" />
          )}
          <p className="text-sm font-semibold" style={hf}>{p.highlightTitle ?? (own ? "Your story" : person.name)}</p>
          {story && p.highlightTitle === undefined && <span className="text-sm text-white/75">{storyAge(story.created_at)}</span>}
          {own ? <Users className="h-3.5 w-3.5 text-white/75" /> : <Globe className="h-3.5 w-3.5 text-white/75" />}
          <div className="ml-auto flex items-center gap-4">
            <button type="button" aria-label={p.paused ? "Play" : "Pause"} onClick={p.onTogglePause}>
              {p.paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
            </button>
            <button type="button" aria-label="More" onClick={p.onMenu}><MoreHorizontal className="h-5 w-5" /></button>
            {!desktop && <button type="button" aria-label="Close" onClick={p.onClose}><X className="h-6 w-6" /></button>}
          </div>
        </div>
      </div>

      <div className="absolute inset-x-4 bottom-4 space-y-3 text-white">
        <CommentFloatList comments={p.comments} on={scrollOlder(p.onOlder)} />
        {!own && story?.caption && <p className="text-[15px] font-medium drop-shadow">{story.caption}</p>}
        {story?.post_id && (
          <button type="button" onClick={p.onViewPost}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3.5 py-1.5 text-sm font-semibold backdrop-blur">
            <ImageIcon className="h-4 w-4" /> View post <ArrowUpRight className="h-4 w-4" />
          </button>
        )}
        {p.highlightTitle !== undefined ? (
          own && (
            <div className="flex justify-end pt-1 text-xs">
              <button type="button" onClick={p.onDelete} className="flex flex-col items-center gap-1"><Trash2 className="h-5 w-5" />Delete</button>
            </div>
          )
        ) : own ? (
          <div className="flex items-center justify-between pt-1">
            <span className="flex items-center gap-3 text-sm font-semibold">
              <button type="button" aria-label="Seen by" onClick={() => p.onOpenSheet("viewers")} className="flex items-center gap-1.5"><Eye className="h-5 w-5" />{story?.view_count ?? 0}</button>
              <span className="flex items-center gap-1.5"><Heart className="h-5 w-5" />{story?.like_count ?? 0}</span>
              <button type="button" aria-label="All comments" onClick={() => p.onOpenSheet("comments")} className="flex items-center gap-1.5"><MessageCircle className="h-5 w-5" />{story?.comment_count ?? 0}</button>
            </span>
            <div className="flex gap-5 text-xs">
              <button type="button" onClick={p.onHighlight} className="flex flex-col items-center gap-1"><Star className="h-5 w-5" />Highlight</button>
              <button type="button" onClick={p.onDelete} className="flex flex-col items-center gap-1"><Trash2 className="h-5 w-5" />Delete</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => p.onInputFocus(true)}
              onBlur={() => p.onInputFocus(false)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              maxLength={1000}
              placeholder="Add a comment…"
              aria-label="Add a comment"
              className="min-w-0 flex-1 rounded-full border border-white/60 bg-transparent px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/80"
            />
            <button type="button" aria-label={p.liked ? "Unlike" : "Like"} onClick={p.onLike}>
              <Heart className={`h-7 w-7 ${p.liked ? "fill-destructive text-destructive" : ""}`} />
            </button>
            <button type="button" aria-label="Send" onClick={send}><Send className="h-6 w-6" /></button>
          </div>
        )}
      </div>
      {p.children}
    </div>
  );
}

/** A panel over the story — Seen by / All comments (Owner 7 Nov). The story waits while it is open. */
function StorySheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex h-[70%] flex-col rounded-t-2xl bg-black/90 text-white backdrop-blur"
      onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-white/15 px-4 py-3">
        <p className="text-sm font-semibold" style={hf}>{title}</p>
        <button type="button" aria-label="Close list" onClick={onClose}><X className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
    </div>
  );
}

/** Everyone who saw the owner's story, newest first; more load at the end of the list. */
function SeenByList({ storyId, onOpenProfile }: { storyId: string; onOpenProfile: (handle: string | null) => void }) {
  const [rows, setRows] = useState<StoryViewerRow[] | null>(null);
  const [more, setMore] = useState(false);
  const busy = useRef(false);
  const load = useCallback(async (before?: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const page = await fetchStoryViewers(storyId, before);
      setRows((r) => [...(before ? r ?? [] : []), ...page]);
      setMore(page.length >= STORY_RULES.viewersPage);
    } catch { setRows((r) => r ?? []); setMore(false); }
    busy.current = false;
  }, [storyId]);
  useEffect(() => { void load(); }, [load]);
  if (rows === null) return <p className="text-sm text-white/70">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-white/70">Nobody has seen this story yet.</p>;
  return (
    <div className="space-y-3">
      {rows.map((v) => (
        <button key={v.viewer_id} type="button" onClick={() => onOpenProfile(v.custom_url)} className="flex w-full items-center gap-3 text-left">
          {v.avatar_url ? (
            <OptimizedImage loading="lazy" src={v.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-white/20" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{v.full_name || "Member"}</span>
          {v.liked && <Heart className="h-4 w-4 fill-destructive text-destructive" />}
          <span className="text-xs text-white/60">{storyAge(v.viewed_at)}</span>
        </button>
      ))}
      {more && (
        <button type="button" onClick={() => void load(rows[rows.length - 1].viewed_at)} className="w-full py-2 text-sm font-semibold text-white/80">
          Show more
        </button>
      )}
    </div>
  );
}

/** A neighbour's card at the side of the computer layout. */
function SideCard({ person, onClick }: { person: StoryPerson; onClick: () => void }) {
  const cover = memberPhotoSrc(person.cover, 600);
  return (
    <button type="button" onClick={onClick} aria-label={`${person.name}'s story`}
      className="relative h-[400px] w-[225px] flex-shrink-0 overflow-hidden rounded-xl opacity-60">
      {cover && <OptimizedImage loading="eager" src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 text-white">
        {person.avatar ? (
          <OptimizedImage loading="eager" src={person.avatar} alt="" className="h-14 w-14 rounded-full border-2 border-primary object-cover" />
        ) : (
          <div className="h-14 w-14 rounded-full border-2 border-primary bg-white/20" />
        )}
        <p className="text-sm font-semibold">{person.name}</p>
      </div>
    </button>
  );
}

function useIsDesktop(): boolean {
  const q = "(min-width: 1024px)";
  const [d, setD] = useState(() => typeof window !== "undefined" && window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setD(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return !!d;
}

export interface StoryViewerProps {
  people: StoryPerson[];
  startIndex: number;
  viewerId: string | null;
  onClose: () => void;
  /** a story was deleted / liked / seen — the opener refreshes its row */
  onChanged?: () => void;
  /** default: the person's live stories; highlights pass their own */
  loadSlides?: (person: StoryPerson) => Promise<StorySlide[]>;
  /** open on this story (a notification) */
  startStoryId?: string;
  /**
   * Owner 7 Nov: a highlight plays in this same viewer. Its slides come from
   * loadSlides; the address bar stays, nothing is marked seen, and the owner's
   * Delete removes the whole highlight.
   */
  highlight?: { title: string; onDelete: () => Promise<void> };
}

const defaultLoader = async (p: StoryPerson) => slidesOf(await fetchUserStories(p.userId));

export default function StoryViewer({ people, startIndex, viewerId, onClose, onChanged, loadSlides = defaultLoader, startStoryId, highlight }: StoryViewerProps) {
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const [pi, setPi] = useState(startIndex);
  const [slides, setSlides] = useState<StorySlide[]>([]);
  const [si, setSi] = useState(0);
  const [part, setPart] = useState(0);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const [typing, setTyping] = useState(false);
  const [picker, setPicker] = useState(false);
  const [comments, setComments] = useState<StoryComment[]>([]);
  const [likedLocal, setLikedLocal] = useState<Record<string, boolean>>({});
  const [sheet, setSheet] = useState<null | "viewers" | "comments">(null);
  const olderDone = useRef(false);
  const olderBusy = useRef(false);
  const firstOpen = useRef(true);
  const seen = useRef(new Set<string>());
  const touch = useRef<{ x: number; y: number } | null>(null);

  const person = people[pi];
  const slide = slides[si] ?? null;
  const story = slide?.story ?? null;
  const stopped = paused || holding || typing || picker || sheet !== null;

  // Owner 7 Nov: a story has its own address. While a story is on screen the
  // address bar shows /<handle>/stories/<id> — replaceState, so no extra Back
  // step and the router is not involved; App.tsx routes that address back here.
  // Closing puts the page's own address back.
  const openedAt = useRef(window.location.pathname + window.location.search + window.location.hash);
  const storyKey = highlight ? null : story?.id ?? null;
  const ownerId = person?.userId ?? null;
  useEffect(() => {
    if (!storyKey || !ownerId) return;
    let gone = false;
    void fetchProfileMap([ownerId]).then((m) => {
      const base = memberPath(m.get(ownerId)?.custom_url);
      if (!gone && base) window.history.replaceState(window.history.state, "", `${base}/stories/${storyKey}`);
    }).catch(() => { /* no handle: the address simply stays as it was */ });
    return () => { gone = true; };
  }, [storyKey, ownerId]);
  useEffect(() => () => {
    // a story address opened directly is left to the feed (it goes to /feed)
    if (!/\/stories\//.test(openedAt.current) && /\/stories\//.test(window.location.pathname)) {
      window.history.replaceState(window.history.state, "", openedAt.current);
    }
  }, []);

  // load the person's slides
  useEffect(() => {
    if (!person) return;
    let gone = false;
    setSlides([]);
    setSi(0);
    setPart(0);
    loadSlides(person).then((s) => {
      if (gone) return;
      if (s.length === 0) {
        if (pi < people.length - 1) setPi((i) => i + 1); else onClose();
        return;
      }
      setSlides(s);
      if (firstOpen.current && startStoryId) {
        const at = s.findIndex((x) => x.story.id === startStoryId);
        if (at > 0) setSi(at);
      }
      firstOpen.current = false;
    }).catch((err: unknown) => {
      logger.warn({ code: "STORY-6004", event: "STORY_LOAD_FAILED", fn: "StoryViewer", file: FILE,
        message: "A member's stories did not load in the viewer.", reason: err instanceof Error ? err.message : String(err),
        expected: "get_user_stories answers", actual: "error", nextStep: "Check get_user_stories on this lane." });
      if (!gone) onClose();
    });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pi]);

  // seen + comments + preload the next photo
  useEffect(() => {
    if (!slide || !person) return;
    if (!highlight && !person.isOwn && viewerId && !seen.current.has(slide.story.id)) {
      seen.current.add(slide.story.id);
      void markStorySeen(slide.story.id, viewerId).catch(() => {});
    }
    const next = slides[si + 1];
    if (next?.kind === "photo" && next.src) { const img = new Image(); img.src = memberPhotoSrc(next.src, 1080) ?? next.src; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide?.key]);

  const loadComments = useCallback(async (id: string) => {
    try {
      const c = await fetchStoryComments(id);
      olderDone.current = c.length < STORY_RULES.commentsShown;
      setComments(c);
    } catch { setComments([]); }
  }, []);
  /** Owner 7 Nov: scrolling to the top of the comments brings the older ones. */
  const loadOlder = useCallback(async () => {
    const first = comments[0];
    if (!story || !first || olderDone.current || olderBusy.current) return;
    olderBusy.current = true;
    try {
      const page = await fetchOlderStoryComments(story.id, first.created_at);
      olderDone.current = page.length < STORY_RULES.commentsShown;
      setComments((c) => [...page.filter((x) => !c.some((y) => y.id === x.id)), ...c]);
    } catch { olderDone.current = true; }
    olderBusy.current = false;
  }, [comments, story]);
  useEffect(() => {
    setSheet(null);
    if (story) void loadComments(story.id); else setComments([]);
  }, [story?.id, loadComments]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => {
    setPart(0);
    if (si < slides.length - 1) setSi((i) => i + 1);
    else if (pi < people.length - 1) setPi((i) => i + 1);
    else onClose();
  }, [si, slides.length, pi, people.length, onClose]);
  const prev = useCallback(() => {
    setPart(0);
    if (si > 0) setSi((i) => i - 1);
    else if (pi > 0) setPi((i) => i - 1);
  }, [si, pi]);

  // the timer: one animation frame loop, stopped while paused / held / typing
  useEffect(() => {
    if (!slide || stopped) return;
    let raf = 0;
    let last = performance.now();
    let done = (part / 100) * slide.durationMs;
    const tick = (t: number) => {
      done += t - last;
      last = t;
      const pct = Math.min(100, (done / slide.durationMs) * 100);
      setPart(pct);
      if (pct >= 100) { next(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide?.key, stopped]);

  // keys, and no page scroll behind the viewer
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (typing) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = overflow; };
  }, [next, prev, onClose, typing]);

  const liked = story ? (likedLocal[story.id] ?? story.i_liked) : false;
  const onLike = async () => {
    if (!story || !viewerId) return;
    const on = !liked;
    setLikedLocal((m) => ({ ...m, [story.id]: on }));
    try { await setStoryLike(story.id, viewerId, on); onChanged?.(); }
    catch { setLikedLocal((m) => ({ ...m, [story.id]: !on })); }
  };
  const onSend = async (text: string) => {
    if (!story || !viewerId) return;
    try {
      await addStoryComment(story, viewerId, text);
      await loadComments(story.id);
    } catch (err) {
      toast({ title: "Comment not sent", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    }
  };
  const onDelete = async () => {
    if (!story) return;
    if (highlight) {
      // the opener deletes, logs and tells the member; the viewer just closes
      await highlight.onDelete();
      onClose();
      return;
    }
    try {
      await deleteOwnStory(story.id);
      logger.info({ code: "STORY-6003", event: "STORY_DELETED", fn: "StoryViewer.onDelete", file: FILE,
        message: "Deleting the member's own story.", reason: "The database confirmed one deleted row and the screen was updated.",
        expected: "Exactly one story row deleted", actual: "1 row", recordId: story.id });
      toast({ title: "Story removed" });
      const left = slides.filter((s) => s.story.id !== story.id);
      onChanged?.();
      if (left.length === 0) { onClose(); return; }
      setSlides(left);
      setSi((i) => Math.min(i, left.length - 1));
      setPart(0);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const zero = reason === "Story could not be deleted.";
      // 2026-08-05 "unable to delete": a delete that matched zero rows is never invisible.
      logger.error({ code: zero ? "STORY-6001" : "STORY-6002", event: zero ? "STORY_DELETE_MATCHED_NO_ROWS" : "STORY_DELETE_FAILED",
        fn: "StoryViewer.onDelete", file: FILE, message: "Deleting the member's own story.", reason,
        expected: "Exactly one story row deleted", actual: zero ? "0 rows" : "database error", recordId: story.id,
        nextStep: "Check pg_policies for 'stories' and confirm the caller owns the row." });
      toast({ title: "Could not delete", description: "Please try again.", variant: "destructive" });
    }
  };
  const onViewPost = () => {
    if (!story?.post_id) return;
    onClose();
    navigate(`/post/${story.post_id}`);
  };
  const onMenu = () => {
    if (person?.isOwn) void onDelete();
    else if (person) {
      // F-95: a profile opens by its handle, never the id; no handle = stay here.
      const id = person.userId;
      void fetchProfileMap([id]).then((m) => {
        const to = memberPath(m.get(id)?.custom_url);
        if (to) { onClose(); navigate(to); }
      });
    }
  };

  const onTouchStart = (e: RTouchEvent) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e: RTouchEvent) => {
    const s = touch.current; touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (dy > SWIPE_PX && Math.abs(dy) > Math.abs(dx)) onClose();
    else if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      setPart(0);
      if (dx < 0 && pi < people.length - 1) setPi((i) => i + 1);
      else if (dx > 0 && pi > 0) setPi((i) => i - 1);
    }
  };

  const frame = person ? (
    <StoryFrame
      person={person} slide={slide} count={Math.max(1, slides.length)} at={si} part={part} desktop={desktop}
      paused={paused} comments={comments} liked={liked}
      onClose={onClose} onTogglePause={() => setPaused((x) => !x)} onMenu={onMenu} onViewPost={onViewPost}
      onLike={() => void onLike()} onSend={(t) => void onSend(t)} onHighlight={() => setPicker(true)} onDelete={() => void onDelete()}
      onInputFocus={setTyping} onPrev={prev} onNext={next} onHold={setHolding}
      onOpenSheet={setSheet} onOlder={() => void loadOlder()} highlightTitle={highlight?.title}
    >
      {sheet === "viewers" && story && (
        <StorySheet title={`Seen by ${story.view_count ?? 0}`} onClose={() => setSheet(null)}>
          <SeenByList storyId={story.id} onOpenProfile={(h) => { const to = memberPath(h); if (to) { onClose(); navigate(to); } }} />
        </StorySheet>
      )}
      {sheet === "comments" && story && (
        <StorySheet title={`Comments ${story.comment_count ?? comments.length}`} onClose={() => setSheet(null)}>
          {comments.length > 0
            ? <CommentFloatList comments={comments} tall on={scrollOlder(() => void loadOlder())} />
            : <p className="text-sm text-white/70">No comments yet.</p>}
        </StorySheet>
      )}
    </StoryFrame>
  ) : null;

  if (!person) return null;

  const body = desktop ? (
    <div className="fixed inset-0 z-[200] flex h-screen items-center justify-center gap-10 bg-neutral-950" role="dialog" aria-modal="true" data-state="open" aria-label="Story">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute right-6 top-6"><X className="h-7 w-7 text-white" /></button>
      {pi > 0 ? <SideCard person={people[pi - 1]} onClick={() => setPi(pi - 1)} /> : <div className="h-[400px] w-[225px] flex-shrink-0" />}
      <button type="button" aria-label="Previous story" onClick={prev}>
        <ChevronLeft className="h-10 w-10 rounded-full bg-white/15 p-2 text-white" />
      </button>
      {frame}
      <button type="button" aria-label="Next story" onClick={next}>
        <ChevronRight className="h-10 w-10 rounded-full bg-white/15 p-2 text-white" />
      </button>
      {pi < people.length - 1 ? <SideCard person={people[pi + 1]} onClick={() => setPi(pi + 1)} /> : <div className="h-[400px] w-[225px] flex-shrink-0" />}
      {picker && slide && <StoryHighlightPicker slide={slide} onDone={() => setPicker(false)} />}
    </div>
  ) : (
    <div className="fixed inset-0 z-[200] bg-black" role="dialog" aria-modal="true" data-state="open" aria-label="Story" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {frame}
      {picker && slide && <StoryHighlightPicker slide={slide} onDone={() => setPicker(false)} />}
    </div>
  );
  return createPortal(body, document.body);
}
