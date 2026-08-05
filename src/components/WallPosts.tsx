import { Fragment, useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Send, Globe, Users, Lock, ChevronDown, ImagePlus, X, Tag, CalendarClock, Crop } from "lucide-react";
import TagPeopleModal, { type PendingTag } from "@/components/post/TagPeopleModal";
import { ScheduleDateTimePicker } from "@/components/post/ScheduleDateTimePicker";
import { useCreateScheduledPost } from "@/hooks/feed/useScheduledPosts";
import { compressImageToFiles } from "@/lib/imageCompression";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
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
        setSelectedImages(prev => [...prev, file]);
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
    if (isBanned) {
      toast({ title: "Your account is restricted from posting", variant: "destructive" });
      return;
    }
    /**
     * A POST NEEDS *SOMETHING* — WORDS OR A PHOTO. NOT A PHOTO SPECIFICALLY.
     *
     * OWNER ORDER, 2026-08-05: "DP icon now given, then blocking ?? I asked DP
     * is must either by user or by system, logically system must work
     * normally."
     *
     * This line used to read `selectedImages.length === 0` and refuse the post
     * outright. MEASURED CONSEQUENCE, on production the same day:
     *
     *   * 0 of 151 posts in the entire history of the site are text-only.
     *     Not one. Because it was impossible.
     *   * 43 of 84 members had never posted, and 65 of those 84 had joined in
     *     the previous 7 days.
     *
     * A member who wanted to say hello, ask a question, thank someone or
     * introduce themselves had to go and find a photograph first. Combined with
     * the profile-photo wall that stood from 1 to 5 August, a new member had to
     * produce TWO photographs before they could make a single sound.
     *
     * THE DATABASE NEVER REQUIRED THIS. posts.image_url is nullable and there
     * is no check constraint — verified on production, and a text-only insert
     * was rehearsed as a real member with no photo before this shipped. The
     * rule existed only here, in the client.
     *
     * WHAT IS STILL REFUSED: a completely empty post. Words alone are fine,
     * photos alone are fine, both are fine, neither is not.
     */
    if (!user) return;
    if (selectedImages.length === 0 && !newContent.trim()) {
      toast({ title: "Write something or add a photo", variant: "destructive" });
      return;
    }
    setPosting(true);
    try {
      const uploadedUrls: string[] = [];
      const uploadedThumbs: string[] = [];
      for (let i = 0; i < selectedImages.length; i++) {
        const safe = await scanFileWithToast(selectedImages[i], toast, { allowedTypes: "image" });
        if (!safe) { setPosting(false); return; }
        const uploadResult = await uploadImageWithThumbnail({
          bucket: "post-images",
          file: selectedImages[i],
          type: "post",
          userId: user.id,
          cacheControl: "3600",
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
            content: newContent.trim(),
            image_urls: uploadedUrls,
            image_url: uploadedUrls[0],
            tagged_user_ids: pendingTags.map((t) => t.taggedUserId),
            scheduled_for: iso,
            privacy: newPrivacy,
            indexing_disabled: excludeFromSearch,
          });
          toast({ title: "Post scheduled", description: `Will publish at ${scheduleAt.toLocaleString()}` });
          setNewContent("");
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
        content: newContent.trim(),
        privacy: newPrivacy,
        // EXPLICIT null for a text-only post. uploadedUrls[0] is undefined
        // when no photo was attached, and an undefined key is silently dropped
        // by the client — which happens to do the right thing, but relying on
        // that is exactly the implicit behaviour this codebase does not allow.
        image_url: uploadedUrls[0] ?? null,
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
    <div className="space-y-4">
      {/* ── Compose Box ── */}
      {isOwnWall && user && (
        <div className="border border-border mb-2 md:mb-4 rounded-xl md:rounded-none overflow-hidden">
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
                  }}
                  placeholder={t("composer.placeholder")}
                  className={`relative rounded-2xl px-4 py-2.5 resize-none min-h-[40px] max-h-[440px] border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm placeholder:text-muted-foreground/60 overflow-y-auto ${newContent.length > 2200 ? "bg-transparent" : "bg-muted/50"}`}
                  rows={1}
                />

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
                  title="Tag friends in this photo"
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
              The Post button follows the same rule as createPost: enabled when
              there is EITHER text OR a photo. It used to require a photo, which
              left the button greyed out for a member who had typed a paragraph
              and made the app look broken rather than strict.
            */}
            <button onClick={createPost} disabled={posting || (selectedImages.length === 0 && !newContent.trim()) || newContent.length > 2200 || (!!scheduleAt && (scheduleAt.getTime() < Date.now() + 5*60*1000 || scheduleAt.getTime() > Date.now() + 90*24*60*60*1000))}
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
