import { Fragment, useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Send, Globe, Users, Lock, ChevronDown, ImagePlus, X, Tag, CalendarClock, Crop } from "lucide-react";
import TagPeopleModal, { type PendingTag } from "@/components/post/TagPeopleModal";
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
import PostCardSkeleton from "@/components/post/PostCardSkeleton";
import InfiniteScrollSentinel from "@/components/InfiniteScrollSentinel";
import { useUserPostsQuery, flattenUserPosts } from "@/hooks/feed/useUserPostsQuery";
import { useFeedRealtime } from "@/hooks/feed/useRealtimeFeed";
import { reportClientError, memberFacingMessage, describeThrown } from "@/lib/reportClientError";
import { useCaptionMentions } from "@/hooks/feed/useCaptionMentions";
import { logger, newCorrelationId } from "@/lib/logger";
import type { ReactionType } from "@/components/ReactionPicker";
import type { UnifiedPost } from "@/types/post";

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
      <span className="text-xs text-primary" style={{ fontFamily: "var(--font-display)" }}>{(name || "?")[0]?.toUpperCase()}</span>
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
  const handleWallReactionChange = useCallback((postId: string, event: "INSERT" | "DELETE", reaction: any) => {
    const delta = event === "INSERT" ? 1 : -1;
    const reactionType = reaction?.reaction_type as string | undefined;
    patchWallPost(postId, (current) => {
      const newCounts = { ...current.reaction_counts };
      if (reactionType) {
        newCounts[reactionType] = Math.max(0, (newCounts[reactionType] || 0) + delta);
      }
      const topReactions = Object.entries(newCounts)
        .filter(([, c]) => c > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([type]) => type);
      return { like_count: Math.max(0, current.like_count + delta), reaction_counts: newCounts, top_reactions: topReactions };
    });
  }, [patchWallPost]);

  const handleWallCommentChange = useCallback((postId: string, event: "INSERT" | "DELETE") => {
    const delta = event === "INSERT" ? 1 : -1;
    patchWallPost(postId, (current) => ({ comment_count: Math.max(0, current.comment_count + delta) }));
  }, [patchWallPost]);

  const handleWallShareChange = useCallback((postId: string, event: "INSERT" | "DELETE") => {
    const delta = event === "INSERT" ? 1 : -1;
    patchWallPost(postId, (current) => ({ share_count: Math.max(0, (current.share_count || 0) + delta) }));
  }, [patchWallPost]);

  // Wire realtime to wall posts
  useFeedRealtime({
    userId: user?.id,
    relevantUserIds: useMemo(() => [targetUserId], [targetUserId]),
    onNewPost: useCallback(() => { refetch(); }, [refetch]),
    onUpdatePost: useCallback((rawPost: any) => {
      patchWallPost(rawPost.id, (current) => ({
        ...current,
        content: rawPost.content ?? current.content,
        image_url: rawPost.image_url ?? current.image_url,
        image_urls: rawPost.image_urls ?? current.image_urls,
        privacy: rawPost.privacy ?? current.privacy,
      }));
    }, [patchWallPost]),
    onDeletePost: useCallback((postId: string) => {
      queryClient.setQueryData<any>(["user-wall-posts", targetUserId], (old: any) => {
        if (!old?.pages) return old;
        return { ...old, pages: old.pages.map((page: any) => ({ ...page, posts: page.posts.filter((p: UnifiedPost) => p.id !== postId) })) };
      });
    }, [queryClient, targetUserId]),
    onReactionChange: handleWallReactionChange,
    onCommentChange: handleWallCommentChange,
    onShareChange: handleWallShareChange,
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
    // Removing a photo shifts every later index; a stale cropIndex would then
    // point at the wrong photo, so close the dialog rather than guess.
    setCropIndex(null);
  };

  const clearAllImages = () => {
    selectedCountRef.current = 0;
    setSelectedImages([]);
    setImagePreviews([]);
    setCropIndex(null);
    setPendingTags([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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
    setPosting(true);
    try {
      const uploadedUrls: string[] = [];
      const uploadedThumbs: string[] = [];
      for (let i = 0; i < selectedImages.length; i++) {
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

        uploadedUrls.push(uploadResult.url);
        uploadedThumbs.push(uploadResult.thumbnailUrl);
      }
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
            image_url: uploadedUrls[0],
            tagged_user_ids: pendingTags.map((t) => t.taggedUserId),
            scheduled_for: iso,
            privacy: newPrivacy,
            indexing_disabled: excludeFromSearch,
          });
          toast({ title: "Post scheduled", description: `Will publish at ${scheduleAt.toLocaleString()}` });
          setNewContent("");
          captionMentions.reset();
          setExcludeFromSearch(false);
          setScheduleAt(null);
          setShowSchedule(false);
          clearAllImages();
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
        clearAllImages();
        await refetch();
        // Keep the FEED in sync too: realtime inserts it instantly when the
        // feed is mounted; invalidation covers navigation + flaky sockets.
        queryClient.invalidateQueries({ queryKey: queryKeys.feed() });
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
      queryClient.setQueryData<any>(queryKeys.feed(), (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            posts: (page.posts || []).filter((p: any) => p.id !== postId),
          })),
        };
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.feed() });
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
    queryClient.invalidateQueries({ queryKey: queryKeys.feed() });
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
        <div className="bleed-phone border-b border-border mb-0 overflow-hidden">
          <div className="flex items-start gap-3 p-3 pb-0">
            <Avatar src={currentProfile?.avatar_url || null} name={currentProfile?.full_name} size="md" />
            <div className="flex-1 min-w-0">
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
                    // All text metrics (font, line-height, padding, border,
                    // word-break, width, height) are copied at runtime from
                    // the live Textarea by the sync effect above — that's the
                    // only way coverage stays exact across browsers + zoom.
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
                    {/* Trailing newline mirrors textarea's own phantom line
                        so the highlight's last line wraps identically. */}
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
                  className={`relative rounded-2xl px-4 py-2.5 resize-none min-h-[40px] max-h-[440px] border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm placeholder:text-muted-foreground/60 overflow-y-auto ${newContent.length > 2200 ? "bg-transparent" : "bg-muted/50"}`}
                  rows={1}
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
                <div className="text-[10px] mt-1 text-right tabular-nums text-destructive font-semibold">
                  {newContent.length - 2200} over the 2200 limit — delete the highlighted text
                </div>
              )}
            </div>
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />
          {cropIndex !== null && imagePreviews[cropIndex] && (
            <ImageCropModal
              key={`crop-${cropIndex}-${imagePreviews[cropIndex].slice(-24)}`}
              imageSrc={imagePreviews[cropIndex]}
              onCropComplete={handleCropConfirm}
              onCancel={handleCropCancel}
            />
          )}
          {imagePreviews.length > 0 && (
            <div
              className={`mx-3 mt-3 space-y-2 rounded-lg transition-all ${isDragOver ? "ring-2 ring-primary bg-primary/5 p-2" : ""}`}
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
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {imagePreviews.map((preview, idx) => (
                  <div key={idx} className="relative aspect-square rounded-md overflow-hidden border border-border">
                    <img decoding="async" src={preview} alt="" className="w-full h-full object-contain bg-muted/40" />
                    <button onClick={() => clearImage(idx)}
                      className="absolute top-1 right-1 p-1 bg-card/90 backdrop-blur-sm rounded-full text-muted-foreground hover:text-destructive hover:bg-card transition-all shadow-sm">
                      <X className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCropIndex(idx)}
                      title="Crop this photo"
                      className="absolute bottom-1 left-1 inline-flex items-center gap-1 px-1.5 py-1 bg-card/90 backdrop-blur-sm rounded-full text-[10px] text-muted-foreground hover:text-foreground hover:bg-card transition-all shadow-sm"
                    >
                      <Crop className="h-3 w-3" />
                      Crop
                    </button>
                  </div>
                ))}
                {imagePreviews.length < 10 && (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={() => setIsDragOver(false)}
                    className={`aspect-square rounded-md border border-dashed flex items-center justify-center cursor-pointer transition-colors ${isDragOver ? "border-primary bg-primary/10" : "border-border hover:bg-muted/30"}`}
                  >
                    <ImagePlus className={`h-5 w-5 ${isDragOver ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                )}
              </div>
            </div>
          )}

          {imagePreviews.length === 0 && (
            <div onClick={() => fileInputRef.current?.click()} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={() => setIsDragOver(false)}
              className={`mx-3 mt-3 border border-dashed rounded-lg py-6 flex flex-col items-center gap-1.5 cursor-pointer transition-all ${isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50 hover:bg-muted/30"}`}>
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <ImagePlus className={`h-5 w-5 ${isDragOver ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <span className="text-sm font-medium text-foreground">{t("composer.addPhoto")}</span>
              <span className="text-xs text-muted-foreground">{t("composer.dragDrop")}</span>
            </div>
          )}

          <div className="mx-3 mt-3 border-t border-border" />

          {/* SOW §5.2 — Search engine opt-out (only meaningful for public posts) */}
          {newPrivacy === "public" && (
            <label className="flex items-center gap-2 px-3 pt-2.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
              <input
                type="checkbox"
                checked={excludeFromSearch}
                onChange={(e) => setExcludeFromSearch(e.target.checked)}
                className="w-3.5 h-3.5 accent-primary cursor-pointer"
              />
              <span>{t("composer.excludeSearch")}</span>
            </label>
          )}

          <div className="flex items-center justify-between px-3 py-2.5">
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors">
                    {privacyIcon(newPrivacy)}
                    <span className="hidden sm:inline">{PRIVACY_OPTIONS.find((o) => o.value === newPrivacy)?.label || "Public"}</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-50" />
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
              {selectedImages.length > 0 && (
                <button
                  onClick={() => setTagModalOpen(true)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
                  title="Tag people in this photo"
                >
                  <Tag className="h-4 w-4 text-secondary" />
                  <span className="hidden sm:inline">
                    Tag {pendingTags.length > 0 ? `(${pendingTags.length})` : "People"}
                  </span>
                </button>
              )}
              {selectedImages.length > 0 && (
                <button
                  onClick={() => setShowSchedule((v) => !v)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${showSchedule || scheduleAt ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50"}`}
                  title="Schedule this post"
                >
                  <CalendarClock className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {scheduleAt ? "Scheduled" : "Schedule"}
                  </span>
                </button>
              )}
            </div>
            {/*
              The Post button follows createPost EXACTLY: a photo is required,
              the caption is not. If these two ever disagree the member either
              gets a dead button or a refusal after they press it. See the
              ruling at the top of createPost before touching either.
            */}
            <button onClick={createPost} disabled={posting || selectedImages.length === 0 || newContent.length > 2200 || (!!scheduleAt && (scheduleAt.getTime() < Date.now() + 5*60*1000 || scheduleAt.getTime() > Date.now() + 90*24*60*60*1000))}
              className="px-5 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {posting ? (scheduleAt ? "Scheduling..." : "Posting...") : newContent.length > 2200 ? `Trim ${newContent.length - 2200}` : scheduleAt ? "Schedule" : "Post"}
            </button>
          </div>
          {showSchedule && selectedImages.length > 0 && (
            <div className="mt-3">
              <ScheduleDateTimePicker value={scheduleAt} onChange={setScheduleAt} disabled={posting} />
            </div>
          )}
        </div>
      )}

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
              <AnimatePresence mode="popLayout">
                {posts.map((post, i) => (
                  <Fragment key={post.id}>
                    <motion.div
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
                  </Fragment>
                ))}
              </AnimatePresence>

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
