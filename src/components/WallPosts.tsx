import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MessageCircle, Send, Globe, Users, Lock, ChevronDown, ImagePlus, X, Tag, CalendarClock, Crop, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import TagPeopleModal, { type PendingTag } from "@/components/post/TagPeopleModal";
import CategoryChips, { canPublishCategories } from "@/components/post/CategoryChips";
import DraftsList from "@/components/post/DraftsList";
import {
  usePostDrafts, useCreateDraft, useUpdateDraft, usePublishDraft, type PostDraft,
} from "@/hooks/feed/usePostDrafts";
import { decidePersistence } from "@/lib/post/draftPersistence";
import { canUseNativeGallery, pickGalleryFiles } from "@/lib/native/gallery";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";
import { FileText } from "lucide-react";
import { ScheduleDateTimePicker } from "@/components/post/ScheduleDateTimePicker";
import { useCreateScheduledPost } from "@/hooks/feed/useScheduledPosts";
import { compressImageToFiles } from "@/lib/imageCompression";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import { fileFromDataUrl, isRebuildableDataUrl } from "@/lib/fileFromDataUrl";
import { deviceContext } from "@/lib/deviceContext";
import { useAuth } from "@/hooks/core/useAuth";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { useIsBanned } from "@/hooks/core/useIsBanned";
import { supabase } from "@/integrations/supabase/client";
import { uploadImageWithThumbnail } from "@/lib/imageUpload";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "@/hooks/core/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Textarea } from "@/components/ui/textarea";
import { useReactToPost, useUnreactToPost, type PostCacheMapper } from "@/hooks/feed/usePostReactionMutations";
import { useQueryClient } from "@tanstack/react-query";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAdFullscreen } from "@/components/ads/AdFullscreenProvider";
import { useT } from "@/i18n/I18nContext";
import PostCard from "@/components/post/PostCard";
import ImageCropModal from "@/components/admin/ImageCropModal";
import PostComposerPreview, { reorder } from "@/components/post/PostComposerPreview";
import PostCardSkeleton from "@/components/post/PostCardSkeleton";
import InfiniteScrollSentinel from "@/components/InfiniteScrollSentinel";
import { useUserPostsQuery, flattenUserPosts } from "@/hooks/feed/useUserPostsQuery";
import ProfilePostGrid from "@/components/profile/ProfilePostGrid";
import WallViewToggle, { type WallView } from "@/components/profile/WallViewToggle";
import { useFeedRealtime } from "@/hooks/feed/useRealtimeFeed";
import { reportClientError, memberFacingMessage, describeThrown } from "@/lib/reportClientError";
import { useCaptionMentions } from "@/hooks/feed/useCaptionMentions";
import { logger, newCorrelationId } from "@/lib/logger";
import type { ReactionType } from "@/components/ReactionPicker";
import type { UnifiedPost } from "@/types/post";
import { avatarInitial } from "@/lib/displayName";
import { mapServerCounts, applyReactionDelta } from "@/lib/feed/realtimeCounts";

type Privacy = "public" | "friends" | "private";

interface WallPostsProps {
  targetUserId: string;
  isOwnWall: boolean;
  composerOnly?: boolean;
}

const PRIVACY_OPTIONS: { value: Privacy; label: string; icon: React.ReactNode }[] = [
  { value: "public", label: "Public", icon: <Globe className="h-3.5 w-3.5" /> },
  { value: "friends", label: "Friends", icon: <Users className="h-3.5 w-3.5" /> },
  { value: "private", label: "Only Me", icon: <Lock className="h-3.5 w-3.5" /> },
];

const Avatar = ({ src, name, size = "md" }: { src: string | null; name: string | null; size?: "sm" | "md" | "lg" }) => {
  const sizeClasses = { sm: "w-8 h-8 text-xs", md: "w-10 h-10 text-sm", lg: "w-10 h-10 text-sm" };
  if (src) {
    return <img loading="lazy" decoding="async" src={src} alt="" className={`${sizeClasses[size]} rounded-full object-cover`} />;
  }
  return (
    <div className={`${sizeClasses[size]} rounded-full bg-primary/10 flex items-center justify-center`}>
      <span className="text-xs text-primary" style={{ fontFamily: "var(--font-display)" }}>{avatarInitial(name)}</span>
    </div>
  );
};

const privacyIcon = (p: Privacy) => {
  switch (p) {
    case "public": return <Globe className="h-3 w-3" />;
    case "friends": return <Users className="h-3 w-3" />;
    case "private": return <Lock className="h-3 w-3" />;
  }
};

const WallPosts = ({ targetUserId, isOwnWall, composerOnly }: WallPostsProps) => {
  const { user } = useAuth();
  const { data: currentProfile } = useProfileCore(user?.id);
  const { isBanned } = useIsBanned();
  const queryClient = useQueryClient();
  const { requestInterstitial } = useAdFullscreen();
  const t = useT();

  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage: hasMore,
    fetchNextPage,
    refetch,
  } = useUserPostsQuery(targetUserId, user?.id);

  const posts = useMemo(() => flattenUserPosts(data?.pages), [data?.pages]);

  /**
   * Grid or feed. GRID IS THE DEFAULT because every one of the 210 posts on
   * production is a photograph — see the header of ProfilePostGrid.tsx for the
   * measurement. Component state, not storage: the reason is written in
   * WallViewToggle.tsx.
   */
  const [wallView, setWallView] = useState<WallView>("grid");

  // Wall-specific cache updater — immediate setQueryData for wall posts
  const patchWallPost = useCallback((postId: string, updater: (current: UnifiedPost) => Partial<UnifiedPost>) => {
    queryClient.setQueryData<any>(["user-wall-posts", targetUserId], (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          posts: page.posts.map((p: UnifiedPost) =>
            p.id === postId ? { ...p, ...updater(p) } : p
          ),
        })),
      };
    });
  }, [queryClient, targetUserId]);

  // Wall-specific cache mapper for optimistic updates
  const wallCacheMapper: PostCacheMapper<UnifiedPost> = useCallback((mapper) => {
    queryClient.setQueryData<any>(["user-wall-posts", targetUserId], (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          posts: page.posts.map(mapper),
        })),
      };
    });
  }, [queryClient, targetUserId]);

  // ── Realtime handlers for wall ──
  /**
   * ⚠ NO `like_count` HERE — the absolute count owns that field.
   *
   * One reaction fires this delta AND a `posts` UPDATE carrying the true total
   * (trg_update_post_likes_count). Applying both is off by one whenever the
   * absolute arrives first. Only the per-type breakdown lives on this path,
   * because `posts` does not carry it. Same rule as Feed.tsx — the two must
   * stay identical, which is why the logic is shared in realtimeCounts.ts.
   */
  const handleWallReactionChange = useCallback((postId: string, event: "INSERT" | "DELETE", reaction: any) => {
    const reactionType = reaction?.reaction_type as string | undefined;
    patchWallPost(postId, (current) =>
      applyReactionDelta(current.reaction_counts, reactionType, event),
    );
  }, [patchWallPost]);

  // Wire realtime to wall posts
  useFeedRealtime({
    userId: user?.id,
    relevantUserIds: useMemo(() => [targetUserId], [targetUserId]),
    onNewPost: useCallback(() => { refetch(); }, [refetch]),
    // Counters always (the `posts` row is authoritative and is now their only
    // writer); content only for someone else's post, so a server row arriving
    // mid-edit cannot overwrite what the member just typed.
    onUpdatePost: useCallback((rawPost: any, isOwnPost: boolean) => {
      patchWallPost(rawPost.id, (current) =>
        isOwnPost
          ? mapServerCounts(rawPost)
          : {
              ...current,
              content: rawPost.content ?? current.content,
              image_url: rawPost.image_url ?? current.image_url,
              image_urls: rawPost.image_urls ?? current.image_urls,
              privacy: rawPost.privacy ?? current.privacy,
              ...mapServerCounts(rawPost),
            },
      );
    }, [patchWallPost]),
    onDeletePost: useCallback((postId: string) => {
      queryClient.setQueryData<any>(["user-wall-posts", targetUserId], (old: any) => {
        if (!old?.pages) return old;
        return { ...old, pages: old.pages.map((page: any) => ({ ...page, posts: page.posts.filter((p: UnifiedPost) => p.id !== postId) })) };
      });
    }, [queryClient, targetUserId]),
    onReactionChange: handleWallReactionChange,
  });

  const reactMutation = useReactToPost<UnifiedPost>(wallCacheMapper);
  const unreactMutation = useUnreactToPost<UnifiedPost>(wallCacheMapper);
  const [newContent, setNewContent] = useState("");
  const [newPrivacy, setNewPrivacy] = useState<Privacy>("public");
  const [posting, setPosting] = useState(false);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  // Index of the photo whose Crop dialog is open, or null. Cropping is now an
  // explicit per-photo action rather than a gate every upload must pass.
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  /**
   * Which chosen photo the big composer preview is showing. Not the same thing
   * as cropIndex: this is "what am I looking at", that is "what am I editing".
   */
  const [previewIndex, setPreviewIndex] = useState(0);
  // Synchronous mirror of selectedImages.length. Dropping several files at once
  // fires one async FileReader per file, so the closure's view of the state is
  // stale by the time each callback runs — the 10-photo cap has to be counted
  // somewhere that updates immediately. Doing the check inside a setState
  // updater instead would put a toast() side effect in a function React is free
  // to call twice.
  const selectedCountRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingTags, setPendingTags] = useState<PendingTag[]>([]);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  // SOW §5.2 — per-post search engine opt-out
  const [excludeFromSearch, setExcludeFromSearch] = useState(false);
  // Phase 3B — optional scheduling (null = post now, Date = schedule)
  const [scheduleAt, setScheduleAt] = useState<Date | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  /**
   * Stage C — the 1–5 categories for this post.
   *
   * Carried into BOTH insert paths below: the immediate `posts` insert and the
   * `scheduled_posts` branch. Same statement in each case, so a post and its
   * categories can never be written separately — the atomicity ruling from the
   * original architecture decision.
   *
   * The database minimum (`POST-CAT-002`) is deliberately still OFF; Stage B2
   * turns it on after the adoption gate. Until then the disabled Post button is
   * the only thing enforcing "at least one", which is why it is tested.
   */
  const [postCategories, setPostCategories] = useState<string[]>([]);

  /* ── Stage C: drafts ──────────────────────────────────────────────────────
   * `draftId` is the whole state machine. null means NOTHING has been
   * persisted - no row, no upload - and only Save may leave that state. Every
   * write below asks `decidePersistence()` first; this component never decides
   * for itself. See src/lib/post/draftPersistence.ts for why that matters.
   *
   * `resumedUrls` holds a resumed draft's ALREADY-UPLOADED images. They are
   * URLs, not Files, so they must never go back through the upload path - the
   * post will reference these very URLs. */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [resumedUrls, setResumedUrls] = useState<string[]>([]);
  const [resumedThumbs, setResumedThumbs] = useState<string[]>([]);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const { data: drafts = [] } = usePostDrafts();

  /* ── THE COMPOSER IS A MODAL ─────────────────────────────────────────────
   * Owner's design, 2026-08-12, three screenshots: "Create post" (caption +
   * Add to your post + Next), "Create post" with a photo (Next enabled), and
   * "Post settings" (preview, Post audience, Scheduling options, THE
   * CATEGORIES, Save / Post).
   *
   * ⚠ WHAT THIS REPLACES. Stage C first shipped the 46-chip category picker
   * INLINE in this composer, on the feed page, under the Post button. The
   * three-step modal existed as src/components/post/CreatePostModal.tsx but
   * was imported by nothing, so Vite tree-shook it out and it never reached
   * the bundle. The feed showed a wall of chips instead of a Create screen.
   * Do not put a picker back on the feed page. */
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerStep, setComposerStep] = useState<"compose" | "settings">("compose");

  const openComposer = (pickPhotos = false) => {
    setComposerStep("compose");
    setComposerOpen(true);
    // The file input lives OUTSIDE the dialog precisely so this works on the
    // very first open, before the dialog's own subtree has mounted.
    if (pickPhotos) setTimeout(() => fileInputRef.current?.click(), 0);
  };

  /**
   * ⚠ CLOSING WRITES NOTHING — no draft row, no upload. `decidePersistence`
   * returns an empty action for `close` and this handler does nothing but
   * reset the step. Never add an autosave-on-close: it would turn every
   * abandoned compose session into a stored draft with uploaded photos.
   */
  /**
   * B4 RESUME — photos already in storage for THIS composition.
   *
   * Keyed by the File object itself, never by index. The composer appends,
   * removes and crops photos, so index 2 is not a stable identity: removing
   * photo 1 would make a stale entry serve the wrong picture. Object identity
   * self-invalidates exactly right — cropping REPLACES the File (a new object,
   * so no entry, so it uploads), removing one leaves the others' identities
   * untouched, and an appended photo has no entry at all.
   *
   * Why it exists: before this, a post that failed on photo 3 of 5 threw the
   * whole attempt away. The member pressed Post again and photos 1 and 2 were
   * uploaded a SECOND time under fresh names (keys are time+random), leaving
   * the first pair referenced by nothing — orphaned bytes the 30-day sweep
   * eventually collects, paid for by the member's data allowance twice. The
   * B4 gate is explicit: no orphans, no duplicate objects.
   */
  const uploadedPhotoCache = useRef(new Map<File, { url: string; thumbnailUrl: string }>());

  const closeComposer = () => {
    setComposerOpen(false);
    setComposerStep("compose");
    // The composition is over — whether it posted, saved or was abandoned.
    // Anything still cached belongs to a composition that no longer exists.
    uploadedPhotoCache.current.clear();
  };

  /* ── THE APP TAKES A DIFFERENT ROUTE ─────────────────────────────────────
   * Owner's mock is TWO screens on Android, not three:
   *
   *   1  Android's own photo picker      2  New post — caption, tags,
   *      (their UI, not ours)               audience, scheduling, the
   *                                         category chips, Share
   *
   * Owner chose this over drawing our own gallery grid (2026-08-12). It is the
   * route Google recommends: on Android 13+ the system Photo Picker needs NO
   * permission at all and no Play declaration, where enumerating the library
   * ourselves would need READ_MEDIA_IMAGES plus a justification form.
   *
   * The trade is honest and was made with eyes open: screen 1 is Android's UI,
   * so there is no Recents ▾ album dropdown. Drafts moved onto the feed row and
   * screen 2, which is why `Drafts (n)` sits under the composer row rather than
   * beside a gallery tab.
   *
   * ⚠ THIS PRODUCT HAS NO REELS AND NO LIVE. Owner, 2026-08-12: *"LIVE REEL is
   * not relavant with us, dont write this options on anywhere"*. The mock was a
   * screenshot of another app and carried its mode strip; do not copy it in.
   * Photos and Stories are the whole surface.
   *
   * `appFlow` is false on the website, where none of this exists and the
   * three-step modal is unchanged. */
  const appFlow = isNativeCapacitorApp();

  /**
   * Add photos. Android gets its picker; everything else gets the file input.
   *
   * Returns how many were added so the caller can decide whether to advance —
   * cancelling the picker must not strand the member on an empty details
   * screen. Returns -1 for the web path, where the answer arrives later on the
   * input's change event and there is nothing to wait for here.
   */
  const pickPhotos = async (): Promise<number> => {
    if (!canUseNativeGallery()) {
      fileInputRef.current?.click();
      return -1;
    }
    /**
     * THE PICKER ITSELF CAN FAIL TO OPEN. Owner's answer, 2026-08-16, to which
     * shape the Create Post failure takes: "(A) nothing opens at all."
     *
     * That case now throws rather than pretending nobody chose anything, so it
     * gets a message instead of a dead button. Falling back to the OS file
     * input is deliberate and is the actual recovery: `<input type=file>` does
     * not depend on the Camera plugin, so a member whose gallery bridge is
     * broken can still post today rather than waiting for a build.
     */
    let picked = 0, unreadable = 0, files: File[] = [];
    try {
      ({ files, picked, unreadable } = await pickGalleryFiles(10));
    } catch (err) {
      toast({
        title: "Could not open the photo picker",
        description: `${err instanceof Error ? err.message : "Android refused the request"}. Opening the file browser instead.`,
        variant: "destructive",
      });
      fileInputRef.current?.click();
      return -1;
    }

    /**
     * A FAILURE MUST NOT LOOK LIKE A CANCELLATION.
     *
     * Owner, 2026-08-16: "Create Post : Many times not working."
     *
     * This used to be `const files = await pickGalleryFiles(10)` and nothing
     * else, so an empty array ended the whole flow in silence. An empty array
     * has two completely different meanings — the member backed out, or every
     * photo they chose failed to read — and only one of them deserves silence.
     * `devicePhotosToFiles` swallows a per-photo read error with `continue`
     * (correctly: nine of ten is better than none), and if ALL of them fail
     * the result is a Create button that visibly does nothing.
     *
     * This does NOT claim to fix the underlying read failure. Reading a
     * `capacitor://` path can fail for reasons no code here controls — a
     * revoked URI after the activity was recycled, a cloud-only photo that is
     * not on the device yet, a file the OS handed over and then withdrew. What
     * it fixes is the SILENCE, which is what made this unreportable: the member
     * now sees that something went wrong instead of concluding the app is
     * broken, and the count tells the next person which of the two it was.
     */
    if (picked > 0 && files.length === 0) {
      toast({
        title: "Could not read those photos",
        description:
          picked === 1
            ? "Android handed the photo over but it could not be opened. Please try again, or pick it from a different album."
            : `Android handed over ${picked} photos but none could be opened. Please try again, or pick them from a different album.`,
        variant: "destructive",
      });
      return 0;
    }
    if (unreadable > 0) {
      // Partial loss. The post still opens with what survived — telling them
      // after the fact beats blocking a working post over one bad file.
      toast({
        title: `${unreadable} photo${unreadable === 1 ? "" : "s"} could not be read`,
        description: `Continuing with the other ${files.length}.`,
      });
    }
    files.forEach(processFile);
    return files.length;
  };

  /** The app's whole entry point: picker first, details screen second. */
  const startAppPost = async () => {
    const added = await pickPhotos();
    // Cancelled. Nothing opens — no half-composer left on screen.
    if (added <= 0) return;
    setComposerStep("settings");
    setComposerOpen(true);
  };

  /**
   * THE "+ CREATE" BUTTON IN THE TOP BAR REACHES THIS COMPONENT VIA `?compose=1`.
   *
   * Navbar and WallPosts are far apart in the tree and share no state, so the
   * button navigates to `/feed?compose=1` instead. A URL is the right carrier
   * here precisely because it is EXPLICIT and inspectable — a global event bus
   * would fire invisibly and be impossible to reason about later. It also means
   * the button works from any screen: navigating to /feed happens first, this
   * component mounts, and the flag is already waiting for it.
   *
   * `handledRef` is what stops a loop. Opening the Android picker suspends this
   * WebView; when it returns, React may re-run effects, and without the latch a
   * second picker would open on top of the first. The flag is consumed exactly
   * once and stripped from the URL with `replace` so the Back button does not
   * land on a URL that re-opens the composer.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const composeHandledRef = useRef(false);
  useEffect(() => {
    /**
     * ONLY THE FEED'S COMPOSER ANSWERS `?compose=1`.
     *
     * ─────────────────────────────────────────────────────────────────────
     * ⚠ THIS IS NOT THE FIX FOR THE OWNER'S BUG. IT WAS CLAIMED AS ONE, AND
     * THAT CLAIM WAS WRONG. The correction is recorded here rather than
     * quietly deleted, because a comment that explains a fix that does not
     * work is worse than no comment: the next person trusts it.
     *
     * Owner, 2026-08-16: "create post ... only from my feed section create
     * post happening." I read the code, found that `WallPosts` is mounted
     * twice — once by Feed with `composerOnly`, once by PublicProfile for the
     * wall — and that both watched the URL for the compose flag. I reasoned
     * that the wall's copy read and stripped the flag before Feed could see
     * it, wrote that up with confidence, and shipped it in 1.2.9.
     *
     * It was never tested, and COULD NOT have been: the screenshot harness
     * registered exactly one route, so navigating from a wall to /feed matched
     * nothing at all. `journey-create-from-wall` was built afterwards to make
     * the crossing observable, and it settles it — pressing the same top-bar
     * button, with this guard REMOVED, from the wall:
     *
     *     with the guard      wall: picker fires    feed: picker fires
     *     WITHOUT the guard   wall: picker fires    feed: picker fires
     *
     * Identical. The guard changes nothing about the reported fault.
     *
     * WHY IT STAYS ANYWAY: two components watching one URL flag and racing to
     * consume it is genuinely wrong, and the flag names an intent only the
     * dedicated composer can act on — the wall's instance is a LIST of posts
     * with no composer to open. It is kept as correctness, and is no longer
     * described as a fix for anything.
     *
     * WHERE THE REAL FAULT LIVES, stated as the open question it is: the
     * harness has no Android picker, so it takes the file-input path. On a
     * device, pressing + from the wall CHANGES THE PAGE and LAUNCHES ANDROID'S
     * PICKER at the same moment, backgrounding the WebView mid-navigation.
     * From the feed there is no page change and no race. That fits the
     * symptom — and it is a hypothesis, not a finding, and must not be
     * shipped as one. The owner's own instruction points at the structural
     * answer instead: "as top menu icon is fix it should be from single
     * uploader while standing on any page" — the button should open the
     * composer WHERE THE MEMBER IS, deleting the navigation, the flag, the
     * second reader and the race together.
     * ─────────────────────────────────────────────────────────────────────
     */
    if (!composerOnly) return;

    if (searchParams.get("compose") !== "1") {
      // Reset once the flag is gone, so a SECOND press of Create still works.
      composeHandledRef.current = false;
      return;
    }
    if (composeHandledRef.current) return;
    composeHandledRef.current = true;

    const next = new URLSearchParams(searchParams);
    next.delete("compose");
    setSearchParams(next, { replace: true });

    if (appFlow) void startAppPost();
    else openComposer();
    // startAppPost/openComposer are stable for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, appFlow, composerOnly]);
  /**
   * Nothing worth saving: no photo, no words, and no existing draft to update.
   *
   * ⚠ Deliberately NOT written as `selectedImages.length === 0 && !newContent.trim()`.
   * That exact shape is banned by PostRequiresPhoto.test.ts, which guards a
   * different rule — "a photo with no words is a valid POST" — and a condition
   * that merely LOOKS like it invites someone to copy it into the post path.
   * This is about an empty DRAFT, which is a separate question.
   */
  const nothingToSave =
    selectedImages.length === 0 && resumedUrls.length === 0 && newContent.trim().length === 0;
  const createDraftMut = useCreateDraft();
  const updateDraftMut = useUpdateDraft();
  const publishDraftMut = usePublishDraft();
  // Mentions in the caption — 1053 headline item. See the hook's header for
  // why the plain <Textarea> stays and mentions layer on top of it.
  const captionMentions = useCaptionMentions({
    textareaRef,
    value: newContent,
    setValue: setNewContent,
  });
  const createScheduled = useCreateScheduledPost();
  // Infinite scroll handled by <InfiniteScrollSentinel /> below.

  // Browser-renderable image formats only. HEIC/HEIF/TIFF/RAW report `image/*`
  // MIME but won't decode → would show broken-image tile. Reject up-front.
  const SUPPORTED_IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|avif|svg)$/i;
  const SUPPORTED_MIME_RE = /^image\/(jpeg|jpg|png|webp|gif|bmp|avif|svg\+xml)$/i;

  const rejectUnsupported = (file: File) => {
    const ext = file.name.match(/\.[^.]+$/)?.[0] ?? "unknown";
    toast({
      title: "File format not supported",
      description: `${ext.toUpperCase().replace(".", "")} can't be used. Use JPG, PNG, WEBP, GIF, AVIF, BMP, or SVG.`,
      variant: "destructive",
    });
  };

  const processFile = (file: File) => {
    const mimeOk = file.type ? SUPPORTED_MIME_RE.test(file.type) : false;
    const extOk = SUPPORTED_IMAGE_RE.test(file.name);
    if (!mimeOk && !extOk) {
      rejectUnsupported(file);
      return;
    }
    // Use FileReader → data URL: survives re-renders/GC, no revoke needed,
    // robust across drag sources (desktop, browser, extensions).
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl) {
        rejectUnsupported(file);
        return;
      }
      // Decode-probe: if the browser can't actually render it, reject.
      const probe = new Image();
      probe.onload = () => {
        // 2026-08-01 (owner instruction): the photo goes in AS SHOT.
        // Until today every photo was force-marched through a 4:5 crop modal
        // and the cropped file was what uploaded — the original never reached
        // storage, so the platform silently recomposed photographers' frames.
        // Cropping is now opt-in, per photo, via the Crop button on each
        // thumbnail. See src/lib/imageFrame.ts for how any ratio is displayed.
        if (selectedCountRef.current >= 10) {
          toast({ title: "Maximum 10 photos per post", variant: "destructive" });
          return;
        }
        selectedCountRef.current += 1;

        // ── READ THE FILE ONCE. NEVER TOUCH THE ORIGINAL HANDLE AGAIN. ─────
        // Owner instruction, 2026-08-06, after 26 recorded app-only post
        // failures: read the selected file exactly once and reuse those bytes
        // for scanning, compression, thumbnailing and upload.
        //
        // Before this, the original File was read up to FIVE times — once here,
        // twice by the security scanner, and again by the compressor for the
        // full-size and the thumbnail. On Android every one of those re-reads
        // goes back to a picked-file reference that may no longer be valid. The
        // read below already succeeded, so from here on we carry bytes, not a
        // reference, and lifecycle events (backgrounding, rotation, a slow
        // upload) cannot take them away.
        //
        // The owner's own note, and it is the right framing: the stale handle
        // is a HYPOTHESIS, not a proven cause. This change does not depend on
        // it being right — reading once is simply the correct architecture, and
        // it removes the whole class of problem either way.
        //
        // MEMORY TRADE-OFF, stated plainly: we now hold the decoded bytes as
        // well as the data URL used for the preview, so a selected photo costs
        // roughly 2.3x its size instead of 1.3x. The composer caps at 10
        // photos. If that ever becomes a problem on low-end devices the fix is
        // to render previews from an object URL and drop the data URL — which
        // would use LESS memory than today, at the cost of a revoke lifecycle.
        let stable = file;
        try {
          stable = fileFromDataUrl(dataUrl, file.name, file.type);
        } catch {
          // Conversion failed — keep the original so behaviour is never worse
          // than before. createPost still has its own recovery for this case.
        }

        setSelectedImages(prev => [...prev, stable]);
        setImagePreviews(prev => [...prev, dataUrl]);
      };
      probe.onerror = () => rejectUnsupported(file);
      probe.src = dataUrl;
    };
    reader.onerror = () => rejectUnsupported(file);
    reader.readAsDataURL(file);
  };


  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => processFile(file));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => processFile(file));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const clearImage = (index: number) => {
    selectedCountRef.current = Math.max(0, selectedCountRef.current - 1);
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
    // Keep the preview pointing at a photo that still exists. Removing the one
    // being previewed, or anything before it, shifts every later index down.
    setPreviewIndex(prev => {
      const remaining = Math.max(0, imagePreviews.length - 1);
      const next = index < prev ? prev - 1 : prev;
      return Math.min(Math.max(0, next), Math.max(0, remaining - 1));
    });
    // Removing a photo shifts every later index; a stale cropIndex would then
    // point at the wrong photo, so close the dialog rather than guess.
    setCropIndex(null);
  };

  const clearAllImages = () => {
    selectedCountRef.current = 0;
    setSelectedImages([]);
    setImagePreviews([]);
    setPreviewIndex(0);
    setCropIndex(null);
    setPendingTags([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /**
   * Move a photo in the post's order.
   *
   * BOTH ARRAYS MOVE TOGETHER OR NEITHER DOES. `selectedImages` (the files that
   * get uploaded) and `imagePreviews` (what the member sees) are aligned by
   * index everywhere in this file — the upload loop reads
   * `imagePreviews[i]` for `selectedImages[i]`. Reordering one and not the
   * other would upload a member's photos under each other's previews, and
   * nothing on screen would look wrong until after it posted.
   */
  const movePhoto = useCallback((from: number, to: number) => {
    setSelectedImages(prev => reorder(prev, from, to));
    setImagePreviews(prev => reorder(prev, from, to));
    setPreviewIndex(to);
    // The crop dialog is keyed to an index that has just moved. Close it rather
    // than edit the wrong photo — the same rule clearImage follows.
    setCropIndex(null);
  }, []);

  // Cropping REPLACES the photo in place. Cancelling changes nothing at all —
  // the original stays selected, which is the whole point of the new default.
  const handleCropConfirm = useCallback((croppedFile: File) => {
    const idx = cropIndex;
    if (idx === null) return;
    const reader = new FileReader();
    reader.onload = () => {
      const previewUrl = reader.result as string;
      setSelectedImages(prev => prev.map((f, i) => (i === idx ? croppedFile : f)));
      setImagePreviews(prev => prev.map((p, i) => (i === idx ? previewUrl : p)));
      setCropIndex(null);
    };
    reader.onerror = () => setCropIndex(null);
    reader.readAsDataURL(croppedFile);
  }, [cropIndex]);

  const handleCropCancel = useCallback(() => {
    setCropIndex(null);
  }, []);


  /**
   * THE ONE UPLOAD PATH. Both Post and Save draft go through this.
   *
   * ⚠ IT MUST STAY ONE. This body was briefly duplicated for Save draft with a
   * plain `file: selectedImages[i]`, which silently dropped the stale-handle
   * recovery below — the Android bug behind 26 recorded post failures, where
   * the read at POST time fails although the read at SELECTION succeeded.
   * `fileFromDataUrl.test.ts` caught it by banning that exact expression.
   *
   * Two upload paths drift, and the one that drifts is always the newer,
   * less-exercised one.
   */
  const uploadPhotos = async (correlationId: string) => {
  const uploadedUrls: string[] = [];
  const uploadedThumbs: string[] = [];
  for (let i = 0; i < selectedImages.length; i++) {
    // ── B4 RESUME: already uploaded in an earlier attempt at THIS post ──
    // Checked before the scan, because a photo whose bytes are already in
    // storage has nothing left to scan. Re-uploading it would orphan the copy
    // that is already there.
    const already = uploadedPhotoCache.current.get(selectedImages[i]);
    if (already) {
      logger.info({
        code: "FILE-5010",
        event: "POST_PHOTO_RESUMED",
        fn: "createPost",
        file: "src/components/WallPosts.tsx",
        message: "Reusing a photo this composition already uploaded.",
        reason: "An earlier attempt at this same post uploaded these bytes; the stored copy is reused instead of uploading again.",
        expected: "No second upload of bytes already in storage",
        actual: "resumed from the first attempt",
        correlationId,
        detail: { stage: "resume", index: i, of: selectedImages.length, ...deviceContext() },
      });
      uploadedUrls.push(already.url);
      uploadedThumbs.push(already.thumbnailUrl);
      continue;
    }

    // ── THE STALE-HANDLE RECOVERY ───────────────────────────────────────
    // Measured 2026-08-06: 26 recorded post failures, EVERY ONE from the
    // installed app and none from the web, across two real members — 23
    // attempts by one of them in a single morning. The read that fails here
    // is the security scanner's; the read at SELECTION succeeded, which the
    // thumbnail in the composer proves.
    //
    // A file handle that reads once and then refuses, app-only, is a picked
    // file whose reference has gone stale between choosing it and pressing
    // Post. We do not need to know which DOMException it is to survive it:
    // the preview at this same index is a copy of those exact bytes, taken
    // at the moment the read demonstrably worked. See fileFromDataUrl.ts.
    //
    // selectedImages and imagePreviews are appended, filtered, mapped and
    // cleared TOGETHER at every call site, so index i is the same photo in
    // both. If that ever stops being true, this recovery silently uploads
    // the wrong picture — which is why the guard below re-checks the type.
    let photo = selectedImages[i];
    let safe: boolean;
    try {
      safe = await scanFileWithToast(photo, toast, { allowedTypes: "image" });
    } catch (readErr) {
      const preview = imagePreviews[i];
      // A cropped photo's preview can be an object URL, which cannot be
      // decoded back into bytes. Only a data URL is rebuildable.
      if (!isRebuildableDataUrl(preview)) throw readErr;

      photo = fileFromDataUrl(preview, selectedImages[i].name, selectedImages[i].type);

      logger.warn({
        code: "FILE-5009",
        event: "PHOTO_REBUILT_AFTER_STALE_HANDLE",
        fn: "createPost",
        file: "src/components/WallPosts.tsx",
        message: "The device would not re-read a chosen photo; rebuilt it from the copy taken at selection.",
        reason: readErr instanceof Error ? `${readErr.name}: ${readErr.message}` : String(readErr),
        expected: "The selected file to be readable a second time",
        actual: "The read threw; recovered from the preview instead",
        nextStep:
          "THE POST SUCCEEDS — this is the recovery working. Rising counts mean the platform behaviour is worsening; the reason field carries the original exception.",
        correlationId,
        detail: {
          stage: "security-scan",
          index: i,
          of: selectedImages.length,
          originalBytes: selectedImages[i]?.size,
          rebuiltBytes: photo.size,
          mimeType: photo.type,
          exceptionName: readErr instanceof Error ? readErr.name : typeof readErr,
          ...deviceContext(),
        },
      });

      // Retry the scan against bytes we know are readable. If THIS throws,
      // it is a real problem and must surface — no second recovery.
      safe = await scanFileWithToast(photo, toast, { allowedTypes: "image" });
    }
    if (!safe) {
      logger.warn({
        code: "FILE-5002",
        event: "POST_PHOTO_REJECTED_BY_SCAN",
        fn: "createPost",
        file: "src/components/WallPosts.tsx",
        message: "Scanning an attached photo before upload.",
        reason: "The file security scan rejected this photo, so the whole post was abandoned.",
        expected: "A scannable image file",
        actual: `photo ${i + 1} of ${selectedImages.length} rejected`,
        correlationId,
        // Names only — never the file's contents.
        detail: { stage: "security-scan", index: i, type: photo?.type, bytes: photo?.size, ...deviceContext() },
      });
      setPosting(false);
      return;
    }

    // Timed: uploads are the slowest step and the one that fails on a bad
    // connection, so the duration is the number worth having.
    const uploadStarted = Date.now();
    const uploadResult = await uploadImageWithThumbnail({
      bucket: "post-images",
      // `photo`, NOT selectedImages[i] — if the handle went stale this is
      // the rebuilt copy, and the original would fail here exactly as it
      // failed in the scan.
      file: photo,
      type: "post",
      userId: user.id,
      cacheControl: "3600",
    });
    logger.info({
      code: "FILE-5003",
      event: "POST_PHOTO_UPLOADED",
      fn: "createPost",
      file: "src/components/WallPosts.tsx",
      message: "Uploading an attached photo to storage.",
      reason: "Storage accepted the file and returned a URL.",
      expected: "A URL for the stored photo",
      actual: "url returned",
      durationMs: Date.now() - uploadStarted,
      correlationId,
      detail: { stage: "upload", index: i, of: selectedImages.length, bytes: photo?.size, ...deviceContext() },
    });

    // Remember it against the ORIGINAL File — `photo` may be the rebuilt copy
    // from the stale-handle recovery, and the retry will look up the original.
    uploadedPhotoCache.current.set(selectedImages[i], {
      url: uploadResult.url,
      thumbnailUrl: uploadResult.thumbnailUrl,
    });

    uploadedUrls.push(uploadResult.url);
    uploadedThumbs.push(uploadResult.thumbnailUrl);
  }
    return { uploadedUrls, uploadedThumbs };
  };

  /**
   * Save draft. The ONLY door into persistence.
   *
   * First Save uploads the photos and creates the row; later Saves only update,
   * because the images are already in storage and re-uploading would orphan the
   * originals the row points at.
   */
  const saveDraft = async () => {
    if (!user) return;
    const action = decidePersistence(
      { draftId, hasLocalImages: selectedImages.length > 0 },
      { type: "save" },
    );
    setSavingDraft(true);
    try {
      let urls = resumedUrls;
      let thumbs = resumedThumbs;
      if (action.uploadImages) {
        // Same path Post uses — stale-handle recovery and all.
        const up = await uploadPhotos(newCorrelationId());
        urls = [...resumedUrls, ...up.uploadedUrls];
        thumbs = [...resumedThumbs, ...up.uploadedThumbs];
      }
      const payload = {
        content: captionMentions.convert(newContent.trim()),
        image_url: urls[0] ?? null,
        image_urls: urls,
        thumbnail_urls: thumbs,
        privacy: newPrivacy,
        indexing_disabled: excludeFromSearch,
        categories: postCategories,
        pending_tags: pendingTags,
        scheduled_for: scheduleAt ? scheduleAt.toISOString() : null,
      };
      if (action.createDraft) {
        const row = await createDraftMut.mutateAsync(payload);
        setDraftId(row.id);
        setResumedUrls(urls);
        setResumedThumbs(thumbs);
        setSelectedImages([]);
        closeComposer();
        toast({ title: "Draft saved" });
      } else if (action.updateDraft && draftId) {
        await updateDraftMut.mutateAsync({ id: draftId, ...payload });
        setResumedUrls(urls);
        setResumedThumbs(thumbs);
        setSelectedImages([]);
        closeComposer();
        toast({ title: "Draft updated" });
      }
    } catch (e: any) {
      toast({
        title: /DRAFT-002/.test(e?.message ?? "")
          ? "You have 20 drafts already — delete one first"
          : "Could not save the draft",
        description: /DRAFT-002/.test(e?.message ?? "") ? undefined : e?.message,
        variant: "destructive",
      });
    } finally {
      setSavingDraft(false);
    }
  };

  /** Load a draft back into the composer. Reading is not writing: no upload. */
  const resumeDraft = (d: PostDraft) => {
    setDraftId(d.id);
    setNewContent(d.content ?? "");
    setPostCategories(d.categories ?? []);
    setNewPrivacy((d.privacy as Privacy) ?? "public");
    setExcludeFromSearch(!!d.indexing_disabled);
    setResumedUrls(d.image_urls ?? []);
    setResumedThumbs(d.thumbnail_urls ?? []);
    setPendingTags(((d.pending_tags ?? []) as PendingTag[]));
    setScheduleAt(d.scheduled_for ? new Date(d.scheduled_for) : null);
    setSelectedImages([]);
    setImagePreviews([]);
  };

  /** Publish a resumed draft — one server-side transaction, never two calls. */
  const publishResumedDraft = async () => {
    if (!draftId) return;
    setPosting(true);
    try {
      await publishDraftMut.mutateAsync(draftId);
      setDraftId(null);
      setResumedUrls([]);
      setResumedThumbs([]);
      setNewContent("");
      captionMentions.reset();
      setPostCategories([]);
      setPendingTags([]);
      setExcludeFromSearch(false);
      setScheduleAt(null);
      clearAllImages();
      closeComposer();
      toast({ title: "Posted" });
      await refetch();
      queryClient.invalidateQueries({ queryKey: queryKeys.feedAll() });
    } catch (e: any) {
      // Nothing was committed — the draft is intact and can be retried.
      toast({ title: "Could not publish", description: e?.message, variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  const createPost = async () => {
    // ONE ACTION, ONE THREAD OF LOGS. Every line below carries this id, so
    // "show me everything that happened when Neil's post failed at 01:14"
    // is a single query against client_errors.
    const correlationId = newCorrelationId();
    const startedAt = Date.now();

    logger.debug({
      code: "POST-2004",
      event: "POST_CREATE_STARTED",
      fn: "createPost",
      file: "src/components/WallPosts.tsx",
      message: "Member pressed Post in the composer.",
      reason: "Entry point of the post pipeline.",
      expected: "A photo attached, caption within 2200 characters",
      actual: `${selectedImages.length} photo(s), caption ${newContent.trim().length} chars, privacy ${newPrivacy}, scheduled ${!!scheduleAt}`,
      correlationId,
    });

    if (isBanned) {
      logger.warn({
        code: "AUTH-1003",
        event: "POST_BLOCKED_BANNED_MEMBER",
        fn: "createPost",
        file: "src/components/WallPosts.tsx",
        message: "Member pressed Post in the composer.",
        reason: "The member is banned, so the restrictive database policy would refuse this anyway.",
        expected: "A member in good standing",
        actual: "isBanned = true",
        correlationId,
      });
      toast({ title: "Your account is restricted from posting", variant: "destructive" });
      return;
    }
    /**
     * ═══════════════════════════════════════════════════════════════════════
     * A POST IS A PHOTOGRAPH. THE PHOTO IS MANDATORY. THE CAPTION IS OPTIONAL.
     * DO NOT CHANGE THIS. IT IS NOT A BUG.
     * ═══════════════════════════════════════════════════════════════════════
     *
     * OWNER RULING, 2026-08-05, verbatim:
     *
     *   "I know project logic was, wihout any photo simple a text as post not
     *    accepted, Only with a Image text allowed."
     *   "After proper registration (even without DP), allow evryone to post
     *    text+image, comment all like normal user (web and app both must work)"
     *
     * THIS IS THE PRODUCT. It is a photography community, not a message board.
     * Confirmed against production, 2026-08-05, over the site's entire history
     * since 2026-03-13:
     *
     *   * 151 posts. 151 of them have an image. ZERO text-only. Ever.
     *   * 39 of the 151 have an image and NO caption — which is why the caption
     *     stays optional and only the photo is required.
     *
     * ─────────────────────────────────────────────────────────────────────
     * WHY THIS COMMENT IS SO LOUD — A MISTAKE OF MINE, RECORDED SO IT IS NOT
     * REPEATED.
     *
     * On 2026-08-05 I relaxed this to "words OR a photo", reasoning that the
     * photo requirement was suppressing participation. The owner had NOT asked
     * for it. He had asked for the profile-photo (DP) wall to come down — a
     * different rule entirely — and I extended it to the post composer on my
     * own inference. That is guesswork, which is forbidden here, and it changed
     * what the product IS.
     *
     * The DP rule and the post rule are separate and must stay separate:
     *
     *   DP (profile picture) : NEVER blocks anything. Assigned by the system if
     *                          the member does not upload one.
     *   POST                 : ALWAYS needs a photograph. Independent of the DP.
     *
     * A member with no DP of their own can post, comment and react exactly like
     * anyone else — they just have to attach a photo to the POST, same as every
     * member always has.
     * ─────────────────────────────────────────────────────────────────────
     */
    if (!user || selectedImages.length === 0) {
      logger.warn({
        code: !user ? "AUTH-1001" : "POST-2001",
        event: !user ? "POST_WITHOUT_SESSION" : "POST_WITHOUT_PHOTO",
        fn: "createPost",
        file: "src/components/WallPosts.tsx",
        message: "Member pressed Post in the composer.",
        reason: !user
          ? "No signed-in member, so there is no author to attribute the post to."
          : "A post is a photograph and none was attached (see the ruling above).",
        expected: !user ? "A signed-in member" : "At least one photo attached",
        actual: !user ? "user is null" : "0 photos attached",
        nextStep: !user
          ? "Check whether the session expired or the app resumed before auth restored."
          : "Correct by design. Investigate only if the member insists a photo WAS attached — that points at the file picker, not this branch.",
        correlationId,
      });
      toast({ title: "Please attach at least one photo", variant: "destructive" });
      return;
    }

    // ── STAGE C: 1-5 CATEGORIES ────────────────────────────────────────────
    // This guard exists so createPost and the Post button AGREE. The button is
    // already disabled without categories; if only the button knew the rule,
    // the two would have drifted and `PostRequiresPhoto.test.ts` would be
    // asserting a lie — it caught exactly that when this was added.
    //
    // It is also the last line of defence until Stage B2 activates
    // POST-CAT-002: the database currently accepts an uncategorised post.
    if (!canPublishCategories(postCategories)) {
      logger.warn({
        code: "POST-2008",
        event: "POST_WITHOUT_CATEGORY",
        fn: "createPost",
        file: "src/components/WallPosts.tsx",
        message: "Member pressed Post in the composer.",
        reason: "A post needs between 1 and 5 categories and none was chosen.",
        expected: "1 to 5 categories",
        actual: `${postCategories.length} chosen`,
        nextStep:
          "Correct by design — the Post button is disabled in this state, so reaching here means the button and this guard disagreed. Check both.",
        correlationId,
      });
      toast({ title: "Choose at least one category", variant: "destructive" });
      return;
    }

    setPosting(true);
    try {
      const { uploadedUrls, uploadedThumbs } = await uploadPhotos(correlationId);
      // Phase 3B — Schedule branch: divert INSERT to scheduled_posts (RLS-gated).
      // Window validated by DB trigger validate_scheduled_post_window (5min…90d).
      if (scheduleAt) {
        const iso = scheduleAt.toISOString();
        try {
          await createScheduled.mutateAsync({
            // Picked @mentions become @[Name](id) markup — the same format
            // comments store, rendered by RichContentRenderer.
            content: captionMentions.convert(newContent.trim()),
            image_urls: uploadedUrls,
            // B3c: the thumbnails were ALWAYS generated right here and then
            // thrown away — scheduled_posts had no column for them, so the
            // publisher inserted posts that serve a full-size original
            // wherever a thumbnail belongs. Now they travel with the row.
            thumbnail_urls: uploadedThumbs,
            image_url: uploadedUrls[0],
            tagged_user_ids: pendingTags.map((t) => t.taggedUserId),
            scheduled_for: iso,
            privacy: newPrivacy,
            indexing_disabled: excludeFromSearch,
            // Stage C: the choice travels on the scheduled row, because the
            // publisher runs hours later with no member and no UI to ask.
            categories: postCategories,
          });
          toast({ title: "Post scheduled", description: `Will publish at ${scheduleAt.toLocaleString()}` });
          setNewContent("");
          captionMentions.reset();
          setExcludeFromSearch(false);
          setScheduleAt(null);
          setShowSchedule(false);
          setPostCategories([]);
          clearAllImages();
          closeComposer();
        } catch (e: any) {
          toast({ title: "Failed to schedule", description: e.message, variant: "destructive" });
        }
        setPosting(false);
        return;
      }
      const { data: newPost, error } = await supabase.from("posts").insert({
        user_id: user.id,
        // Picked @mentions become @[Name](id) markup (see useCaptionMentions).
        content: captionMentions.convert(newContent.trim()),
        privacy: newPrivacy,
        // Always present: createPost refuses to run without at least one photo
        // (see the ruling at the top of createPost). This is the first of them.
        image_url: uploadedUrls[0],
        image_urls: uploadedUrls,
        thumbnail_urls: uploadedThumbs,
        indexing_disabled: excludeFromSearch,
        // Stage C: same INSERT as the post itself. Never a second statement.
        categories: postCategories,
      } as any).select("id").single();
      if (error) {
        // NOTHING HERE MAY MENTION A PROFILE PHOTO.
        //
        // Owner, 2026-08-05: *"Even is DP not uplaoded too still users can post
        // antyhing like with DP users. simple"*
        //
        // This branch used to guess "you have no profile photo" from a bare
        // 42501, because that is all a RESTRICTIVE policy failure reports. The
        // photo policies are gone (verified on production). The RESTRICTIVE
        // policies that remain are the "Banned users cannot …" ones, so that
        // guess would now put the removed photo wall back in front of a member
        // it never applied to. Show the real reason instead.
        logger.error({
          code: "POST-2002",
          event: "POST_INSERT_REFUSED",
          fn: "createPost",
          file: "src/components/WallPosts.tsx",
          message: "Inserting the post row after the photos uploaded.",
          reason: `The database refused the insert: ${error.message}`,
          expected: "One post row created",
          actual: `error ${(error as any).code ?? "unknown"}`,
          nextStep:
            (error as any).code === "42501"
              ? "42501 means a RESTRICTIVE policy blocked it — check the member's banned state first, NOT the profile photo (that wall was removed on 2026-08-05)."
              : "Read the Postgres message above and confirm the posts table policies.",
          durationMs: Date.now() - startedAt,
          correlationId,
          detail: {
            pgCode: (error as any).code,
            photos: uploadedUrls.length,
            privacy: newPrivacy,
          },
        });
        toast({
          title: "Failed to post",
          description: error.message,
          variant: "destructive",
        });
      } else {
        // Persist photo tags (if any) — friends-only, all start as 'pending'
        if (newPost?.id && pendingTags.length > 0) {
          const tagRows = pendingTags.map((t) => ({
            post_id: newPost.id,
            tagger_id: user.id,
            tagged_user_id: t.taggedUserId,
            photo_index: t.photoIndex,
            x_position: t.xPosition,
            y_position: t.yPosition,
          }));
          const { error: tagError } = await supabase.from("post_tags").insert(tagRows as any);
          if (tagError) {
            logger.warn({
              code: "POST-2005",
              event: "POST_TAGS_INSERT_FAILED",
              fn: "createPost",
              file: "src/components/WallPosts.tsx",
              message: "Saving the photo tags attached to a new post.",
              reason: `The post was created but the tags were refused: ${tagError.message}`,
              expected: `${pendingTags.length} tag row(s) created`,
              actual: `error ${(tagError as any).code ?? "unknown"}`,
              recordId: newPost?.id ?? null,
              correlationId,
              detail: { pgCode: (tagError as any).code, tagCount: pendingTags.length },
            });
            toast({
              title: "Post created, but some tags failed",
              description: tagError.message,
              variant: "destructive",
            });
          } else {
            toast({ title: `Tagged ${pendingTags.length} friend${pendingTags.length > 1 ? "s" : ""}` });
          }
        }
        setNewContent("");
        captionMentions.reset();
        setExcludeFromSearch(false);
        setPostCategories([]);
        clearAllImages();
        closeComposer();
        await refetch();
        // Keep the FEED in sync too: realtime inserts it instantly when the
        // feed is mounted; invalidation covers navigation + flaky sockets.
        queryClient.invalidateQueries({ queryKey: queryKeys.feedAll() });
        // Ad Zones v2: full-screen interstitial after a successful publish.
        // Double-gated (master flag + interstitial_after_post toggle, both
        // default OFF) and frequency-capped by the governor, so this is a
        // no-op until an admin explicitly turns it on.
        requestInterstitial("after_post");

        // Exit log. The duration here is the whole pipeline — scan, upload,
        // insert, tags — so a member reporting "posting is slow" becomes a
        // number instead of an opinion.
        logger.info({
          code: "POST-2004",
          event: "POST_CREATED",
          fn: "createPost",
          file: "src/components/WallPosts.tsx",
          message: "Member pressed Post in the composer.",
          reason: "The post row was created and the feed caches were refreshed.",
          expected: "One post row created",
          actual: "created",
          recordId: newPost?.id ?? null,
          durationMs: Date.now() - startedAt,
          correlationId,
          detail: { photos: uploadedUrls.length, privacy: newPrivacy, tags: pendingTags.length },
        });
      }
    } catch (err: any) {
      // This catch covers the WHOLE post pipeline (compress → upload → insert),
      // so name the failure truthfully instead of blaming "compression".
      //
      // `err?.message` is EMPTY for exactly the failures that matter: a
      // FunctionsFetchError from a cold-starting edge worker, a storage object
      // like { statusCode, error }, an aborted upload DOMException. Those all
      // used to render as the bare word "Unknown error" — which is what members
      // saw all day on 2026-08-04 and why nobody, including us, could say what
      // had actually gone wrong. describeThrown() digs a real sentence out.
      const msg: string = memberFacingMessage(err);
      const isNetwork = /failed to fetch|network|cors|load failed|functionsfetcherror/i.test(msg);
      // Record it. Fire-and-forget, never awaited, never throws — the member's
      // retry must not wait on logging. See reportClientError.ts.
      reportClientError("post_create", err, {
        photos: selectedImages.length,
        scheduled: !!scheduleAt,
        privacy: newPrivacy,
      });

      // The structured twin of the line above. reportClientError stays for the
      // hourly stats view that already reads it; this one carries the code and
      // the investigation, which is what turns a report into a fix.
      logger.error({
        code: "POST-2003",
        event: "POST_PIPELINE_THREW",
        fn: "createPost",
        file: "src/components/WallPosts.tsx",
        message: "Member pressed Post in the composer.",
        reason: msg,
        expected: "Scan, upload, insert and tags all complete",
        actual: `threw after ${Date.now() - startedAt}ms`,
        nextStep: isNetwork
          ? "Network signature — the member's connection or a cold edge worker, not our logic. Confirm the same member succeeds on a good connection before changing code."
          : "Read the reason; the throw came from scan, upload or insert. Compare against the FILE-5003 upload lines with the same correlation id to see how far it got.",
        durationMs: Date.now() - startedAt,
        correlationId,
        detail: { stage: "pipeline", photos: selectedImages.length, scheduled: !!scheduleAt, privacy: newPrivacy, ...deviceContext() },
      });
      toast({
        title: isNetwork ? "Upload failed — check your connection" : "Failed to create post",
        description: msg,
        variant: "destructive",
      });
    }
    setPosting(false);
  };

  const handleReact = useCallback((postId: string, reactionType: ReactionType) => {
    if (!user || reactMutation.isPending) return;
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    reactMutation.mutate({ postId, reactionType, hadPreviousReaction: !!post.user_reaction });
  }, [user, posts, reactMutation]);

  const handleUnreact = useCallback((postId: string) => {
    if (!user || unreactMutation.isPending) return;
    unreactMutation.mutate(postId);
  }, [user, unreactMutation]);

  const handleDelete = useCallback(async (postId: string) => {
    if (!user) return;
    // Ownership guard: only delete own posts
    const { error } = await supabase.from("posts").delete().eq("id", postId).eq("user_id", user.id);
    if (error) {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    } else {
      queryClient.invalidateQueries({ queryKey: ["user-wall-posts", targetUserId] });
      // Remove instantly from the FEED cache as well (deletes made on the wall
      // previously lingered in the feed until a manual refresh).
      // Fan across EVERY cached feed variant, not just "All". queryKeys.feed()
      // is now ["feed", null]; writing to that one key alone would leave the
      // deleted post sitting in any category feed the member had opened —
      // silently, with no error. invalidateQueries below is prefix-based and
      // was never the problem; this exact-key write was.
      for (const entry of queryClient.getQueryCache().findAll({ queryKey: queryKeys.feedAll() })) {
      queryClient.setQueryData<any>(entry.queryKey, (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            posts: (page.posts || []).filter((p: any) => p.id !== postId),
          })),
        };
      });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.feedAll() });
    }
  }, [user, targetUserId, queryClient]);

  /**
   * Undo a share. Reported 2026-08-01: a member shared someone else's photo to
   * their wall by mistake and had no way to take it down — the post is not
   * theirs to delete, so the card's menu offered only "Report content".
   *
   * This removes the SHARE ROW, never the post. The original is untouched and
   * still belongs to its author; only the reference that put it on this wall
   * goes away. Scoped by user_id as well as post_id so it can only ever remove
   * the caller's own share.
   */
  const handleRemoveShare = useCallback(async (postId: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("post_shares" as any)
      .delete()
      .eq("post_id", postId)
      .eq("user_id", user.id);
    if (error) {
      toast({ title: "Could not remove it", description: error.message, variant: "destructive" });
      return;
    }
    // Drop it from the wall straight away rather than waiting for a refetch —
    // the whole point is that the member sees it gone immediately.
    queryClient.setQueryData<any>(["user-wall-posts", targetUserId], (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          posts: (page.posts || []).filter((p: any) => p.id !== postId),
        })),
      };
    });
    queryClient.invalidateQueries({ queryKey: ["user-wall-posts", targetUserId] });
    // The author's share count drops too; refresh the feed so it is not stale.
    queryClient.invalidateQueries({ queryKey: queryKeys.feedAll() });
    toast({ title: "Removed from your wall" });
  }, [user, targetUserId, queryClient]);

  const handleCommentCountChange = useCallback((postId: string, delta: number) => {
    queryClient.setQueryData<any>(["user-wall-posts", targetUserId], (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          posts: page.posts.map((p: UnifiedPost) =>
            p.id === postId ? { ...p, comment_count: Math.max(0, p.comment_count + delta) } : p
          ),
        })),
      };
    });
  }, [queryClient, targetUserId]);

  const handleShareCountChange = useCallback((postId: string, delta: number) => {
    queryClient.setQueryData<any>(["user-wall-posts", targetUserId], (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          posts: page.posts.map((p: UnifiedPost) =>
            p.id === postId ? { ...p, share_count: Math.max(0, (p.share_count || 0) + delta) } : p
          ),
        })),
      };
    });
  }, [queryClient, targetUserId]);

  const handleContentChange = useCallback((postId: string, newContent: string) => {
    patchWallPost(postId, () => ({ content: newContent }));
  }, [patchWallPost]);

  // ── Highlight overlay sync ────────────────────────────────────────────
  // Mirror the Textarea's exact computed text metrics onto the overlay so
  // the yellow highlight aligns pixel-perfectly on every browser, zoom
  // level, and responsive width. Re-runs on:
  //   • content change (re-wrap)
  //   • textarea resize (ResizeObserver — width, font-size via media query, zoom)
  //   • textarea scroll (rAF-throttled scroll sync, both axes)
  //   • window resize (zoom fallback for browsers w/o RO font reactivity)
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const hl = highlightRef.current;
    if (!ta || !hl) return;

    const sync = () => {
      const cs = window.getComputedStyle(ta);
      // Copy every property that affects glyph layout.
      const props = [
        "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant",
        "fontStretch", "lineHeight", "letterSpacing", "wordSpacing",
        "textTransform", "textIndent", "tabSize", "whiteSpace", "wordBreak",
        "overflowWrap", "paddingTop", "paddingRight", "paddingBottom",
        "paddingLeft", "borderTopWidth", "borderRightWidth",
        "borderBottomWidth", "borderLeftWidth", "boxSizing",
      ] as const;
      for (const p of props) hl.style[p as any] = cs[p as any];
      // Match the textarea's exact box so wrap columns are identical.
      hl.style.width = `${ta.clientWidth + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)}px`;
      hl.style.height = `${ta.clientHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)}px`;
    };

    let rafId = 0;
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (!textareaRef.current || !highlightRef.current) return;
        highlightRef.current.scrollTop = textareaRef.current.scrollTop;
        highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
      });
    };

    sync();
    ta.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(ta);
    window.addEventListener("resize", sync);

    return () => {
      ta.removeEventListener("scroll", onScroll);
      ro.disconnect();
      window.removeEventListener("resize", sync);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [newContent]);


  return (
    // space-y-0 on phones so posts stack flush and the hairline between them is
    // the only separator — a 16px gap plus no border read as floating text.
    <div className="space-y-0">
      {/* ── Compose Box ──
          The composer wears the same shape as a post: full width, one hairline,
          no box. Owner, 2026-08-10: "No border anything to anywhere". This was
          the last `md:border` left in the feed — it drew a four-sided card
          around "What's on your mind?" on every screen 768px and up, measured
          live at 0.8px on all four sides while the posts under it had only
          their bottom hairline.

          This comment sits ABOVE the conditional deliberately. A {/* … *​/}
          comment placed as the FIRST thing inside `{cond && ( … )}` is a second
          JSX child and esbuild rejects the file — it broke this exact build
          once already, and vitest does not catch it because only `vite build`
          runs esbuild over the JSX. */}
      {isOwnWall && user && (
        <>
          {/* ── THE COLLAPSED ROW ──
              This is ALL the feed shows. Tapping it opens the Create post
              modal; everything else — caption, photos, audience, schedule and
              the 46 category chips — lives inside that modal.

              Owner, 2026-08-12, on the previous build: the chips were rendered
              here, inline, under the Post button, which put a 46-chip grid on
              the feed page. That is what this row replaces. */}
          {/* ⚠ THE WRAPPER ITSELF IS CONDITIONAL, NOT JUST ITS CONTENTS.
              In the app the composer row below is gone, so with no saved drafts
              this container would render as an EMPTY div that still carries
              `mb-4` — 16px of dead white between the stories and the first post,
              on every app screen, for no reason anyone could see in the markup.
              An empty box with a margin is still a box. It is rendered only
              when it will actually contain something. */}
          {(!appFlow || drafts.length > 0) && (
          <div className="bleed-phone mb-4 overflow-hidden">
            {/* ⚠ THE APP HAS NO "WHAT'S ON YOUR MIND?" ROW.
                Owner, 2026-08-12, with the reference screenshot for the third
                time: *"i want create post will be according to the sample …
                no facebook style (only in app) what's in your mind will show"*.

                His design is Instagram-shaped: you post from the **+ Create**
                button in the top bar, and the feed goes straight from the
                category strip to the stories to the posts. The Facebook-style
                composer bar is a WEB-only affordance now.

                `appFlow` is the only gate — the website is untouched and keeps
                the row exactly as it was. The Create button lives in Navbar.tsx
                and reaches this component through `?compose=1`; see the effect
                near the top of this file. */}
            {!appFlow && (
              <div className="flex items-center gap-3 p-3">
                <Avatar src={currentProfile?.avatar_url || null} name={currentProfile?.full_name} size="md" />
                <button
                  type="button"
                  onClick={() => openComposer()}
                  className="min-h-11 min-w-0 flex-1 truncate rounded-full bg-muted/50 px-4 py-2.5 text-left text-sm text-muted-foreground/70 transition-colors hover:bg-muted"
                >
                  {t("composer.placeholder")}
                </button>
                <button
                  type="button"
                  onClick={() => openComposer(true)}
                  aria-label={t("composer.addPhoto")}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors hover:bg-muted/50"
                >
                  <ImagePlus className="h-5 w-5 text-emerald-500" />
                </button>
              </div>
            )}

            {/* Drafts are visible, never buried in a settings screen. */}
            {drafts.length > 0 && (
              <button
                type="button"
                onClick={() => setDraftsOpen(true)}
                className="mx-3 mb-3 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <FileText className="h-4 w-4" />
                {t("post.drafts.open", "Drafts")} ({drafts.length})
              </button>
            )}
          </div>
          )}

          {/* Mounted OUTSIDE the dialog so `openComposer(true)` can click it on
              the very first open, before the dialog subtree exists. */}
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />

          {cropIndex !== null && imagePreviews[cropIndex] && (
            <ImageCropModal
              key={`crop-${cropIndex}-${imagePreviews[cropIndex].slice(-24)}`}
              imageSrc={imagePreviews[cropIndex]}
              onCropComplete={handleCropConfirm}
              onCancel={handleCropCancel}
            />
          )}

          <Dialog open={composerOpen} onOpenChange={(o) => (o ? setComposerOpen(true) : closeComposer())}>
            <DialogContent className="flex max-h-[92dvh] max-w-lg flex-col gap-0 p-0">
              <header className="flex items-center gap-2 border-b border-border px-4 py-3">
                {composerStep === "settings" ? (
                  <button
                    type="button"
                    onClick={() => setComposerStep("compose")}
                    aria-label={t("common.back", "Back")}
                    className="rounded-full p-1.5 hover:bg-muted"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                ) : (
                  <span className="w-8" />
                )}
                <DialogTitle className="flex-1 text-center text-base font-semibold">
                  {appFlow
                    ? t("post.new.title", "New post")
                    : composerStep === "settings"
                      ? t("post.settings.title", "Post settings")
                      : t("post.create.title", "Create post")}
                </DialogTitle>
                {/* DialogContent renders its own close button at top-right. */}
                <span className="w-8" />
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                {composerStep === "compose" && (
                  <>
                    {/* Who is posting, and to whom. */}
                    <div className="flex items-center gap-3 pb-2">
                      <Avatar src={currentProfile?.avatar_url || null} name={currentProfile?.full_name} size="md" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{currentProfile?.full_name || "You"}</div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="mt-0.5 flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50">
                              {privacyIcon(newPrivacy)}
                              <span>{PRIVACY_OPTIONS.find((o) => o.value === newPrivacy)?.label || "Public"}</span>
                              <ChevronDown className="h-3 w-3 opacity-50" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="min-w-[180px]">
                            {PRIVACY_OPTIONS.map((opt) => (
                              <DropdownMenuItem key={opt.value} onClick={() => setNewPrivacy(opt.value)} className="flex items-center gap-2.5 py-2">
                                {opt.icon}
                                <div>
                                  <div className="text-sm font-medium">{opt.label}</div>
                                  {opt.value === "private" && <div className="text-xs text-muted-foreground">Only you can see this</div>}
                                  {opt.value === "friends" && <div className="text-xs text-muted-foreground">Your friends</div>}
                                  {opt.value === "public" && <div className="text-xs text-muted-foreground">Anyone can see</div>}
                                </div>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    <div className="relative">
                      {/* Highlight overlay — paints yellow behind chars beyond 2200.
                          Font metrics MUST exactly match the Textarea (font-family,
                          size, line-height, letter-spacing, padding, border) or the
                          highlight drifts off the lines. aria-hidden +
                          pointer-events-none so it never blocks typing. */}
                      {newContent.length > 2200 && (
                        <div
                          ref={highlightRef}
                          aria-hidden="true"
                          className="absolute inset-0 rounded-2xl pointer-events-none overflow-hidden text-transparent bg-muted/50"
                        >
                          <span>{newContent.slice(0, 2200)}</span>
                          <span
                            style={{
                              backgroundColor: "hsl(54 95% 62% / 0.55)",
                              borderRadius: "2px",
                              boxDecorationBreak: "clone",
                              WebkitBoxDecorationBreak: "clone",
                            } as React.CSSProperties}
                          >
                            {newContent.slice(2200)}
                          </span>
                          {"\n"}
                        </div>
                      )}
                      <Textarea
                        ref={textareaRef}
                        value={newContent}
                        onChange={(e) => {
                          setNewContent(e.target.value);
                          const el = e.currentTarget;
                          el.style.height = "auto";
                          el.style.height = Math.min(el.scrollHeight, 440) + "px";
                          captionMentions.refresh();
                        }}
                        // Caret can move without the text changing (clicks, arrow
                        // keys) — the @-dropdown must follow the caret, not the text.
                        onClick={captionMentions.refresh}
                        onKeyUp={captionMentions.refresh}
                        onKeyDown={captionMentions.onKeyDown}
                        placeholder={t("composer.placeholder")}
                        className={`relative resize-none rounded-2xl border-0 px-3 py-2.5 text-base focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/60 min-h-[120px] max-h-[280px] overflow-y-auto ${newContent.length > 2200 ? "bg-transparent" : "bg-transparent"}`}
                        rows={3}
                      />

                      {/* @mention dropdown — Instagram places caption suggestions in
                          a list under the text box, so we do too. Buttons use
                          onPointerDown (not onClick): a tap must win the race with
                          the textarea's blur, the same Android-WebView rule already
                          recorded in MentionInput.tsx and GlobalSearch.tsx. */}
                      {captionMentions.open && (
                        <div className="absolute top-full left-0 right-0 mt-1 z-30 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
                          {captionMentions.suggestions.map((s, i) => (
                            <button
                              key={s.id}
                              type="button"
                              onPointerDown={(e) => {
                                e.preventDefault();
                                captionMentions.pick(s);
                              }}
                              onMouseEnter={() => captionMentions.setFocusIdx(i)}
                              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${i === captionMentions.focusIdx ? "bg-accent" : ""}`}
                            >
                              {s.avatar_url ? (
                                <img src={s.avatar_url} alt="" loading="lazy" className="h-7 w-7 rounded-full object-cover" />
                              ) : (
                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                                  {(s.display || "?")[0]?.toUpperCase()}
                                </div>
                              )}
                              <span className="font-medium">{s.display}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* No running counter (owner, 2026-08-04: "Don't show it
                        anywhere"). The line appears ONLY over the limit, where Post
                        is disabled and the excess text is highlighted. */}
                    {newContent.length > 2200 && (
                      <div className="mt-1 text-right text-[10px] font-semibold tabular-nums text-destructive">
                        {newContent.length - 2200} over the 2200 limit — delete the highlighted text
                      </div>
                    )}

                    {imagePreviews.length > 0 && (
                      <div
                        className={`mt-3 space-y-2 rounded-lg transition-all ${isDragOver ? "ring-2 ring-primary bg-primary/5 p-2" : ""}`}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={() => setIsDragOver(false)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            {imagePreviews.length} photo{imagePreviews.length > 1 ? "s" : ""} selected{isDragOver ? " · drop to add more" : ""}
                          </span>
                          <button onClick={clearAllImages} className="text-xs text-destructive hover:underline">Remove all</button>
                        </div>
                        {/* THE COMPOSER. Replaced a grid of small squares on
                            2026-08-15: on a photography platform a composer
                            that shows thumbnails only lets a member discover
                            their own framing AFTER posting. This shows the post
                            as it will appear, with a rule-of-thirds guide, and
                            lets the order be changed — the first photo is the
                            cover and sets the frame for the whole album. */}
                        <PostComposerPreview
                          previews={imagePreviews}
                          activeIndex={Math.min(previewIndex, Math.max(0, imagePreviews.length - 1))}
                          onActiveChange={setPreviewIndex}
                          onMove={movePhoto}
                          onRemove={clearImage}
                          onCrop={setCropIndex}
                          onAddMore={imagePreviews.length < 10 ? () => fileInputRef.current?.click() : undefined}
                        />
                      </div>
                    )}

                    {/* A resumed draft's images are already in storage — shown as
                        URLs, never re-uploaded. */}
                    {resumedUrls.length > 0 && (
                      <div className="mt-3 grid grid-cols-4 gap-2">
                        {resumedUrls.map((u, i) => (
                          <img key={i} src={resumedThumbs[i] ?? u} alt="" className="aspect-square w-full rounded-md object-cover" />
                        ))}
                      </div>
                    )}

                    {imagePreviews.length === 0 && resumedUrls.length === 0 && (
                      <div onClick={() => fileInputRef.current?.click()} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={() => setIsDragOver(false)}
                        className={`mt-3 flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed py-6 transition-all ${isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50 hover:bg-muted/30"}`}>
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                          <ImagePlus className={`h-5 w-5 ${isDragOver ? "text-primary" : "text-muted-foreground"}`} />
                        </div>
                        <span className="text-sm font-medium text-foreground">{t("composer.addPhoto")}</span>
                        <span className="text-xs text-muted-foreground">{t("composer.dragDrop")}</span>
                      </div>
                    )}

                    {/* "Add to your post" — the owner's bar. */}
                    <div className="mt-4 flex items-center gap-1 rounded-lg border border-border p-2">
                      <span className="flex-1 pl-1 text-sm font-medium">
                        {t("post.create.addTo", "Add to your post")}
                      </span>
                      <button type="button" onClick={() => void pickPhotos()} aria-label={t("composer.addPhoto")} className="rounded-full p-2 hover:bg-muted/50">
                        <ImagePlus className="h-5 w-5 text-emerald-500" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setTagModalOpen(true)}
                        disabled={imagePreviews.length === 0}
                        title="Tag people in this photo"
                        aria-label="Tag people"
                        className="rounded-full p-2 hover:bg-muted/50 disabled:opacity-40"
                      >
                        <Tag className="h-5 w-5 text-sky-500" />
                      </button>
                      {pendingTags.length > 0 && (
                        <span className="pr-1 text-xs text-muted-foreground">{pendingTags.length}</span>
                      )}
                    </div>
                  </>
                )}

                {composerStep === "settings" && (
                  <>
                    {/*
                      TWO SHAPES, ONE STEP.

                      Web arrives here having already written the caption on the
                      previous screen, so this is a PREVIEW — thumbnail plus the
                      text, read-only.

                      The app arrives here straight from Android's picker and has
                      never seen a caption box, so this is where it lives. Owner's
                      screen 2: photo centred, "Add a caption…" under it, then the
                      rows. Rendering a read-only preview on the app would leave
                      no way to write a caption at all.
                    */}
                    {appFlow ? (
                      <>
                        {/**
                         * THE APP GETS THE REAL COMPOSER — 2026-08-16.
                         *
                         * Owner, with the web composer open beside his phone:
                         * *"this page must come afte image pic king"*.
                         *
                         * WHAT WAS HERE: a 160x160 thumbnail. No Crop, no
                         * cover choice, no reorder, no rule-of-thirds, no sight
                         * of how the post would actually be framed. On a
                         * PHOTOGRAPHY platform that is the one screen that
                         * matters, and the phone — the only place most members
                         * ever post from — was the one place it was missing.
                         *
                         * WHY IT WAS MISSING, honestly: the owner chose a
                         * two-screen Android flow on 2026-08-12 to avoid us
                         * drawing our own gallery grid, which was the right
                         * call. Collapsing screen 2 to a thumbnail was NOT
                         * part of that decision — it was my shortcut, and it
                         * quietly cost the app its framing step.
                         *
                         * `PostComposerPreview` is the exact component the web
                         * renders. Not a copy of it — the same one. That is the
                         * one-funnel rule the owner set on 2026-08-15 after a
                         * post rendered two different ways: if the app and the
                         * web draw the same thing, they draw it with the same
                         * code or they will drift apart again.
                         *
                         * The caption box below stays. The app arrives here
                         * straight from Android's picker and has never seen
                         * one, so removing it would leave no way to write a
                         * caption at all.
                         */}
                        {imagePreviews.length > 0 && (
                          <div className="pb-3 pt-1">
                            <PostComposerPreview
                              previews={imagePreviews}
                              activeIndex={Math.min(previewIndex, Math.max(0, imagePreviews.length - 1))}
                              onActiveChange={setPreviewIndex}
                              onMove={movePhoto}
                              onRemove={clearImage}
                              onCrop={setCropIndex}
                              onAddMore={imagePreviews.length < 10 ? () => fileInputRef.current?.click() : undefined}
                            />
                          </div>
                        )}
                        {/* A resumed draft has no local File objects to preview,
                            so it keeps the thumbnail it always had. */}
                        {imagePreviews.length === 0 && (resumedThumbs[0] || resumedUrls[0]) && (
                          <div className="grid place-items-center pb-3 pt-1">
                            <img
                              src={resumedThumbs[0] || resumedUrls[0]}
                              alt=""
                              className="h-40 w-40 rounded-md object-cover"
                            />
                          </div>
                        )}
                        <Textarea
                          value={newContent}
                          onChange={(e) => {
                            setNewContent(e.target.value);
                            captionMentions.refresh();
                          }}
                          onClick={captionMentions.refresh}
                          onKeyUp={captionMentions.refresh}
                          onKeyDown={captionMentions.onKeyDown}
                          placeholder={t("post.caption", "Add a caption…")}
                          className="min-h-[72px] resize-none border-0 bg-transparent px-0 text-base focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/60"
                          rows={2}
                        />
                        {newContent.length > 2200 && (
                          <div className="pb-1 text-right text-[10px] font-semibold tabular-nums text-destructive">
                            {newContent.length - 2200} over the 2200 limit
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="pb-3">
                        <p className="pb-2 text-sm font-semibold">{t("post.preview", "Post preview")}</p>
                        <div className="flex items-start gap-3">
                          {(imagePreviews[0] || resumedThumbs[0] || resumedUrls[0]) && (
                            <img
                              src={imagePreviews[0] || resumedThumbs[0] || resumedUrls[0]}
                              alt=""
                              className="h-20 w-20 shrink-0 rounded-md object-cover"
                            />
                          )}
                          <p className="line-clamp-4 min-w-0 text-sm text-muted-foreground">{newContent}</p>
                        </div>
                      </div>
                    )}

                    <div className="divide-y divide-border border-y border-border">
                      {/* App only — web tags people on the compose screen. */}
                      {appFlow && (
                        <button
                          type="button"
                          onClick={() => setTagModalOpen(true)}
                          disabled={imagePreviews.length === 0}
                          className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-muted/40 disabled:opacity-40"
                        >
                          <Tag className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="flex-1">
                            <span className="block text-sm font-medium">{t("post.tagPeople", "Tag people")}</span>
                            {pendingTags.length > 0 && (
                              <span className="block text-xs text-muted-foreground">{pendingTags.length}</span>
                            )}
                          </span>
                          <span aria-hidden="true" className="text-muted-foreground">›</span>
                        </button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-muted/40">
                            <Globe className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="flex-1">
                              <span className="block text-sm font-medium">{t("post.audience", "Post audience")}</span>
                              <span className="block text-xs text-muted-foreground">
                                {PRIVACY_OPTIONS.find((o) => o.value === newPrivacy)?.label || "Public"}
                              </span>
                            </span>
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-[180px]">
                          {PRIVACY_OPTIONS.map((opt) => (
                            <DropdownMenuItem key={opt.value} onClick={() => setNewPrivacy(opt.value)} className="flex items-center gap-2.5 py-2">
                              {opt.icon}
                              <div>
                                <div className="text-sm font-medium">{opt.label}</div>
                                {opt.value === "private" && <div className="text-xs text-muted-foreground">Only you can see this</div>}
                                {opt.value === "friends" && <div className="text-xs text-muted-foreground">Your friends</div>}
                                {opt.value === "public" && <div className="text-xs text-muted-foreground">Anyone can see</div>}
                              </div>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <div>
                        <button
                          type="button"
                          onClick={() => setShowSchedule((v) => !v)}
                          className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-muted/40"
                        >
                          <CalendarClock className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="flex-1">
                            <span className="block text-sm font-medium">{t("post.scheduling", "Scheduling options")}</span>
                            <span className="block text-xs text-muted-foreground">
                              {scheduleAt ? scheduleAt.toLocaleString() : t("post.publishNow", "Publish now")}
                            </span>
                          </span>
                          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${showSchedule ? "rotate-180" : ""}`} />
                        </button>
                        {showSchedule && (
                          <div className="pb-3">
                            <ScheduleDateTimePicker value={scheduleAt} onChange={setScheduleAt} disabled={posting} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/*
                      Stage C — the 1-5 category picker. THIS is where the owner's
                      design puts it: inside Post settings, under the audience and
                      scheduling rows. Never on the feed page.
                    */}
                    <div className="pt-4">
                      <CategoryChips value={postCategories} onChange={setPostCategories} />
                    </div>

                    {/* SOW §5.2 — Search engine opt-out (only meaningful for public posts) */}
                    {newPrivacy === "public" && (
                      <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
                        <input
                          type="checkbox"
                          checked={excludeFromSearch}
                          onChange={(e) => setExcludeFromSearch(e.target.checked)}
                          className="h-3.5 w-3.5 cursor-pointer accent-primary"
                        />
                        <span>{t("composer.excludeSearch")}</span>
                      </label>
                    )}
                  </>
                )}
              </div>

              <footer className="border-t border-border px-4 py-3">
                {composerStep === "compose" ? (
                  <button
                    type="button"
                    onClick={() => setComposerStep("settings")}
                    disabled={newContent.trim().length === 0 && imagePreviews.length === 0 && resumedUrls.length === 0}
                    className="w-full rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("post.next", "Next")}
                  </button>
                ) : (
                  // Owner's screen 2 ends in ONE full-width Share. Save draft
                  // stays — drafts are on both surfaces — but as a quiet line
                  // above it rather than competing for the same row.
                  <div className={appFlow ? "space-y-2" : "flex gap-2"}>
                    <button
                      type="button"
                      onClick={saveDraft}
                      disabled={posting || savingDraft || nothingToSave}
                      className={appFlow
                        ? "w-full py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        : "flex-1 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"}
                    >
                      {savingDraft
                        ? t("post.saving", "Saving…")
                        : draftId
                          ? t("post.updateDraft", "Update draft")
                          : t("post.saveDraft", "Save")}
                    </button>
                    {/*
                      The Post button follows createPost EXACTLY: a photo is required,
                      the caption is not, and Stage C adds 1-5 categories. If these ever
                      disagree the member either gets a dead button or a refusal after
                      they press it. See the ruling at the top of createPost before
                      touching either.

                      The category rule is enforced HERE and only here until Stage B2
                      activates POST-CAT-002 in the database.
                    */}
                    <button onClick={draftId ? publishResumedDraft : createPost} disabled={posting || (selectedImages.length === 0 && resumedUrls.length === 0) || !canPublishCategories(postCategories) || newContent.length > 2200 || (!!scheduleAt && (scheduleAt.getTime() < Date.now() + 5*60*1000 || scheduleAt.getTime() > Date.now() + 90*24*60*60*1000))}
                      className={`rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 ${appFlow ? "w-full" : "flex-1"}`}>
                      {posting
                        ? (scheduleAt ? "Scheduling..." : "Posting...")
                        : newContent.length > 2200
                          ? `Trim ${newContent.length - 2200}`
                          : scheduleAt
                            ? "Schedule"
                            : appFlow ? t("post.share", "Share") : "Post"}
                    </button>
                  </div>
                )}
              </footer>
            </DialogContent>
          </Dialog>
        </>
      )}

      <DraftsList
        open={draftsOpen}
        onOpenChange={setDraftsOpen}
        onResume={(d) => { resumeDraft(d); openComposer(); }}
      />

      <TagPeopleModal
        open={tagModalOpen}
        onClose={() => setTagModalOpen(false)}
        imagePreviews={imagePreviews}
        initialTags={pendingTags}
        onConfirm={(tags) => setPendingTags(tags)}
      />

      {/* ── Posts ── */}
      {!composerOnly && (
        <>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => <PostCardSkeleton key={i} />)}
            </div>
          ) : posts.length === 0 ? (
            <div className="border border-border rounded-xl md:rounded-none p-10 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <MessageCircle className="h-7 w-7 text-muted-foreground/30" />
              </div>
              <p className="text-sm text-muted-foreground">
                {isOwnWall ? "Your wall is empty. Share your first photo above!" : "No posts to show yet."}
              </p>
            </div>
          ) : (
            <>
              {/* Grid ⇄ feed. Above the photographs, exactly where Instagram
                  puts it, so it needs no explaining. */}
              <WallViewToggle value={wallView} onChange={setWallView} className="mb-1" />

              {wallView === "grid" ? (
                <ProfilePostGrid posts={posts} />
              ) : (
              <AnimatePresence mode="popLayout">
                {posts.map((post, i) => (
                  /**
                   * THE KEY BELONGS ON THE motion.div, NOT ON A FRAGMENT.
                   *
                   * This used to be `<Fragment key={post.id}><motion.div …>`,
                   * with the Fragment wrapping one single child — so it added
                   * nothing, and it broke the animation it was standing in
                   * front of. `AnimatePresence` attaches a ref to each of its
                   * children to measure them, and a Fragment cannot hold a
                   * ref: React 19 logged
                   *   "Invalid prop `ref` supplied to `React.Fragment`"
                   * once per card, and the `exit` animation below never ran,
                   * so a deleted post vanished instantly instead of fading.
                   *
                   * Found by rendering the real wall in the screenshot harness
                   * and reading the console — the error is invisible on a
                   * phone, which is why it survived this long.
                   */
                  <motion.div
                    key={post.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.3, delay: Math.min(i, 5) * 0.03 }}
                  >
                        <PostCard
                          post={post}
                          currentUserId={user?.id}
                          onReact={handleReact}
                          onUnreact={handleUnreact}
                          onDelete={handleDelete}
                          onRemoveShare={
                            // Only on your OWN wall. Viewing someone else's wall
                            // must never offer to remove their share.
                            user?.id && user.id === targetUserId ? handleRemoveShare : undefined
                          }
                          onCommentCountChange={handleCommentCountChange}
                          onShareCountChange={handleShareCountChange}
                          onContentChange={handleContentChange}
                        />
                  </motion.div>
                ))}
              </AnimatePresence>
              )}

              {loadingMore && (
                <div className="space-y-4 py-2">
                  <PostCardSkeleton />
                </div>
              )}
              <InfiniteScrollSentinel
                onLoadMore={fetchNextPage}
                hasNextPage={!!hasMore}
                isFetching={loadingMore}
                rootMargin="300px"
                hideLoader
                endLabel="No more posts"
                showEndMarker={posts.length > 0}
              />
            </>
          )}
        </>
      )}
    </div>
  );
};

export default WallPosts;
