import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { useParams, Link } from "react-router-dom";
import { Camera, CheckCircle2, ExternalLink, Globe, Trophy, BookOpen, User, Expand, Award, ChevronLeft, ChevronRight, Facebook, Instagram, GraduationCap, Twitter, Youtube, MapPin, Calendar, Image, BadgeCheck, ImagePlus, Move, Check, X, Play, Briefcase, Phone, Mail, Heart, Lock, Users as UsersIcon, Star, FileText, Layers, MessageSquare, BarChart3, Pencil } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import JudgingStampBadge from "@/components/JudgingStampBadge";
import { participantLabelForJudgingTag } from "@/lib/judging/participantStageLabels";
import PhaseWatermark from "@/components/competition/PhaseWatermark";
import FriendFollowActions, { FriendFollowStats, FriendFollowButtons } from "@/components/FriendFollowActions";
import MutualFriends from "@/components/MutualFriends";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";
import { compressAvatar, compressImageToFiles } from "@/lib/imageCompression";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import { toast } from "@/hooks/core/use-toast";
import { createProfileUpdatePost } from "@/lib/profilePostHelper";
import WallPosts from "@/components/WallPosts";
import PhotoAlbums from "@/components/profile/PhotoAlbums";
import { useAuth } from "@/hooks/core/useAuth";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useUpdateCover } from "@/hooks/profile/useProfileMutations";
import { profilesPublic } from "@/lib/profilesPublic";
import { getAdminIds, resolveName, resolveBadges, isAdminUser } from "@/lib/adminBrand";
import { canViewField, getPrivacy, type PrivacyLevel } from "@/components/PrivacyToggle";
import ProfileStories from "@/components/profile/ProfileStories";
import PublicProfileJoinWall from "@/components/PublicProfileJoinWall";
import { useProfileCore, useProfileExtended } from "@/hooks/profile/useProfileData";
import ProfileSkeleton from "@/components/ProfileSkeleton";
import PageSEO from "@/components/PageSEO";
import { useEntryPublicStatus } from "@/hooks/judging/useEntryPublicStatus";

/* ── Privacy Indicator (shown to owner only) ── */
const PRIVACY_ICONS: Record<PrivacyLevel, { icon: typeof Globe; label: string }> = {
  public: { icon: Globe, label: "Public" },
  friends: { icon: UsersIcon, label: "Friends" },
  only_me: { icon: Lock, label: "Only Me" },
};

const PrivacyIndicator = ({ level }: { level: PrivacyLevel }) => {
  const cfg = PRIVACY_ICONS[level] || PRIVACY_ICONS.public;
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1 text-[8px] tracking-[0.15em] uppercase text-muted-foreground/60 ml-1" style={{ fontFamily: "var(--font-heading)" }}>
      <Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </span>
  );
};

/* ── Mini Carousel on hover ── */
const MiniCarousel = ({
  photos,
  alt,
  className,
  onPhotoClick,
}: {
  photos: string[];
  alt: string;
  className?: string;
  onPhotoClick?: (src: string) => void;
}) => {
  const [activeIdx, setActiveIdx] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasMultiple = photos.length > 1;

  const startAutoplay = useCallback(() => {
    if (!hasMultiple) return;
    intervalRef.current = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % photos.length);
    }, 1800);
  }, [hasMultiple, photos.length]);

  const stopAutoplay = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setActiveIdx(0);
  }, []);

  const goTo = (dir: "prev" | "next", e: React.MouseEvent) => {
    e.stopPropagation();
    if (intervalRef.current) clearInterval(intervalRef.current);
    setActiveIdx((prev) =>
      dir === "next"
        ? (prev + 1) % photos.length
        : (prev - 1 + photos.length) % photos.length
    );
    startAutoplay();
  };

  return (
    <div
      className={`relative overflow-hidden ${className ?? ""}`}
      onMouseEnter={startAutoplay}
      onMouseLeave={stopAutoplay}
    >
      {photos.map((photo, i) => (
        <img
          key={photo + i}
          src={photo}
          alt={`${alt} – ${i + 1}`}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
            i === activeIdx ? "opacity-100 z-[1]" : "opacity-0 z-0"
          }`}
          loading={i === 0 ? "eager" : "lazy"}
        />
      ))}
      {hasMultiple && (
        <>
          <button
            onClick={(e) => goTo("prev", e)}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 h-7 w-7 rounded-full bg-background/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 border border-border/30 hover:bg-background/80"
          >
            <ChevronLeft className="h-3.5 w-3.5 text-foreground" />
          </button>
          <button
            onClick={(e) => goTo("next", e)}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-7 w-7 rounded-full bg-background/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 border border-border/30 hover:bg-background/80"
          >
            <ChevronRight className="h-3.5 w-3.5 text-foreground" />
          </button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-300">
            {photos.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setActiveIdx(i); }}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === activeIdx ? "w-4 bg-primary" : "w-1.5 bg-foreground/40"
                }`}
              />
            ))}
          </div>
          <div className="absolute top-3 right-3 z-10 text-[8px] tracking-[0.15em] uppercase px-2 py-1 bg-background/50 backdrop-blur-sm text-foreground/80 rounded-sm opacity-0 group-hover:opacity-100 transition-all duration-300 border border-border/20" style={{ fontFamily: "var(--font-heading)" }}>
            {activeIdx + 1}/{photos.length}
          </div>
        </>
      )}
    </div>
  );
};

interface ProfileData {
  full_name: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  cover_position: number;
  bio: string | null;
  portfolio_url: string | null;
  photography_interests: string[] | null;
  created_at: string;
  facebook_url: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
  youtube_url: string | null;
  website_url: string | null;
  privacy_settings: Record<string, string> | null;
  pronouns?: string | null;
  current_city?: string | null;
  workplace?: string | null;
  education?: string | null;
  cover_video_url?: string | null;
}

interface CompEntry {
  id: string;
  title: string;
  description: string | null;
  photos: string[];
  status: string;
  placement: string | null;
  competition_id: string;
  competition: { title: string; phase: string; current_round: string | null } | null;
  exif_data: any;
  /** SOW EXIF v2: per-photo metadata (preferred over legacy exif_data). */
  photo_meta: any[] | null;
}

interface Certificate {
  id: string;
  title: string;
  type: string;
  issued_at: string;
}

interface JournalArticle {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  tags: string[];
}

interface CourseItem {
  id: string;
  title: string;
  slug: string;
  cover_image_url: string | null;
  category: string;
  difficulty: string;
}

interface FeaturedPhotoItem {
  id: string;
  image_url: string;
  title: string | null;
}

interface EarnedStamp {
  label: string;
  color: string;
  icon: string | null;
  image_url: string | null;
  count: number;
}

interface JudgeFeedbackItem {
  entry_title: string;
  score: number;
  feedback: string | null;
  photo_index: number;
}

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };
const displayFont = { fontFamily: "var(--font-display)" };

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
});

const PublicProfileInner = ({ userId }: { userId: string }) => {
  const { user: currentUser } = useAuth();
  const coverMutation = useUpdateCover();
  const [searchParams] = useSearchParams();
  const wallSectionRef = useRef<HTMLDivElement>(null);

  // React Query: core profile data (cached + prefetched)
  const { data: coreProfile, isLoading: coreLoading, isError: coreError } = useProfileCore(userId);

  // React Query: extended data (entries, badges, etc.) — only for authenticated
  const { data: extData } = useProfileExtended(userId, currentUser?.id);

  // Local state for things that mutate (cover reposition, etc.)
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<{ src: string; title: string; desc?: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"wall" | "works" | "about">("wall");
  const [repositionMode, setRepositionMode] = useState(false);
  const [dragPosition, setDragPosition] = useState(50);
  const [savedPosition, setSavedPosition] = useState(50);
  const dragRef = useRef<{ startY: number; startPos: number } | null>(null);
  const coverContainerRef = useRef<HTMLDivElement>(null);
  const [earnedStamps, setEarnedStamps] = useState<EarnedStamp[]>([]);
  const [judgeFeedback, setJudgeFeedback] = useState<JudgeFeedbackItem[]>([]);
  const isGuest = !currentUser;

  // Sync core profile into local state
  useEffect(() => {
    if (coreProfile) {
      setProfile((prev) => ({
        ...(prev || {} as ProfileData),
        ...coreProfile,
        privacy_settings: extData?.privacySettings ?? coreProfile.privacy_settings,
      }));
      setDragPosition(coreProfile.cover_position);
      setSavedPosition(coreProfile.cover_position);
    }
  }, [coreProfile, extData?.privacySettings]);

  // Auto-scroll to wall section when ?section=wall
  useEffect(() => {
    if (searchParams.get("section") === "wall" && wallSectionRef.current && coreProfile) {
      setTimeout(() => {
        wallSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 400);
    }
  }, [searchParams, coreProfile]);

  const entries = extData?.entries || [];
  const certificates = extData?.certificates || [];
  const articles = extData?.articles || [];
  const coursesCreated = extData?.courses || [];
  const featuredPhotos = extData?.featuredPhotos || [];
  const isVerifiedPhotographer = extData?.isVerifiedPhotographer || false;
  const isStudent = extData?.isStudent || false;
  const userBadges = extData?.userBadges || [];
  const isFriend = extData?.isFriend || false;

  // Judging v5 — strict per-round publish gate. Hide winner/finalist/placement
  // until admin has published the relevant round in the admin Competitions panel.
  // Internal `entries[i].status` reflects competition_entries.status (judge-side
  // truth) — never trust it for public-facing badges; always read via this map.
  const publicStatus = useEntryPublicStatus(entries.map((e: any) => e.id)).data || {};
  const visibleStatus = (entryId: string, fallback?: string) =>
    publicStatus[entryId]?.public_status ?? "judging_in_progress";
  const visiblePlacement = (entryId: string) =>
    publicStatus[entryId]?.public_placement ?? null;
  const isPublicWinner = (entryId: string) => visibleStatus(entryId) === "winner";

  // Load earned stamps + judge feedback (secondary, only when entries available)
  useEffect(() => {
    if (!entries.length) { setEarnedStamps([]); setJudgeFeedback([]); return; }
    const entryIds = entries.map((e: any) => e.id);
    const compIds = [...new Set(entries.map((e: any) => e.competition_id).filter(Boolean))];

    const loadStamps = async () => {
      // Admin declaration gate: public profile stamps must not reveal judge tags
      // until competition_round_publish.published_at is set for that tag round.
      // HOTFIX-G: read tag assignments from publish-gated owner-safe view
      // (no judge_id leak; zero rows pre-publication). Tag metadata is
      // hydrated via a separate `judging_tags` lookup below.
      const [{ data: tagAssignRows }, { data: publishRows }] = await Promise.all([
        supabase
          .from("judge_tag_assignments_owner_safe" as any)
          .select("tag_id, entry_id")
          .in("entry_id", entryIds),
        compIds.length > 0
          ? supabase.from("competition_round_publish").select("competition_id, round_number, published_at").in("competition_id", compIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const tagIdsForMeta = [...new Set(((tagAssignRows as any[]) || []).map((r) => r.tag_id).filter(Boolean))];
      const { data: tagMetaRows } = tagIdsForMeta.length > 0
        ? await supabase
            .from("judging_tags" as any)
            .select("id, label, color, icon, image_url, visible_in_round")
            .in("id", tagIdsForMeta)
        : { data: [] as any[] };
      const tagMetaById = new Map<string, any>(((tagMetaRows as any[]) || []).map((t) => [t.id, t]));
      const tagAssignments = ((tagAssignRows as any[]) || []).map((r) => ({
        ...r,
        judging_tags: tagMetaById.get(r.tag_id) || null,
      }));
      const publishedRoundsByComp = new Map<string, Set<number>>();
      ((publishRows as any[]) || []).forEach((r: any) => {
        if (r.published_at == null) return;
        const set = publishedRoundsByComp.get(r.competition_id) || new Set<number>();
        set.add(Number(r.round_number));
        publishedRoundsByComp.set(r.competition_id, set);
      });
      const compIdByEntry = new Map<string, string>(entries.map((e: any) => [e.id, e.competition_id]));
      const visibleTagAssignments = (tagAssignments as any[] || []).filter((ta: any) => {
        const tag = ta.judging_tags;
        if (!tag) return false;
        const compId = compIdByEntry.get(ta.entry_id);
        if (!compId) return false;
        const rounds: number[] = Array.isArray(tag.visible_in_round) ? tag.visible_in_round.map((n: any) => Number(n)) : [];
        const published = publishedRoundsByComp.get(compId) || new Set<number>();
        if (rounds.length === 0) return published.has(4);
        return rounds.some((rn) => published.has(rn));
      });
      if (visibleTagAssignments.length > 0) {
        const stampMap = new Map<string, EarnedStamp>();
        visibleTagAssignments.forEach((ta: any) => {
          const tag = ta.judging_tags;
          if (!tag) return;
          const key = tag.label;
          if (stampMap.has(key)) stampMap.get(key)!.count++;
          else stampMap.set(key, { label: tag.label, color: tag.color, icon: tag.icon, image_url: tag.image_url, count: 1 });
        });
        setEarnedStamps(Array.from(stampMap.values()));
      } else {
        setEarnedStamps([]);
      }
    };
    loadStamps();

    // Judge feedback (owner only) — SOW: only released after phase='result'.
    if (currentUser?.id === userId && entryIds.length > 0 && compIds.length > 0) {
      supabase
        .from("competitions")
        .select("id, phase")
        .in("id", compIds)
        .then(({ data: comps }) => {
          const releasedCompIds = new Set(
            ((comps as any[]) || []).filter((c: any) => c.phase === "result").map((c: any) => c.id),
          );
          if (releasedCompIds.size === 0) { setJudgeFeedback([]); return; }
          const releasedEntryIds = entries.filter((e: any) => releasedCompIds.has(e.competition_id)).map((e: any) => e.id);
          if (releasedEntryIds.length === 0) { setJudgeFeedback([]); return; }
          supabase.from("judge_scores").select("entry_id, score, feedback, photo_index").in("entry_id", releasedEntryIds).then(({ data: scores }) => {
            if (scores && scores.length > 0) {
              const entryMap = new Map(entries.map((e: any) => [e.id, e.title]));
              setJudgeFeedback(scores.map((s: any) => ({
                entry_title: entryMap.get(s.entry_id) || "Entry",
                score: s.score, feedback: s.feedback, photo_index: s.photo_index,
              })));
            } else {
              setJudgeFeedback([]);
            }
          });
        });
    }

    // Track profile view (non-blocking)
    if (currentUser && currentUser.id !== userId) {
      supabase.from("profile_views" as any).insert({ profile_id: userId, viewer_id: currentUser.id } as any).then(() => {});
    }
  }, [entries, userId, currentUser?.id]);

  // Loading: show Facebook-style skeleton
  if (coreLoading || (!profile && !coreError)) {
    return <ProfileSkeleton />;
  }

  if (coreError || !profile) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-6">
        <User className="h-12 w-12 text-muted-foreground/30" />
        <p className="text-muted-foreground text-sm" style={bodyFont}>This profile doesn't exist.</p>
        <Link to="/" className="text-xs tracking-[0.15em] uppercase text-primary hover:underline" style={headingFont}>
          Back to Home
        </Link>
      </main>
    );
  }

  const displayName = profile.full_name || "Photographer";
  const memberSince = new Date(profile.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const isOwner = currentUser?.id === userId;
  const ps = profile.privacy_settings;
  const canView = (field: string) => canViewField(getPrivacy(ps, field), isOwner, isFriend);

  const socialLinks = canView("social_links") ? [
    profile.facebook_url && { icon: Facebook, label: "Facebook", url: profile.facebook_url },
    profile.instagram_url && { icon: Instagram, label: "Instagram", url: profile.instagram_url },
    profile.twitter_url && { icon: Twitter, label: "X", url: profile.twitter_url },
    profile.youtube_url && { icon: Youtube, label: "YouTube", url: profile.youtube_url },
    profile.website_url && { icon: Globe, label: "Website", url: profile.website_url },
    canView("portfolio") && profile.portfolio_url && !profile.website_url && { icon: Globe, label: "Portfolio", url: profile.portfolio_url },
  ].filter(Boolean) as { icon: any; label: string; url: string }[] : [];

  const worksCount = entries.length + featuredPhotos.length + articles.length + coursesCreated.length;
  const tabs = [
    { key: "wall" as const, label: "Wall" },
    { key: "works" as const, label: "Works", count: worksCount },
    { key: "about" as const, label: "About" },
  ];

    const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.[0] || !isOwner || !currentUser) return;
      const file = e.target.files[0];
      try {
        const safe = await scanFileWithToast(file, toast, { allowedTypes: "image" });
        if (!safe) return;
        const { webpFile } = await compressImageToFiles(file, "cover", { maxDimension: 1920, webpQuality: 0.92 });
        const path = generateImagePath({ userId: currentUser.id, type: "cover", ext: "webp" });
        const result = await uploadImage({ bucket: "avatars", file: webpFile, path, type: "cover", fileName: "cover.webp" });
        const url = `${result.url}?t=${Date.now()}`;
        await coverMutation.mutateAsync({ coverUrl: url, coverPosition: 50, storagePath: path });
        setProfile((prev) => prev ? { ...prev, cover_url: url, cover_position: 50 } : prev);
        setDragPosition(50);
        setSavedPosition(50);
        setRepositionMode(true);
        // Auto-post to wall like Facebook
        await createProfileUpdatePost(currentUser.id, "cover", url);
        toast({ title: "Cover photo updated! Drag to reposition." });
      } catch (err: any) {
        toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      }
    };

    const handleRepositionStart = () => {
      setRepositionMode(true);
      setDragPosition(savedPosition);
    };

    const handleRepositionSave = async () => {
      if (!currentUser) return;
      await coverMutation.mutateAsync({ coverPosition: dragPosition });
      setSavedPosition(dragPosition);
      setProfile((prev) => prev ? { ...prev, cover_position: dragPosition } : prev);
      setRepositionMode(false);
      toast({ title: "Cover position saved!" });
    };

    const handleRepositionCancel = () => {
      setDragPosition(savedPosition);
      setRepositionMode(false);
    };

    const onCoverPointerDown = (e: React.PointerEvent) => {
      if (!repositionMode) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { startY: e.clientY, startPos: dragPosition };
    };

    const onCoverPointerMove = (e: React.PointerEvent) => {
      if (!dragRef.current || !coverContainerRef.current) return;
      const containerH = coverContainerRef.current.getBoundingClientRect().height;
      const deltaY = e.clientY - dragRef.current.startY;
      // Moving mouse down → shows upper part → decrease %, moving up → increase %
      const deltaPct = -(deltaY / containerH) * 100;
      const newPos = Math.max(0, Math.min(100, dragRef.current.startPos + deltaPct));
      setDragPosition(newPos);
    };

    const onCoverPointerUp = () => {
      dragRef.current = null;
    };

    const coverPosition = repositionMode ? dragPosition : (profile.cover_position ?? 50);

    return (
    <main className="min-h-screen bg-background text-foreground">
      <PageSEO
        title={displayName}
        description={profile.bio ? profile.bio.slice(0, 155) : `${displayName}'s photography profile on 50mm Retina World.`}
        ogImage={profile.avatar_url || undefined}
      />
      {/* ═══ FACEBOOK-STYLE PROFILE HEADER ═══ */}
      <section className="relative bg-background">
        {/* ── Cover Photo ── */}
        <div className="container mx-auto max-w-7xl px-0 sm:px-4">
        <div
          ref={coverContainerRef}
          className={`relative overflow-hidden bg-gradient-to-br from-muted via-muted/80 to-muted/60 sm:rounded-b-xl ${repositionMode ? "cursor-grab active:cursor-grabbing" : ""}`}
          style={{ aspectRatio: "3/1" }}
          onPointerDown={onCoverPointerDown}
          onPointerMove={onCoverPointerMove}
          onPointerUp={onCoverPointerUp}
        >
          {profile.cover_video_url ? (
            <video
              src={profile.cover_video_url}
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover select-none pointer-events-none"
              style={{ objectPosition: `center ${coverPosition}%` }}
            />
          ) : profile.cover_url ? (
            <img loading="eager" decoding="async" fetchPriority="high"
              src={profile.cover_url}
              alt="Cover"
              className="w-full h-full object-cover select-none pointer-events-none"
              style={{ objectPosition: `center ${coverPosition}%` }}
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-muted to-accent/5" />
          )}
          {/* Gradient overlay at bottom for text readability */}
          {!repositionMode && (
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
          )}

          {/* Reposition toolbar */}
          {repositionMode && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-background/90 backdrop-blur-sm border border-border rounded-sm px-4 py-2 shadow-lg">
              <Move className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] tracking-[0.12em] uppercase text-foreground" style={headingFont}>
                Drag to reposition
              </span>
              <div className="w-px h-4 bg-border mx-1" />
              <button
                onClick={handleRepositionSave}
                className="inline-flex items-center gap-1 text-[10px] tracking-[0.12em] uppercase px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-sm"
                style={headingFont}
              >
                <Check className="h-3 w-3" /> Save
              </button>
              <button
                onClick={handleRepositionCancel}
                className="inline-flex items-center gap-1 text-[10px] tracking-[0.12em] uppercase px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground transition-colors rounded-sm"
                style={headingFont}
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
          )}

          {/* Cover edit button for owner */}
          {isOwner && !repositionMode && (
            <div className="absolute bottom-4 right-4 sm:right-6 z-10">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="inline-flex items-center gap-2 text-[10px] tracking-[0.12em] uppercase px-4 py-2 bg-background/80 backdrop-blur-sm text-foreground border border-border hover:bg-background hover:border-primary transition-all duration-300 rounded-sm"
                    style={headingFont}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit Cover
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {profile.cover_url && (
                    <DropdownMenuItem onClick={handleRepositionStart} className="cursor-pointer gap-2">
                      <Move className="h-3.5 w-3.5" />
                      Reposition
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="cursor-pointer gap-2 p-0">
                    <label className="flex items-center gap-2 w-full px-2 py-1.5 cursor-pointer">
                      <ImagePlus className="h-3.5 w-3.5" />
                      {profile.cover_url ? "Change Cover" : "Add Cover Photo"}
                      <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
                    </label>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        </div>

        {/* ── Profile Info Section (overlaps cover like Facebook) ── */}
        <div className="container mx-auto max-w-7xl px-4 relative">
          {/* Desktop: Two rows — Row 1: Avatar + Name | Buttons — Row 2: Stats below name */}
          <div className="hidden sm:block">
            {/* Row 1: Avatar + Name + Verified + Buttons */}
            <div className="flex items-end justify-between w-full">
              {/* Left: Avatar + Name */}
              <div className="flex items-end gap-5 min-w-0">
                {/* Avatar with overlap */}
                <div className="relative flex-shrink-0 z-10 -mt-[80px]">
                  {canView("avatar") && profile.avatar_url ? (
                    <img loading="lazy" decoding="async"
                      src={profile.avatar_url}
                      alt={displayName}
                      className="h-[140px] w-[140px] rounded-full object-cover border-[4px] border-background shadow-xl"
                    />
                  ) : (
                    <div className="h-[140px] w-[140px] rounded-full bg-muted border-[4px] border-background flex items-center justify-center shadow-xl">
                      <Camera className="h-10 w-10 text-muted-foreground/30" />
                    </div>
                  )}
                </div>

                {/* Name + Badge (line 1) + Roles (line 2) */}
                <div className="min-w-0 flex flex-col justify-end pb-1.5">
                  <UserIdentityBlock
                    userId={userId || ""}
                    name={displayName}
                    size="full"
                    nameClassName="text-base md:text-lg font-bold tracking-tight leading-none [font-family:var(--font-display)]"
                  />
                </div>
              </div>
            </div>

              {/* Actions row */}
              <div className="flex items-start justify-end mt-1.5" style={{ paddingLeft: "160px" }}>
                <div className="flex items-center gap-2 shrink-0">
                  {!isOwner && !isGuest && <FriendFollowButtons targetUserId={userId!} />}
                  {isOwner && (
                    <Link
                      to="/edit-profile"
                      className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.1em] font-semibold uppercase px-3 py-1.5 bg-muted hover:bg-accent text-foreground rounded-md border border-border transition-colors"
                      style={headingFont}
                    >
                      <Pencil className="h-3 w-3" />
                      Edit Profile
                    </Link>
                  )}
                  {isGuest && (
                    <Link
                      to="/signup"
                      className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.1em] font-semibold uppercase px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90 rounded-md transition-opacity"
                      style={headingFont}
                    >
                      Follow
                    </Link>
                  )}
                </div>
              </div>

            {/* Row 2: Stats + Mutual Friends — aligned under buttons */}
            <div className="flex items-center justify-between mt-1" style={{ paddingLeft: "160px" }}>
              <div className="flex items-center gap-4">
                {!isOwner && !isGuest && (
                  <MutualFriends targetUserId={userId!} />
                )}
                {canView("member_since") && (
                  <span className="text-[10px] text-muted-foreground" style={bodyFont}>
                    Joined {memberSince}
                  </span>
                )}
              </div>
              {!isGuest && (
                <div className="flex items-center gap-0 shrink-0">
                  <FriendFollowStats targetUserId={userId!} />
                </div>
              )}
            </div>
          </div>

          {/* ═══ MOBILE: Centered stack ═══ */}
          <div className="flex sm:hidden flex-col items-center -mt-[50px] gap-1.5">
            {/* Avatar */}
            <div className="relative z-10">
              {canView("avatar") && profile.avatar_url ? (
                <img loading="eager" decoding="async" fetchPriority="high" src={profile.avatar_url} alt={displayName} className="h-[100px] w-[100px] rounded-full object-cover border-[3px] border-background shadow-xl" />
              ) : (
                <div className="h-[100px] w-[100px] rounded-full bg-muted border-[3px] border-background flex items-center justify-center shadow-xl">
                  <Camera className="h-8 w-8 text-muted-foreground/30" />
                </div>
              )}
            </div>

            <UserIdentityBlock
              userId={userId || ""}
              name={displayName}
              size="full"
              className="items-center mt-1"
              nameClassName="text-base font-bold tracking-tight leading-none [font-family:var(--font-display)]"
            />

            {canView("member_since") && (
              <p className="text-[10px] text-muted-foreground" style={bodyFont}>
                Joined {memberSince}
              </p>
            )}

            {!isGuest && (
              <div className="flex items-center gap-3 text-xs" style={bodyFont}>
                <FriendFollowStats targetUserId={userId!} />
              </div>
            )}

            {!isOwner && !isGuest && <MutualFriends targetUserId={userId!} />}

            <div className="flex items-center gap-2 mt-1">
              {!isOwner && !isGuest && <FriendFollowButtons targetUserId={userId!} />}
              {isOwner && (
                <Link to="/edit-profile" className="inline-flex items-center gap-2 text-[10px] tracking-[0.08em] font-semibold px-4 py-2 bg-muted hover:bg-accent text-foreground rounded-md border border-border transition-colors" style={headingFont}>
                  <Pencil className="h-3.5 w-3.5" /> Edit Profile
                </Link>
              )}
              {isGuest && (
                <Link to="/signup" className="inline-flex items-center gap-2 text-[10px] tracking-[0.08em] font-semibold px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 rounded-md transition-opacity" style={headingFont}>
                  Follow
                </Link>
              )}
            </div>
          </div>

          {/* Separator */}
          <div className="border-b border-border mt-4" />
        </div>
      </section>

      {/* ═══ Guest Join Wall ═══ */}
      {isGuest && (
        <>
          {/* Show a preview of about info for guests */}
          <div className="container mx-auto max-w-7xl py-6 space-y-4">
            {profile.bio && (
              <div className="border border-border p-5 space-y-3">
                <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                  <User className="h-3.5 w-3.5 text-primary" />
                  About
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed" style={bodyFont}>{profile.bio}</p>
              </div>
            )}
            {((profile as any).workplace || (profile as any).education || (profile as any).current_city) && (
              <div className="border border-border p-5 space-y-3">
                {(profile as any).workplace && (
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <Briefcase className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm" style={bodyFont}>{(profile as any).workplace}</p>
                      <span className="text-[10px] text-muted-foreground" style={headingFont}>Workplace</span>
                    </div>
                  </div>
                )}
                {(profile as any).education && (
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <GraduationCap className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm" style={bodyFont}>{(profile as any).education}</p>
                      <span className="text-[10px] text-muted-foreground" style={headingFont}>Education</span>
                    </div>
                  </div>
                )}
                {(profile as any).current_city && (
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm" style={bodyFont}>{(profile as any).current_city}</p>
                      <span className="text-[10px] text-muted-foreground" style={headingFont}>Current City</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {socialLinks.length > 0 && (
              <div className="border border-border p-5 space-y-3">
                <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                  <Heart className="h-3.5 w-3.5 text-primary" />
                  Links
                </h3>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {socialLinks.map((link) => (
                    <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors" style={bodyFont}>
                      <link.icon className="h-3.5 w-3.5" />
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
          <PublicProfileJoinWall />
        </>
      )}

      {/* ═══ Stories & Highlights (visible to everyone) ═══ */}
      <div className="container mx-auto max-w-7xl py-3 md:py-4">
        <ProfileStories userId={userId!} isOwner={isOwner} />
      </div>

      {/* ═══ Authenticated User Content ═══ */}
      {!isGuest && (
        <>

      {/* ═══ Tabs Navigation ═══ */}
      <div className="bg-background sticky top-0 z-20 border-b border-border">
        <div className="container mx-auto max-w-7xl">
          <div className="flex items-center gap-0">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative px-5 py-3.5 text-[11px] tracking-[0.15em] uppercase transition-colors duration-300 ${
                  activeTab === tab.key
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                style={headingFont}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="ml-1.5 text-[9px] text-muted-foreground">({tab.count})</span>
                )}
                {activeTab === tab.key && (
                  <motion.div
                    layoutId="profile-tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                    transition={{ duration: 0.3 }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ Main Content ═══ */}
      <div className="mx-auto max-w-7xl py-6 px-0 sm:container sm:px-4">
        {/* Social Links inline */}
        {socialLinks.length > 0 && (
          <div className="border border-border p-4 mb-6">
            <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground mb-3" style={headingFont}>
              Links
            </h3>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {socialLinks.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors py-1"
                  style={bodyFont}
                >
                  <link.icon className="h-3.5 w-3.5" />
                  {link.label}
                  <ExternalLink className="h-2.5 w-2.5 opacity-40" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Content area */}
        <div ref={wallSectionRef}>
            {/* Wall Tab */}
            {activeTab === "wall" && (
              <motion.div
                key="wall"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              >
                <WallPosts targetUserId={userId!} isOwnWall={currentUser?.id === userId} />
              </motion.div>
            )}

            {/* Works Tab */}
            {activeTab === "works" && (
              <motion.div
                key="works"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                {worksCount === 0 && earnedStamps.length === 0 && judgeFeedback.length === 0 ? (
                  <div className="border border-dashed border-border p-12 text-center">
                    <Camera className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
                    <p className="text-xs text-muted-foreground" style={bodyFont}>
                      No works to show yet.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* ── Category Stats & Earned Stamps Row ── */}
                    {(entries.length > 0 || earnedStamps.length > 0) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Category Stats */}
                        {entries.length > 0 && (() => {
                          const winners = entries.filter((e: any) => isPublicWinner(e.id));
                          const catCounts: Record<string, number> = {};
                          entries.forEach(e => {
                            const comp = e.competition as any;
                            const cat = comp?.title?.split(" ")[0] || "General";
                            catCounts[cat] = (catCounts[cat] || 0) + 1;
                          });
                          return (
                            <div className="border border-border p-5 space-y-3">
                              <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                                <BarChart3 className="h-3.5 w-3.5 text-primary" />
                                Photography Stats
                              </h3>
                              <div className="grid grid-cols-3 gap-3 text-center">
                                <div>
                                  <p className="text-2xl font-light" style={displayFont}>{entries.length}</p>
                                  <span className="text-[9px] tracking-[0.12em] uppercase text-muted-foreground" style={headingFont}>Submissions</span>
                                </div>
                                <div>
                                  <p className="text-2xl font-light text-primary" style={displayFont}>{winners.length}</p>
                                  <span className="text-[9px] tracking-[0.12em] uppercase text-muted-foreground" style={headingFont}>Awards</span>
                                </div>
                                <div>
                                  <p className="text-2xl font-light" style={displayFont}>{Object.keys(catCounts).length}</p>
                                  <span className="text-[9px] tracking-[0.12em] uppercase text-muted-foreground" style={headingFont}>Competitions</span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Earned Judging Stamps */}
                        {earnedStamps.length > 0 && (
                          <div className="border border-border p-5 space-y-3">
                            <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                              <Award className="h-3.5 w-3.5 text-primary" />
                              Judging Awards
                            </h3>
                            <div className="flex flex-wrap gap-2">
                              {earnedStamps.map((stamp) => (
                                <div key={stamp.label} className="flex items-center gap-1.5">
                                  <JudgingStampBadge
                                    label={participantLabelForJudgingTag(stamp.label)}
                                    color={stamp.color}
                                    icon={stamp.icon || "award"}
                                    imageUrl={stamp.image_url}
                                    size="sm"
                                  />
                                  {stamp.count > 1 && (
                                    <span className="text-[9px] text-muted-foreground" style={headingFont}>×{stamp.count}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Awards & Placements ── */}
                    {entries.filter((e: any) => isPublicWinner(e.id)).length > 0 && (
                      <div className="border border-border p-5 space-y-4">
                        <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                          <Trophy className="h-3.5 w-3.5 text-primary" />
                          Awards & Placements
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          {entries.filter((e: any) => isPublicWinner(e.id)).map((entry: any) => (
                            <div
                              key={entry.id}
                              className="group relative cursor-pointer border border-primary/20 bg-primary/5 overflow-hidden"
                              onClick={() => entry.photos[0] && setLightboxPhoto({ src: entry.photos[0], title: entry.title, desc: entry.description || undefined })}
                            >
                              <div className="relative aspect-[4/3] overflow-hidden">
                                <MiniCarousel photos={entry.photos} alt={entry.title} className="w-full h-full" />
                                {entry.competition && (
                                  <PhaseWatermark
                                    phase={(entry.competition as any).phase}
                                    currentRound={(entry.competition as any).current_round ?? null}
                                    surface="card"
                                  />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent pointer-events-none" />
                                <div className="absolute top-2 left-2 z-10">
                                  <span className="text-[8px] tracking-[0.15em] uppercase px-2 py-0.5 bg-primary text-primary-foreground inline-flex items-center gap-1" style={headingFont}>
                                    <Trophy className="h-2.5 w-2.5" />
                                    {visiblePlacement(entry.id) || "Winner"}
                                  </span>
                                </div>
                                <div className="absolute bottom-0 left-0 right-0 p-3">
                                  {entry.competition && (
                                    <span className="text-[8px] tracking-[0.15em] uppercase text-primary/70 block mb-0.5" style={headingFont}>
                                      {(entry.competition as any).title}
                                    </span>
                                  )}
                                  <h4 className="text-sm font-medium truncate text-foreground" style={headingFont}>{entry.title}</h4>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Featured Photos ── */}
                    {featuredPhotos.length > 0 && (
                      <div className="border border-border p-5 space-y-4">
                        <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                          <Star className="h-3.5 w-3.5 text-primary" />
                          Featured Photos
                        </h3>
                        <div className="grid grid-cols-3 gap-2">
                          {featuredPhotos.map((photo) => (
                            <div
                              key={photo.id}
                              className="group relative cursor-pointer aspect-square overflow-hidden"
                              onClick={() => setLightboxPhoto({ src: photo.image_url, title: photo.title || "Featured Photo" })}
                            >
                              <img src={photo.thumbnail_url || photo.image_url} alt={photo.title || "Featured"} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                <Expand className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Photo Albums ── */}
                    <PhotoAlbums userId={userId} isOwner={false} />

                    {/* ── Competition Entries ── */}
                    {entries.length > 0 && (
                      <div className="space-y-4">
                        <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                          <Image className="h-3.5 w-3.5 text-primary" />
                          Competition Submissions
                        </h3>
                        {/* Hero piece */}
                        {(() => {
                          const hero = entries[0];
                          if (!hero || !hero.photos[0]) return null;
                          return (
                            <div
                              className="relative group cursor-pointer border border-border overflow-hidden"
                              onClick={() => setLightboxPhoto({ src: hero.photos[0], title: hero.title, desc: hero.description || undefined })}
                            >
                              <div className="relative overflow-hidden aspect-[16/9]">
                                <MiniCarousel photos={hero.photos} alt={hero.title} className="w-full h-full" />
                                {hero.competition && (
                                  <PhaseWatermark
                                    phase={(hero.competition as any).phase}
                                    currentRound={(hero.competition as any).current_round ?? null}
                                    surface="card"
                                  />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent pointer-events-none" />
                                {isPublicWinner(hero.id) && (
                                  <div className="absolute top-4 left-4">
                                    <span className="text-[9px] tracking-[0.2em] uppercase px-3 py-1 bg-primary text-primary-foreground inline-flex items-center gap-1.5" style={headingFont}>
                                      <Award className="h-3 w-3" /> Winner
                                    </span>
                                  </div>
                                )}
                                <div className="absolute top-4 right-4 h-8 w-8 rounded-full bg-background/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                                  <Expand className="h-3.5 w-3.5 text-foreground" />
                                </div>
                                <div className="absolute bottom-0 left-0 right-0 p-5">
                                  {hero.competition && (
                                    <span className="text-[9px] tracking-[0.2em] uppercase text-primary/80 block mb-1" style={headingFont}>
                                      {(hero.competition as any).title}
                                    </span>
                                  )}
                                  <h3 className="text-xl md:text-2xl font-light tracking-tight text-foreground" style={displayFont}>
                                    {hero.title}
                                  </h3>
                                  {/* EXIF data badge — SOW v2: prefer per-photo photo_meta[0].exif, fallback to legacy single-blob exif_data */}
                                  {(() => {
                                    const heroExif = (Array.isArray(hero.photo_meta) && hero.photo_meta[0]?.exif) || hero.exif_data;
                                    if (!heroExif) return null;
                                    return (
                                      <div className="flex flex-wrap gap-2 mt-2">
                                        {heroExif?.camera && (
                                          <span className="text-[8px] tracking-[0.1em] uppercase px-2 py-0.5 bg-background/50 backdrop-blur-sm text-foreground/70 border border-border/30 rounded-sm" style={headingFont}>
                                            📷 {heroExif.camera}
                                          </span>
                                        )}
                                        {heroExif?.lens && (
                                          <span className="text-[8px] tracking-[0.1em] uppercase px-2 py-0.5 bg-background/50 backdrop-blur-sm text-foreground/70 border border-border/30 rounded-sm" style={headingFont}>
                                            🔭 {heroExif.lens}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Grid */}
                        {entries.length > 1 && (
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {entries.slice(1).map((entry) => (
                              <div
                                key={entry.id}
                                className="group relative cursor-pointer border border-border overflow-hidden"
                                onClick={() => entry.photos[0] && setLightboxPhoto({ src: entry.photos[0], title: entry.title, desc: entry.description || undefined })}
                              >
                                <div className="relative overflow-hidden aspect-square">
                                  <MiniCarousel photos={entry.photos} alt={entry.title} className="w-full h-full" />
                                  {entry.competition && (
                                    <PhaseWatermark
                                      phase={(entry.competition as any).phase}
                                      currentRound={(entry.competition as any).current_round ?? null}
                                      surface="card"
                                    />
                                  )}
                                  <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none" />
                                  {isPublicWinner(entry.id) && (
                                    <div className="absolute top-2 left-2 z-10">
                                      <span className="text-[8px] tracking-[0.15em] uppercase px-2 py-0.5 bg-primary text-primary-foreground inline-flex items-center gap-1" style={headingFont}>
                                        <Trophy className="h-2.5 w-2.5" /> Winner
                                      </span>
                                    </div>
                                  )}
                                  <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
                                    <h3 className="text-xs font-medium truncate text-foreground" style={headingFont}>
                                      {entry.title}
                                    </h3>
                                    {entry.competition && (
                                      <span className="text-[8px] text-muted-foreground" style={headingFont}>{(entry.competition as any).title}</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Published Articles ── */}
                    {articles.length > 0 && (
                      <div className="border border-border p-5 space-y-4">
                        <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                          <FileText className="h-3.5 w-3.5 text-primary" />
                          Published Articles
                        </h3>
                        <div className="space-y-3">
                          {articles.map((article) => (
                            <Link
                              key={article.id}
                              to={`/journal/${article.slug}`}
                              className="flex gap-4 p-3 border border-border hover:border-primary/30 transition-colors group"
                            >
                              {article.cover_image_url && (
                                <img loading="lazy" decoding="async" src={article.cover_image_url} alt={article.title} className="w-20 h-14 object-cover flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <h4 className="text-sm font-medium truncate group-hover:text-primary transition-colors" style={headingFont}>{article.title}</h4>
                                {article.excerpt && (
                                  <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1" style={bodyFont}>{article.excerpt}</p>
                                )}
                                <div className="flex items-center gap-2 mt-1.5">
                                  {article.published_at && (
                                    <span className="text-[9px] text-muted-foreground" style={headingFont}>
                                      {new Date(article.published_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                                    </span>
                                  )}
                                  {article.tags.slice(0, 2).map(tag => (
                                    <span key={tag} className="text-[8px] px-1.5 py-0.5 border border-border text-muted-foreground rounded-sm" style={headingFont}>{tag}</span>
                                  ))}
                                </div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Courses Created ── */}
                    {coursesCreated.length > 0 && (
                      <div className="border border-border p-5 space-y-4">
                        <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                          <Layers className="h-3.5 w-3.5 text-primary" />
                          Courses Created
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {coursesCreated.map((course) => (
                            <Link
                              key={course.id}
                              to={`/courses/${course.slug}`}
                              className="border border-border overflow-hidden group hover:border-primary/30 transition-colors"
                            >
                              {course.cover_image_url && (
                                <img loading="lazy" decoding="async" src={course.cover_image_url} alt={course.title} className="w-full h-32 object-cover" />
                              )}
                              <div className="p-3">
                                <h4 className="text-sm font-medium truncate group-hover:text-primary transition-colors" style={headingFont}>{course.title}</h4>
                                <div className="flex items-center gap-2 mt-1.5">
                                  <span className="text-[8px] tracking-[0.1em] uppercase px-1.5 py-0.5 border border-border text-muted-foreground rounded-sm" style={headingFont}>{course.category}</span>
                                  <span className="text-[8px] tracking-[0.1em] uppercase px-1.5 py-0.5 border border-border text-muted-foreground rounded-sm" style={headingFont}>{course.difficulty}</span>
                                </div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Judge Feedback (Owner Only) ── */}
                    {isOwner && judgeFeedback.length > 0 && (
                      <div className="border border-border p-5 space-y-4">
                        <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                          <MessageSquare className="h-3.5 w-3.5 text-primary" />
                          Judge Feedback
                          <span className="text-[8px] px-1.5 py-0.5 bg-muted text-muted-foreground rounded-sm" style={headingFont}>Only You</span>
                        </h3>
                        <div className="space-y-2">
                          {judgeFeedback.slice(0, 10).map((fb, i) => (
                            <div key={i} className="flex items-start gap-3 p-3 bg-muted/30 border border-border">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <span className="text-sm font-bold text-primary" style={displayFont}>{fb.score}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <h4 className="text-xs font-medium truncate" style={headingFont}>{fb.entry_title}</h4>
                                  <span className="text-[8px] text-muted-foreground" style={headingFont}>Photo #{fb.photo_index + 1}</span>
                                </div>
                                {fb.feedback && (
                                  <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2" style={bodyFont}>{fb.feedback}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}

            {/* About Tab */}
            {activeTab === "about" && (
              <motion.div
                key="about"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="space-y-4"
              >
                {/* ── Overview ── */}
                {(canView("bio") && profile.bio) || (canView("pronouns") && (profile as any).pronouns) ? (
                  <div className="border border-border p-5 space-y-4">
                    <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                      <User className="h-3.5 w-3.5 text-primary" />
                      Overview
                    </h3>
                    {canView("pronouns") && (profile as any).pronouns && (
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="text-[10px] tracking-[0.1em] uppercase px-2.5 py-1 border border-border rounded-sm" style={headingFont}>
                          {(profile as any).pronouns}
                        </span>
                        {isOwner && <PrivacyIndicator level={getPrivacy(ps, "pronouns")} />}
                      </div>
                    )}
                    {canView("bio") && profile.bio && (
                      <div>
                        <p className="text-sm text-muted-foreground leading-relaxed" style={bodyFont}>{profile.bio}</p>
                        {isOwner && <PrivacyIndicator level={getPrivacy(ps, "bio")} />}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* ── Work & Education ── */}
                {((canView("workplace") && (profile as any).workplace) || (canView("education") && (profile as any).education)) && (
                  <div className="border border-border p-5 space-y-4">
                    <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                      <Briefcase className="h-3.5 w-3.5 text-primary" />
                      Work & Education
                    </h3>
                    {canView("workplace") && (profile as any).workplace && (
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <Briefcase className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm" style={bodyFont}>{(profile as any).workplace}</p>
                          <span className="text-[10px] text-muted-foreground" style={headingFont}>Workplace</span>
                        </div>
                        {isOwner && <PrivacyIndicator level={getPrivacy(ps, "workplace")} />}
                      </div>
                    )}
                    {canView("education") && (profile as any).education && (
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <GraduationCap className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm" style={bodyFont}>{(profile as any).education}</p>
                          <span className="text-[10px] text-muted-foreground" style={headingFont}>Education</span>
                        </div>
                        {isOwner && <PrivacyIndicator level={getPrivacy(ps, "education")} />}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Places Lived ── */}
                {canView("city_country") && (profile as any).current_city && (
                  <div className="border border-border p-5 space-y-4">
                    <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                      <MapPin className="h-3.5 w-3.5 text-primary" />
                      Places Lived
                    </h3>
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm" style={bodyFont}>{(profile as any).current_city}</p>
                        <span className="text-[10px] text-muted-foreground" style={headingFont}>Current City</span>
                      </div>
                      {isOwner && <PrivacyIndicator level={getPrivacy(ps, "city_country")} />}
                    </div>
                  </div>
                )}

                {/* ── Contact & Basic Info ── */}
                {isOwner && (
                  <div className="border border-border p-5 space-y-4">
                    <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                      <Phone className="h-3.5 w-3.5 text-primary" />
                      Contact & Basic Info
                    </h3>
                    {(profile as any).phone && (
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm" style={bodyFont}>{(profile as any).phone}</p>
                          <span className="text-[10px] text-muted-foreground" style={headingFont}>Phone</span>
                        </div>
                        <PrivacyIndicator level={getPrivacy(ps, "phone")} />
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm" style={bodyFont}>{currentUser?.email}</p>
                        <span className="text-[10px] text-muted-foreground" style={headingFont}>Email</span>
                      </div>
                      <PrivacyIndicator level={getPrivacy(ps, "email")} />
                    </div>
                    {canView("portfolio") && profile.portfolio_url && (
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <Globe className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <a href={profile.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline truncate block" style={bodyFont}>
                            {profile.portfolio_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          </a>
                          <span className="text-[10px] text-muted-foreground" style={headingFont}>Portfolio</span>
                        </div>
                        <PrivacyIndicator level={getPrivacy(ps, "portfolio")} />
                      </div>
                    )}
                    {canView("member_since") && (
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm" style={bodyFont}>{memberSince}</p>
                          <span className="text-[10px] text-muted-foreground" style={headingFont}>Member Since</span>
                        </div>
                        <PrivacyIndicator level={getPrivacy(ps, "member_since")} />
                      </div>
                    )}
                  </div>
                )}

                {/* ── Contact visible to non-owner (portfolio only if public) ── */}
                {!isOwner && canView("portfolio") && profile.portfolio_url && (
                  <div className="border border-border p-5 space-y-4">
                    <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                      <Globe className="h-3.5 w-3.5 text-primary" />
                      Contact Info
                    </h3>
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <a href={profile.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline truncate block" style={bodyFont}>
                          {profile.portfolio_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        </a>
                        <span className="text-[10px] text-muted-foreground" style={headingFont}>Portfolio</span>
                      </div>
                    </div>
                    {canView("member_since") && (
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm" style={bodyFont}>{memberSince}</p>
                          <span className="text-[10px] text-muted-foreground" style={headingFont}>Member Since</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Social Links ── */}
                {socialLinks.length > 0 && (
                  <div className="border border-border p-5 space-y-4">
                    <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                      <Heart className="h-3.5 w-3.5 text-primary" />
                      Links & Social
                    </h3>
                    <div className="space-y-3">
                      {socialLinks.map((link) => (
                        <div key={link.url} className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <link.icon className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 text-sm text-muted-foreground hover:text-primary transition-colors truncate"
                            style={bodyFont}
                          >
                            {link.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          </a>
                          <ExternalLink className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
                        </div>
                      ))}
                    </div>
                    {isOwner && <PrivacyIndicator level={getPrivacy(ps, "social_links")} />}
                  </div>
                )}

                {/* ── Photography Details ── */}
                {canView("interests") && profile.photography_interests && profile.photography_interests.length > 0 && (
                  <div className="border border-border p-5 space-y-4">
                    <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                      <Camera className="h-3.5 w-3.5 text-primary" />
                      Photography Details
                    </h3>
                    <div>
                      <span className="text-[10px] tracking-[0.1em] uppercase text-muted-foreground block mb-2" style={headingFont}>Specializations</span>
                      <div className="flex flex-wrap gap-2">
                        {profile.photography_interests.map((interest) => (
                          <span
                            key={interest}
                            className="text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 border border-border text-muted-foreground rounded-sm"
                            style={headingFont}
                          >
                            {interest}
                          </span>
                        ))}
                      </div>
                    </div>
                    {entries.length > 0 && (
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <Image className="h-4 w-4 text-muted-foreground/60" />
                        <span style={bodyFont}>{entries.length} competition submission{entries.length !== 1 ? "s" : ""}</span>
                      </div>
                    )}
                    {entries.filter((e: any) => isPublicWinner(e.id)).length > 0 && (
                      <div className="flex items-center gap-3 text-sm text-primary">
                        <Trophy className="h-4 w-4 text-primary/60" />
                        <span style={bodyFont}>{entries.filter((e: any) => isPublicWinner(e.id)).length} award{entries.filter((e: any) => isPublicWinner(e.id)).length !== 1 ? "s" : ""}</span>
                      </div>
                    )}
                    {isOwner && <PrivacyIndicator level={getPrivacy(ps, "interests")} />}
                  </div>
                )}

                {/* ── Certificates & Awards ── */}
                {canView("certificates") && certificates.length > 0 && (
                  <div className="border border-border p-5 space-y-4">
                    <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
                      <Award className="h-3.5 w-3.5 text-primary" />
                      Certificates & Awards
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {certificates.map((cert) => (
                        <div key={cert.id} className="flex items-center gap-3 p-3 bg-muted/30 border border-border rounded-sm">
                          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            {cert.type === "competition" ? (
                              <Trophy className="h-4 w-4 text-primary" />
                            ) : (
                              <BookOpen className="h-4 w-4 text-primary" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-medium truncate" style={headingFont}>{cert.title}</h4>
                            <p className="text-[10px] text-muted-foreground" style={headingFont}>
                              {new Date(cert.issued_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                    {isOwner && <PrivacyIndicator level={getPrivacy(ps, "certificates")} />}
                  </div>
                )}

                {/* Empty state */}
                {!profile.bio && certificates.length === 0 && socialLinks.length === 0 && !(profile as any).workplace && !(profile as any).education && !(profile as any).current_city && (!profile.photography_interests || profile.photography_interests.length === 0) && (
                  <div className="border border-dashed border-border p-12 text-center">
                    <User className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
                    <p className="text-xs text-muted-foreground" style={bodyFont}>No additional info available.</p>
                  </div>
                )}
              </motion.div>
            )}
        </div>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 bg-background/95 backdrop-blur-md flex items-center justify-center p-6 cursor-pointer"
            onClick={() => setLightboxPhoto(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}
              className="max-w-5xl w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <img loading="lazy" decoding="async" src={lightboxPhoto.src} alt={lightboxPhoto.title} className="w-full max-h-[75vh] object-contain" />
              <div className="mt-6 text-center">
                <h3 className="text-xl md:text-2xl font-light tracking-tight" style={displayFont}>{lightboxPhoto.title}</h3>
                {lightboxPhoto.desc && (
                  <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto" style={bodyFont}>{lightboxPhoto.desc}</p>
                )}
                <button
                  onClick={() => setLightboxPhoto(null)}
                  className="mt-6 text-[10px] tracking-[0.2em] uppercase text-muted-foreground hover:text-primary transition-colors duration-300"
                  style={headingFont}
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <div className="container mx-auto max-w-7xl py-4 md:py-8 text-center">
        <Link to="/" className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground hover:text-primary transition-colors duration-500" style={headingFont}>
          ← Back to 50mm Retina World
        </Link>
      </div>
        </>
      )}
    </main>
  );
};

/** Wrapper: key={userId} forces full remount on profile change — Facebook pattern */
const PublicProfile = () => {
  const { userId } = useParams<{ userId: string }>();
  if (!userId) return null;
  return <PublicProfileInner key={userId} userId={userId} />;
};

export default PublicProfile;
