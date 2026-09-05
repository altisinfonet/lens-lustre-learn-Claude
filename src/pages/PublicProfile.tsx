import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { useParams, Link } from "react-router-dom";
import { Camera, CheckCircle2, ExternalLink, Globe, Trophy, BookOpen, User, Expand, Award, ChevronLeft, ChevronRight, Facebook, Instagram, GraduationCap, Twitter, Youtube, MapPin, Calendar, Image, BadgeCheck, Check, X, Play, Briefcase, Phone, Mail, Heart, Lock, Users as UsersIcon, Star, FileText, Layers, MessageSquare, BarChart3, Pencil, Menu, MoreVertical, Settings as SettingsIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import JudgingStampBadge from "@/components/JudgingStampBadge";
import { participantLabelForJudgingTag } from "@/lib/judging/participantStageLabels";
import PhaseWatermark from "@/components/competition/PhaseWatermark";
import FriendFollowActions, { FriendFollowStats, FriendFollowButtons, ProfileStatRow } from "@/components/FriendFollowActions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import MutualFriends from "@/components/MutualFriends";
import { toast } from "@/hooks/core/use-toast";
import WallPosts from "@/components/WallPosts";
import PhotoAlbums from "@/components/profile/PhotoAlbums";
import { useAuth } from "@/hooks/core/useAuth";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
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


/**
 * The profile itself, addressed by user id rather than by route.
 *
 * EXPORTED for F-86: CustomUrlProfile renders this IN PLACE for a vanity URL
 * instead of redirecting to /profile/<uuid>, so the member's own address
 * survives. Keep it taking `userId` as a prop and reading nothing from the
 * route — that is the entire reason it can be mounted from two places.
 */
export const PublicProfileInner = ({ userId }: { userId: string }) => {
  const { user: currentUser } = useAuth();
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
  const [earnedStamps, setEarnedStamps] = useState<EarnedStamp[]>([]);
  const [judgeFeedback, setJudgeFeedback] = useState<JudgeFeedbackItem[]>([]);
  const isGuest = !currentUser;

  // Sync core profile into local state
  useEffect(() => {
    if (coreProfile) {
      // BUG-112: the anon mirror (profiles_public_data) NULLs any non-public field,
      // which also hid 'friends'-scoped fields from accepted friends. When the
      // caller-aware RPC has resolved (authenticated viewers), its values are the
      // authoritative privacy result for these fields — merge them over the mirror
      // so friends see friends-tier data while strangers/anon keep public-only.
      const vf = extData?.visibleFields;
      const resolved = vf
        ? {
            avatar_url: vf.avatar_url ?? coreProfile.avatar_url,
            bio: vf.bio,
            photography_interests: vf.photography_interests,
            portfolio_url: vf.portfolio_url,
            facebook_url: vf.facebook_url,
            instagram_url: vf.instagram_url,
            twitter_url: vf.twitter_url,
            youtube_url: vf.youtube_url,
            website_url: vf.website_url,
            current_city: vf.current_city,
            workplace: vf.workplace,
            education: vf.education,
            pronouns: vf.pronouns,
          }
        : {};
      setProfile((prev) => ({
        ...(prev || {} as ProfileData),
        ...coreProfile,
        ...resolved,
        privacy_settings: extData?.privacySettings ?? coreProfile.privacy_settings,
      }));
    }
  }, [coreProfile, extData?.privacySettings, extData?.visibleFields]);

  /**
   * `?section=about` / `?section=works` OPENS THAT SECTION DIRECTLY.
   *
   * Added 2026-08-16. Two reasons, and the second is the one that matters.
   *
   * The obvious one: About and Works are reachable only from the ⋮ menu, so
   * nothing could link to them — not the account sheet, not a notification, not
   * a share. `?section=wall` already existed and did the scroll half of this
   * job, so the vocabulary was already here and only understood one word.
   *
   * The one that matters: WITHOUT THIS, THE ABOUT TAB CANNOT BE PHOTOGRAPHED.
   * `activeTab` is component state that begins at "wall", so every screenshot
   * this project has ever taken of this page has been the grid. The owner sent
   * a photograph of the About tab calling its layout "very poor" — and there
   * was no way for the sweep to render the thing he was looking at. That is the
   * same hole as app-mode and the crop dialog: a screen with no route into it
   * from a test is a screen that ships unlooked-at.
   *
   * Read once into initial state rather than synced, so a member who taps to
   * another tab is not yanked back by their own URL.
   */
  const sectionParamHandled = useRef(false);
  useEffect(() => {
    if (sectionParamHandled.current) return;
    const section = searchParams.get("section");
    if (section === "about" || section === "works") {
      sectionParamHandled.current = true;
      setActiveTab(section);
    }
  }, [searchParams]);

  // Auto-scroll to wall section when ?section=wall
  useEffect(() => {
    if (searchParams.get("section") === "wall" && wallSectionRef.current && coreProfile) {
      setTimeout(() => {
        wallSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 400);
    }
  }, [searchParams, coreProfile]);

  /**
   * ⚠ THE INFINITE RENDER LOOP — FIXED 2026-08-16.
   *
   * These were `extData?.entries || []`. That `|| []` builds a BRAND NEW ARRAY
   * on every single render, and `entries` is a dependency of the stamps effect
   * below (`}, [entries, userId, currentUser?.id])`). A new array is never
   * referentially equal to the last one, so the effect re-ran on every render,
   * called setState, caused a render, and re-ran — for ever.
   *
   * React reported it as "Maximum update depth exceeded", FOUR TIMES on every
   * load of this page. It had been shipping: it burns battery and CPU on every
   * visitor's phone for as long as the profile is open.
   *
   * Nothing caught it because this page had no screenshot scene until today.
   * The console errors were there the whole time with nobody reading them.
   *
   * `useMemo` gives one stable reference for as long as the underlying data is
   * unchanged, so the effect runs when the entries actually change and not
   * other wise. The `|| []` still guards the undefined case — it is just no
   * longer evaluated fresh on every pass.
   */
  const entries = useMemo(() => extData?.entries || [], [extData?.entries]);
  const certificates = useMemo(() => extData?.certificates || [], [extData?.certificates]);
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
      // BUG-081: the owner-safe view filters ce.user_id=auth.uid(), so a VISITOR
      // viewing someone else's profile always got 0 award stamps. Use the
      // publish-gated public R4-award view instead (no judge_id leak, award-family
      // only, zero rows pre-publication) so stamps render for everyone. Tag
      // metadata is hydrated via a separate `judging_tags` lookup below.
      const [{ data: tagAssignRows }, { data: publishRows }] = await Promise.all([
        supabase
          .from("judge_tag_assignments_public_r4" as any)
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

  /**
   * The two marks that go in the header, in a fixed order so the row never
   * reshuffles between profiles. Owner, 2026-08-16: *"Links (just shown the
   * insta and fb niothing more)"*. Everything else stays on the profile and
   * stays editable — it is simply not header material.
   */
  /** @handle from the member's custom URL — the one stable public identifier. */
  const handle = ((profile as any)?.custom_url || "").trim();

  /**
   * The Instagram HANDLE, not the raw URL. Owner's spec §6: show
   * "[Instagram icon] @avijit_sheel", not a long link and not a button.
   * Parsed defensively — a stored value may be a full URL, may carry a
   * trailing slash, query or "@", and must never render as "undefined".
   */
  const instagramHandle = (() => {
    const raw = (profile.instagram_url || "").trim();
    if (!raw) return "";
    const m = raw.match(/instagram\.com\/([^/?#]+)/i);
    const h = (m ? m[1] : raw).replace(/^@/, "").replace(/\/+$/, "");
    return h && !/^https?:/i.test(h) ? h : "";
  })();

  const headerLinks = [
    profile.instagram_url && { icon: Instagram, label: "Instagram", url: profile.instagram_url },
    profile.facebook_url && { icon: Facebook, label: "Facebook", url: profile.facebook_url },
  ].filter(Boolean) as { icon: any; label: string; url: string }[];

  const worksCount = entries.length + featuredPhotos.length + articles.length + coursesCreated.length;
  const tabs = [
    { key: "wall" as const, label: "Wall" },
    { key: "works" as const, label: "Works", count: worksCount },
    { key: "about" as const, label: "About" },
  ];

  /**
   * The profile menu, built once and rendered INLINE in the header row.
   * It used to occupy a whole row of its own above the avatar — 44px of
   * screen carrying one icon. Owner: "see how nicelys insta used space".
   */
  const profileMenu = (
    <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Profile menu"
                  className="grid min-h-11 min-w-11 place-items-center rounded-lg text-foreground transition-colors hover:bg-muted/60"
                >
                  {/* ⋮ not ☰ — the owner's Instagram reference uses the
                      vertical kebab in the top-right corner. */}
                  <MoreVertical className="h-6 w-6" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {/* Works lives here on a phone — owner: "works move to under
                    thee lines". The count comes with it, so it is still
                    obvious whether there is anything in there before tapping. */}
                {/**
                 * WORKS AND ABOUT LIVE HERE ON A PHONE — and the menu is shown
                 * to EVERYONE, not just the owner.
                 *
                 * Owner: *"works move to under thee lines"*. About went the
                 * same way, but only its SUMMARY moved into the header (bio,
                 * links, joined). The full About panel still carries Workplace,
                 * Education, Current City, Specializations, Phone, Email and
                 * Portfolio — deleting the tab without putting it here would
                 * have made all of that unreachable on a phone.
                 *
                 * The menu was owner-only for one commit, which would have hit
                 * a VISITOR harder still: no tabs and no menu means no way to
                 * reach either panel on someone else's profile. Edit Profile
                 * and Settings stay owner-only; the two panels do not.
                 */}
                <DropdownMenuItem onClick={() => setActiveTab(activeTab === "works" ? "wall" : "works")} className="flex items-center gap-2.5">
                  <Layers className="h-4 w-4" />
                  {activeTab === "works" ? "Back to Wall" : "Works"}
                  {worksCount > 0 && <span className="ml-auto text-[11px] text-muted-foreground">{worksCount}</span>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab(activeTab === "about" ? "wall" : "about")} className="flex items-center gap-2.5">
                  <User className="h-4 w-4" />
                  {activeTab === "about" ? "Back to Wall" : "About"}
                </DropdownMenuItem>
                {isOwner && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link to="/edit-profile" className="flex items-center gap-2.5">
                        <Pencil className="h-4 w-4" /> Edit Profile
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/profile" className="flex items-center gap-2.5">
                        <SettingsIcon className="h-4 w-4" /> Settings
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
  );

    return (
    <main className="min-h-screen bg-background text-foreground">
      <PageSEO
        title={displayName}
        description={profile.bio ? profile.bio.slice(0, 155) : `${displayName}'s photography profile on 50mm Retina World.`}
        ogImage={profile.avatar_url || undefined}
      />
      {/* ═══ INSTAGRAM-STYLE PROFILE HEADER (no cover) ═══ */}
      <section className="relative bg-background pt-1 sm:pt-6">
        {/**
         * ☰ TOP RIGHT — Edit Profile and Settings, phone only.
         *
         * Owner, 2026-08-16: *"setiing and edit profile place on top right side
         * with three lines"*. Same control, same corner as Instagram, so it
         * needs no explaining — and it buys back the row that "Edit Profile"
         * used to occupy above the photographs, which is what this screen was
         * short of.
         *
         * Owner only: a visitor has nothing to edit, and an empty menu is
         * worse than no menu.
         */}
        {/* ── Profile Info Section ── */}
        <div className="container mx-auto max-w-7xl px-4 relative">
          {/* Desktop: Two rows — Row 1: Avatar + Name | Buttons — Row 2: Stats below name */}
          <div className="hidden sm:block">
            {/* Row 1: Avatar + Name + Verified + Buttons */}
            <div className="flex items-end justify-between w-full">
              {/* Left: Avatar + Name */}
              <div className="flex items-end gap-5 min-w-0">
                {/* Avatar with overlap */}
                <div className="relative flex-shrink-0 z-10">
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
                    handle={null} /* F-98 — deliberately not a link: this is the member's own name on the page they are already on. null is a stated answer, not an omission. */
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

          {/**
           * ═══ MOBILE: INSTAGRAM'S ARRANGEMENT ═══
           *
           * Owner, 2026-08-16, holding his Instagram profile beside ours:
           * *"DP missing too bad laytout. follow instagram style as attched."*
           *
           * WHAT WAS WRONG. Everything was CENTRED in a single column — a
           * 100px avatar, then the name, then "Joined", then the three counts
           * rendered as a 9px run of text, then the buttons. Five stacked rows
           * before a single photograph, and the numbers a visitor judges a
           * photographer by set in the smallest type on the screen.
           *
           * Instagram puts the picture on the LEFT with the counts beside it,
           * which spends one row instead of two and makes the figures legible.
           * Name and bio go underneath, left-aligned, because centred text
           * that wraps to two lines looks like a mistake.
           *
           * ⚠ I FIRST BUILT THIS ON THE WRONG PAGE. `Profile.tsx` is the
           * account/settings screen (About | Settings tabs, no posts on it).
           * THIS is the one with Wall | Works | About and the photo grid, and
           * it is the one he was showing me. The other file has been reverted.
           */}
          {/**
           * -mx-4 CANCELS ONE OF TWO STACKED PADDINGS.
           *
           * Owner, 2026-08-16: "telling to remove padding from left and right
           * edge not doing". Measured: content sat 34px from each edge while
           * the tab bar below sat at 18px — so the page had two different
           * left edges. Cause: Tailwind's `container` class carries its own
           * 16px, and the wrapper adds `px-4` on top of it.
           * Instagram's reference measures ~16-20px. -mx-4 removes one layer,
           * giving 18px — which is also exactly where the tabs already were,
           * so the whole screen now shares ONE left edge.
           */}
          <div className="relative -mx-4 flex sm:hidden flex-col gap-1 sm:mx-0">
            {/* ⋮ pinned to the top-right corner of the profile block, exactly
                where the reference puts it — no row of its own. */}
            {!isGuest && <div className="absolute -right-2 -top-1 z-10">{profileMenu}</div>}
            {/**
             * DP LEFT · NAME AND COUNTS STACKED BESIDE IT · ☰ FAR RIGHT.
             *
             * Owner, 2026-08-16, with Instagram open: *"see how nicelys insta
             * used space - and you spolied the sapce"*. He was right twice
             * over, and both were mine:
             *
             *  1. The ☰ had a ROW TO ITSELF — 44px of screen holding one icon
             *     and nothing else. Instagram keeps it inline at the top.
             *  2. The name sat BELOW the whole avatar row, so the tall column
             *     next to an 86px picture held only the counts and the rest
             *     was blank. Instagram stacks name over counts in that column,
             *     which is exactly the space that was going to waste.
             *
             * Both fixed here: one row now carries the picture, the name, the
             * three figures and the menu. `items-start` so the name aligns
             * with the top of the picture rather than floating at its centre.
             */}
            <div className="flex items-start gap-4">
              <div className="relative z-10 shrink-0">
                {canView("avatar") && profile.avatar_url ? (
                  <img referrerPolicy="no-referrer" loading="eager" decoding="async" fetchPriority="high" src={profile.avatar_url} alt={displayName} className="h-[86px] w-[86px] rounded-full object-cover border-[3px] border-background shadow-xl" />
                ) : (
                  <div className="h-[86px] w-[86px] rounded-full bg-muted border-[3px] border-background flex items-center justify-center shadow-xl">
                    <Camera className="h-7 w-7 text-muted-foreground/30" />
                  </div>
                )}
              </div>

              {/* pr-9 reserves the ⋮'s corner. Without it a long name ran
                  straight under the menu — caught the moment the visitor scene
                  rendered a name longer than the owner's. */}
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 pr-9 pt-0.5">
                <div className="flex items-start justify-between gap-2">
                  {/**
                   * MATCHED TO THE REAL INSTAGRAM PROFILE, 2026-08-16.
                   *
                   * Owner: "your design and this one 100000000% matched yes or
                   * no ?? if not macthed then match it". It was not. Measured
                   * against his reference:
                   *   - the row beside the picture holds NAME then the three
                   *     COUNTS and nothing else. No @handle, no badge, no menu.
                   *   - the menu (⋮) lives in the TOP BAR, top right — not
                   *     inside the profile block.
                   *   - the @handle is the top-bar TITLE, not a subtitle.
                   * So the badge and the inline menu are gone from here.
                   * "Member" was my addition, not Instagram's; his sample has a
                   * verified tick beside the handle in the top bar, and that
                   * is what UserIdentityBlock's badge system already renders.
                   */}
                  <UserIdentityBlock
                    userId={userId || ""}
                    name={displayName}
                    handle={null} /* F-98 — deliberately not a link: this is the member's own name on the page they are already on. null is a stated answer, not an omission. */
                    size="full"
                    className="items-start text-left"
                    nameClassName="text-[17px] font-semibold tracking-tight leading-tight [font-family:var(--font-display)]"
                  />
                </div>
                {/* Guests see no counts — unchanged rule, just a different shape. */}
                {!isGuest && <ProfileStatRow targetUserId={userId!} />}
              </div>
            </div>

            {/**
             * NAME → ABOUT → LINKS → JOINED, in that order, on the owner's
             * instruction, 2026-08-16: *"Link abiut display under the Name /
             * Like Name / About / Links (just shown the insta and fb niothing
             * more) / Joined"*.
             *
             * This is Instagram's stack and it reads top-down in order of what
             * a visitor wants: who is this, what do they do, where else are
             * they, how long have they been here. The bio used to be buried in
             * an "About" TAB — a whole extra tap to read one sentence — and
             * the links sat in a bordered card further down the page.
             */}
            {canView("bio") && profile.bio && (
              <p className="text-[15px] leading-snug text-foreground whitespace-pre-line" style={bodyFont}>
                {profile.bio}
              </p>
            )}

            {/**
             * INSTAGRAM AND FACEBOOK ONLY — owner: *"just shown the insta and
             * fb niothing more"*. X, YouTube, Website and Portfolio are all
             * still on the profile and still editable; they simply do not
             * belong in the header, which is a summary and not a directory.
             * Icons only, no labels: two marks everyone recognises, and it
             * keeps the row to one line at 360px.
             * 44px targets — the old link row measured 93x24.
             */}
            {/**
             * §6 — the Instagram link is an ICON + @HANDLE, in the accent
             * colour, at text weight. Not a button, not a raw URL. If the
             * handle cannot be parsed the icon alone still links out, so a
             * badly-stored value degrades to something useful rather than to
             * "@undefined". Facebook keeps its icon beside it.
             */}
            {headerLinks.length > 0 && (
              <div className="flex items-center gap-3">
                {headerLinks.map((link) => {
                  const isIg = link.label === "Instagram";
                  return (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={isIg && instagramHandle ? `Instagram @${instagramHandle}` : link.label}
                      className="inline-flex min-h-11 min-w-11 -my-2.5 items-center gap-1.5 text-[13px] text-primary transition-opacity hover:opacity-80"
                      style={bodyFont}
                    >
                      <link.icon className="h-[18px] w-[18px]" />
                      {isIg && instagramHandle && <span className="truncate">@{instagramHandle}</span>}
                    </a>
                  );
                })}
              </div>
            )}


            {!isOwner && !isGuest && <MutualFriends targetUserId={userId!} />}

            {/**
             * Edit Profile is GONE from this row — it lives in the ☰ at the
             * top right now, on the owner's instruction, which is also where
             * Instagram keeps it. The row is left for the actions a VISITOR
             * takes, so on your own profile it simply disappears rather than
             * holding one lonely button.
             */}
            {/**
             * §8 — THE ACTION ROW, rebuilt.
             *
             * Owner: *"The current UI uses oversized rectangular buttons"*.
             * They were 10px uppercase text in 44px-tall blocks — desktop
             * proportions on a phone. This is the social-platform row from his
             * mockup: one accent primary, one secondary, the rest icon-only.
             *
             * h-9 (36px) is the visible height and matches Instagram's; the
             * 44px touch minimum is met by the row's own padding rather than
             * by inflating the button, which is what made them look oversized.
             * `flex-1` on the two text buttons and fixed squares on the icons
             * gives the consistent height and native proportion §8 asks for.
             */}
            {(!isOwner || isGuest) && (
              <div className="mt-2 flex items-center gap-2 py-1">
                {!isOwner && !isGuest && <FriendFollowButtons targetUserId={userId!} />}
                {isGuest && (
                  <Link to="/signup" className="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90" style={headingFont}>
                    Follow
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* Separator */}
        </div>
      </section>

      {/* ═══ Stories & Highlights (Instagram-style, in place of the old cover; visible to everyone) ═══ */}
      {/* Same -mx-4 cancellation as the header, so the story rings share the
          page's single 18px left edge instead of sitting 16px further in. */}
      <div className="mx-auto max-w-7xl px-0 py-1 sm:container sm:px-4 md:py-4">
        <ProfileStories userId={userId!} isOwner={isOwner} />
      </div>

      {/* ═══ Guest Join Wall ═══ */}
      {isGuest && (
        <>
          {/* Show a preview of about info for guests */}
          <div className="container mx-auto max-w-7xl py-6 space-y-4">
            {profile.bio && (
              <div className="border border-border p-5 space-y-3">
                <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                  <User className="h-4 w-4 text-primary" />
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
                      <span className="shrink-0 text-[11px] text-muted-foreground/70" style={headingFont}>Workplace</span>
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
                      <span className="shrink-0 text-[11px] text-muted-foreground/70" style={headingFont}>Education</span>
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
                      <span className="shrink-0 text-[11px] text-muted-foreground/70" style={headingFont}>Current City</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {socialLinks.length > 0 && (
              <div className="border border-border p-5 space-y-3">
                <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                  <Heart className="h-4 w-4 text-primary" />
                  Links
                </h3>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {/* min-h-11 = 44px. The sweep measured these at 93x24 the
                      first time this page was ever photographed — they are
                      real controls (they leave the site) sitting at half the
                      tap minimum. `-my-2.5` keeps the card's height unchanged. */}
                  {socialLinks.map((link) => (
                    <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 -my-2.5 items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors" style={bodyFont}>
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

      {/* ═══ Authenticated User Content ═══ */}
      {!isGuest && (
        <>

      {/**
       * ═══ TABS — PHONE HAS NONE ═══
       *
       * Owner, 2026-08-16: *"works move to under thee lines"* and *"dont wort
       * wall as it is main board"*.
       *
       * He is right about the shape. Three tabs where one of them is the page
       * itself is a menu that mostly points at where you already are. On a
       * phone the wall IS the profile — it is what everyone opens it for — so
       * it needs no label and no tap to reach.
       *
       *   Wall  → gone as a label; it is simply the page.
       *   Works → moved into the ☰ at the top right.
       *   About → dissolved into the header (bio, links, joined), so reading
       *           one sentence no longer costs a tap.
       *
       * DESKTOP KEEPS THE TABS. There the wall does not fill the viewport,
       * there is room for a real tab bar, and a hamburger on a 1280px screen
       * is hiding things for no reason. `sm:block` is the whole difference.
       */}
      <div className="hidden sm:block bg-background sticky top-0 z-20 border-b border-border">
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
      <div className="mx-auto max-w-7xl py-2 px-0 sm:py-6 sm:container sm:px-4">
        {/**
         * PHONE: HIDDEN. The links now sit under the name as two icons, where
         * the owner asked for them. Leaving this card as well would print the
         * same two destinations twice on one screen, a few hundred pixels
         * apart — which is what the first screenshot of this redesign showed.
         *
         * Desktop keeps it: the desktop header is a different, wider layout
         * that does not carry the links, and there the card is the only place
         * they appear.
         */}
        {socialLinks.length > 0 && (
          <div className="hidden sm:block border border-border p-4 mb-6">
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
                  /* min-h-11 = 44px. Measured at 93x24 the first time this
                     page was ever photographed — real controls (they leave the
                     site) at half the tap minimum. `-my-2.5` cancels the added
                     height so the Links card does not grow. */
                  className="flex min-h-11 -my-2.5 items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors py-1"
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
                initial={{ opacity: 1 }}
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
                initial={{ opacity: 1 }}
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
                              <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                                <BarChart3 className="h-4 w-4 text-primary" />
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
                            <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                              <Award className="h-4 w-4 text-primary" />
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
                      <div className="mb-5">
                        <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                          <Trophy className="h-4 w-4 text-primary" />
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
                      <div className="mb-5">
                        <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                          <Star className="h-4 w-4 text-primary" />
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
                        <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                          <Image className="h-4 w-4 text-primary" />
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
                      <div className="mb-5">
                        <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                          <FileText className="h-4 w-4 text-primary" />
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
                      <div className="mb-5">
                        <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                          <Layers className="h-4 w-4 text-primary" />
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
                      <div className="mb-5">
                        <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                          <MessageSquare className="h-4 w-4 text-primary" />
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
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="space-y-4"
              >
                {/* ── Overview ── */}
                {(canView("bio") && profile.bio) || (canView("pronouns") && (profile as any).pronouns) ? (
                  <div className="mb-5">
                    <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                      <User className="h-4 w-4 text-primary" />
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
                  <div className="mb-5">
                    <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                      <Briefcase className="h-4 w-4 text-primary" />
                      Work & Education
                    </h3>
                    {canView("workplace") && (profile as any).workplace && (
                      <div className="flex min-h-11 items-center gap-3">
                        <div className="h-[18px] w-[18px] flex items-center justify-center flex-shrink-0">
                          <Briefcase className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex min-w-0 flex-1 items-baseline gap-2">
                          <p className="truncate text-[15px]" style={bodyFont}>{(profile as any).workplace}</p>
                          <span className="shrink-0 text-[11px] text-muted-foreground/70" style={headingFont}>Workplace</span>
                        </div>
                        {isOwner && <PrivacyIndicator level={getPrivacy(ps, "workplace")} />}
                      </div>
                    )}
                    {canView("education") && (profile as any).education && (
                      <div className="flex min-h-11 items-center gap-3">
                        <div className="h-[18px] w-[18px] flex items-center justify-center flex-shrink-0">
                          <GraduationCap className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex min-w-0 flex-1 items-baseline gap-2">
                          <p className="truncate text-[15px]" style={bodyFont}>{(profile as any).education}</p>
                          <span className="shrink-0 text-[11px] text-muted-foreground/70" style={headingFont}>Education</span>
                        </div>
                        {isOwner && <PrivacyIndicator level={getPrivacy(ps, "education")} />}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Places Lived ── */}
                {canView("city_country") && (profile as any).current_city && (
                  <div className="mb-5">
                    <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                      <MapPin className="h-4 w-4 text-primary" />
                      Places Lived
                    </h3>
                    <div className="flex min-h-11 items-center gap-3">
                      <div className="h-[18px] w-[18px] flex items-center justify-center flex-shrink-0">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex min-w-0 flex-1 items-baseline gap-2">
                        <p className="truncate text-[15px]" style={bodyFont}>{(profile as any).current_city}</p>
                        <span className="shrink-0 text-[11px] text-muted-foreground/70" style={headingFont}>Current City</span>
                      </div>
                      {isOwner && <PrivacyIndicator level={getPrivacy(ps, "city_country")} />}
                    </div>
                  </div>
                )}

                {/* ── Contact & Basic Info ── */}
                {isOwner && (
                  <div className="mb-5">
                    <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                      <Phone className="h-4 w-4 text-primary" />
                      Contact & Basic Info
                    </h3>
                    {(profile as any).phone && (
                      <div className="flex min-h-11 items-center gap-3">
                        <div className="h-[18px] w-[18px] flex items-center justify-center flex-shrink-0">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex min-w-0 flex-1 items-baseline gap-2">
                          <p className="truncate text-[15px]" style={bodyFont}>{(profile as any).phone}</p>
                          <span className="shrink-0 text-[11px] text-muted-foreground/70" style={headingFont}>Phone</span>
                        </div>
                        <PrivacyIndicator level={getPrivacy(ps, "phone")} />
                      </div>
                    )}
                    <div className="flex min-h-11 items-center gap-3">
                      <div className="h-[18px] w-[18px] flex items-center justify-center flex-shrink-0">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex min-w-0 flex-1 items-baseline gap-2">
                        <p className="truncate text-[15px]" style={bodyFont}>{currentUser?.email}</p>
                        <span className="shrink-0 text-[11px] text-muted-foreground/70" style={headingFont}>Email</span>
                      </div>
                      <PrivacyIndicator level={getPrivacy(ps, "email")} />
                    </div>
                    {canView("portfolio") && profile.portfolio_url && (
                      <div className="flex min-h-11 items-center gap-3">
                        <div className="h-[18px] w-[18px] flex items-center justify-center flex-shrink-0">
                          <Globe className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <a href={profile.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline truncate block" style={bodyFont}>
                            {profile.portfolio_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          </a>
                          <span className="shrink-0 text-[11px] text-muted-foreground/70" style={headingFont}>Portfolio</span>
                        </div>
                        <PrivacyIndicator level={getPrivacy(ps, "portfolio")} />
                      </div>
                    )}
                    {canView("member_since") && (
                      <div className="flex min-h-11 items-center gap-3">
                        <div className="h-[18px] w-[18px] flex items-center justify-center flex-shrink-0">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex min-w-0 flex-1 items-baseline gap-2">
                          <p className="truncate text-[15px]" style={bodyFont}>{memberSince}</p>
                          <span className="shrink-0 text-[11px] text-muted-foreground/70" style={headingFont}>Member Since</span>
                        </div>
                        <PrivacyIndicator level={getPrivacy(ps, "member_since")} />
                      </div>
                    )}
                  </div>
                )}

                {/* ── Contact visible to non-owner (portfolio only if public) ── */}
                {!isOwner && canView("portfolio") && profile.portfolio_url && (
                  <div className="mb-5">
                    <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                      <Globe className="h-4 w-4 text-primary" />
                      Contact Info
                    </h3>
                    <div className="flex min-h-11 items-center gap-3">
                      <div className="h-[18px] w-[18px] flex items-center justify-center flex-shrink-0">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <a href={profile.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline truncate block" style={bodyFont}>
                          {profile.portfolio_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        </a>
                        <span className="shrink-0 text-[11px] text-muted-foreground/70" style={headingFont}>Portfolio</span>
                      </div>
                    </div>
                    {canView("member_since") && (
                      <div className="flex min-h-11 items-center gap-3">
                        <div className="h-[18px] w-[18px] flex items-center justify-center flex-shrink-0">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex min-w-0 flex-1 items-baseline gap-2">
                          <p className="truncate text-[15px]" style={bodyFont}>{memberSince}</p>
                          <span className="shrink-0 text-[11px] text-muted-foreground/70" style={headingFont}>Member Since</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Social Links ── */}
                {socialLinks.length > 0 && (
                  <div className="mb-5">
                    <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                      <Heart className="h-4 w-4 text-primary" />
                      Links & Social
                    </h3>
                    <div className="space-y-3">
                      {socialLinks.map((link) => (
                        <div key={link.url} className="flex items-center gap-3">
                          <div className="h-[18px] w-[18px] flex items-center justify-center flex-shrink-0">
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
                  <div className="mb-5">
                    <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                      <Camera className="h-4 w-4 text-primary" />
                      Photography Details
                    </h3>
                    <div>
                                            <div className="flex flex-wrap gap-2">
                        {profile.photography_interests.map((interest) => (
                          <span
                            key={interest}
                            className="rounded-full bg-muted/40 px-3 py-1 text-[13px] text-foreground/80"
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
                  <div className="mb-5">
                    <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-1" style={headingFont}>
                      <Award className="h-4 w-4 text-primary" />
                      Certificates & Awards
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {certificates.map((cert) => (
                        <div key={cert.id} className="flex min-h-11 items-center gap-3 rounded-lg bg-muted/25 px-3 py-2">
                          <div className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center">
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

      {/**
       * NO "← Back to 50mm Retina World" HERE. Owner, 2026-08-16: *"ack to
       * 50mm retine dont witre on the footer"*.
       *
       * It was a leftover from when a profile could be arrived at cold from a
       * search engine with no other navigation on the page. The app has a
       * bottom bar and the web has the site header — both are always present,
       * both go home. A third "go home" at the end of every profile is
       * clutter, and on a phone it sat directly above the bottom nav that
       * already does the same thing.
       *
       * The shared SiteFooter still renders below this, so nothing that
       * belongs in a footer has been lost.
       */}
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
