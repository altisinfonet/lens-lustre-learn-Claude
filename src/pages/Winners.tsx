import { Link } from "react-router-dom";
import PageSEO from "@/components/PageSEO";
import { Trophy, User } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { fetchCompetitionsByIds } from "@/hooks/competition/useCompetitions";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { getAdminIds, resolveBadges } from "@/lib/adminBrand";
import { useGatedEntryStatus, resolveDisplayStatus } from "@/hooks/judging/useGatedEntryStatus";
import { getR4AwardStages } from "@/lib/judging/stageCatalog";
import { useT } from "@/i18n/I18nContext";

// B1.10 — Public Hall of Fame must respect the admin publish gate.
// `status='winner'` is only used as a server-side pre-filter for query efficiency;
// the final visibility decision is delegated to `useGatedEntryStatus`, so a
// judge's pre-publish winner write is NEVER visible here until admin declares R4.
// Stage key derived from v3_stage_catalog (no hardcoded judging vocabulary).
const WINNER_PUBLIC_KEYS = new Set<string>([
  ...getR4AwardStages().filter(s => s.decision_token === "winner").map(s => s.stage_key),
  "winner", // legacy entry.status value (pre-v3 catalog) for back-compat
]);

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.8, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  }),
};

interface WinnerEntry {
  id: string;
  title: string;
  description: string | null;
  photos: string[];
  user_id: string;
  competition: {
    id: string;
    slug: string | null;
    title: string;
    category: string;
    cover_image_url: string | null;
    ends_at: string;
  };
  profile: {
    full_name: string | null;
    avatar_url: string | null;
  } | null;
  badges: string[];
}

const Winners = () => {
  const t = useT();
  // Raw candidates from DB (status='winner' is the pre-filter only — see top-of-file note).
  const [candidates, setCandidates] = useState<WinnerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWinners = async () => {
      // BUG-033: winners can be marked via status='winner' OR placement='winner'
      // (complete-round writes placement for awards). Prefiltering on status
      // alone hid winners whose status stayed 'finalist'. The publish gate
      // below (useGatedEntryStatus) still decides what actually renders.
      const { data: rawEntries } = await supabase
        .from("competition_entries")
        .select("id, title, description, photos, photo_meta, user_id, competition_id")
        .or("status.eq.winner,placement.eq.winner")
        .order("created_at", { ascending: false });

      if (rawEntries && rawEntries.length > 0) {
        const compIds = [...new Set(rawEntries.map(e => e.competition_id))];
        const userIds = [...new Set(rawEntries.map(e => e.user_id))];

        const [compMap, profileMap, adminIds] = await Promise.all([
          fetchCompetitionsByIds(compIds),
          fetchProfileMap(userIds),
          getAdminIds(),
        ]);

        const mapped: WinnerEntry[] = rawEntries
          .filter(row => compMap.has(row.competition_id))
          .map((row: any) => {
            const comp = compMap.get(row.competition_id)!;
            const prof = profileMap.get(row.user_id);
            // Per-photo "One Image, One Reject" — exclude admin-rejected photos.
            const meta: any[] = Array.isArray(row.photo_meta) ? row.photo_meta : [];
            const photos: string[] = (row.photos || []).filter(
              (_: string, i: number) => meta[i]?.rejected !== true,
            );
            return {
              id: row.id,
              title: row.title,
              description: row.description,
              photos,
              user_id: row.user_id,
              competition: {
                id: row.competition_id,
                slug: comp.slug,
                title: comp.title,
                category: comp.category,
                cover_image_url: comp.cover_image_url,
                ends_at: comp.ends_at,
              },
              profile: prof
                ? { full_name: prof.full_name, avatar_url: prof.avatar_url }
                : null,
              badges: resolveBadges(row.user_id, profileMap.get(row.user_id)?.badges || [], adminIds),
            };
          });
        setCandidates(mapped);
      }
      setLoading(false);
    };
    fetchWinners();
  }, []);

  // B1.10 — Apply the publish gate. Any candidate whose gated public_status
  // is not in WINNER_PUBLIC_KEYS (e.g. R4 not declared yet) is hidden.
  const gated = useGatedEntryStatus(candidates.map(c => c.id));
  const winners = candidates.filter((c) => {
    const row = gated.data?.[c.id];
    if (!row) return false; // gate not loaded yet → hide rather than leak
    const display = resolveDisplayStatus(row);
    return WINNER_PUBLIC_KEYS.has(display);
  });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PageSEO title="Winners" />
      <div className="container mx-auto py-3 md:py-20">
        <motion.div initial="hidden" animate="visible">
          <motion.div variants={fadeUp} custom={0} className="flex items-center gap-4 mb-2">
            <div className="w-12 h-px bg-yellow-500" />
            <span className="text-[10px] tracking-[0.3em] uppercase text-yellow-500" style={{ fontFamily: "var(--font-heading)" }}>
              {t("win.hallOfFame")}
            </span>
          </motion.div>
          <motion.h1
            variants={fadeUp}
            custom={1}
            className="text-xl md:text-6xl font-light tracking-tight mb-2 md:mb-4 px-2 md:px-0"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("win.competition")} <em className="italic text-yellow-500 drop-shadow-[0_0_12px_hsl(45_100%_50%/0.4)]">{t("win.winners")}</em>
          </motion.h1>
          <motion.p
            variants={fadeUp}
            custom={2}
            className="text-xs md:text-sm text-muted-foreground max-w-lg mb-6 md:mb-16 px-2 md:px-0"
            style={{ fontFamily: "var(--font-body)" }}
          >
            {t("win.celebrating")}
          </motion.p>
        </motion.div>

        {loading || (candidates.length > 0 && gated.isLoading) ? (
          <div
            className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse py-20 text-center"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Loading winners...
          </div>
        ) : winners.length === 0 ? (
          <div className="text-center py-20">
            <Trophy className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
              {t("win.noWinners")}
            </p>
          </div>
        ) : (
          <div className="space-y-10 md:space-y-24">
            {winners.map((winner, i) => (
              <motion.article
                key={winner.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.12, duration: 0.8, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}
                className="group relative"
              >
                {/* Gold glow accent */}
                <div className="absolute -top-4 -left-4 w-24 h-24 bg-yellow-500/10 rounded-full blur-3xl pointer-events-none" />
                
                {/* Competition context */}
                <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4 flex-wrap">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/10 rounded-full">
                    <Trophy className="h-3.5 w-3.5 text-yellow-500" />
                    <span className="text-[9px] tracking-[0.15em] uppercase text-yellow-500 font-bold" style={{ fontFamily: "var(--font-heading)" }}>{t("dash.status.winner")}</span>
                  </div>
                  <Link
                    to={`/competitions/${winner.competition.slug || winner.competition.id}`}
                    className="text-[10px] tracking-[0.2em] uppercase text-primary hover:underline"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {winner.competition.title}
                  </Link>
                  <span className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                    • {winner.competition.category}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto" style={{ fontFamily: "var(--font-body)" }}>
                    {new Date(winner.competition.ends_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                  </span>
                </div>

                {/* Photos grid */}
                {winner.photos.length > 0 && (
                  <div className={`mb-4 md:mb-6 gap-1.5 md:gap-2 ${
                    winner.photos.length === 1
                      ? "block"
                      : winner.photos.length === 2
                      ? "grid grid-cols-2"
                      : "grid grid-cols-2 md:grid-cols-3"
                  }`}>
                    {winner.photos.slice(0, 6).map((photo, pi) => (
                      <div
                        key={pi}
                        className={`overflow-hidden bg-muted rounded-lg border-2 border-yellow-500/20 shadow-[0_0_20px_-8px_hsl(45_100%_50%/0.2)] ${
                          winner.photos.length === 1 ? "max-h-[300px] md:max-h-[500px]" : "h-40 md:h-80"
                        }`}
                      >
                        <img
                          src={photo}
                          alt={`${winner.title} — photo ${pi + 1}`}
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-[1.2s] ease-out"
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Entry info + photographer */}
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 md:gap-6">
                  <div>
                    <h2
                      className="text-lg md:text-3xl font-light tracking-tight mb-1 md:mb-2"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      {winner.title}
                    </h2>
                    {winner.description && (
                      <p className="text-sm text-muted-foreground max-w-xl leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
                        {winner.description}
                      </p>
                    )}
                  </div>

                  {/* Photographer */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {winner.profile?.avatar_url ? (
                      <img loading="lazy" decoding="async"
                        src={winner.profile.avatar_url}
                        alt={winner.profile.full_name || "Winner"}
                        className="h-10 w-10 rounded-full object-cover border border-border"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center border border-border">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <UserIdentityBlock
                      userId={winner.user_id}
                      name={winner.profile?.full_name || "Photographer"}
                      linkTo={`/profile/${winner.user_id}`}
                      nameClassName="text-xs tracking-[0.1em] uppercase text-muted-foreground hover:text-primary hover:underline transition-colors"
                    />
                  </div>
                </div>

                {/* Divider */}
                {i < winners.length - 1 && (
                  <div className="mt-16 h-px bg-gradient-to-r from-transparent via-yellow-500/20 to-transparent" />
                )}
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
};

export default Winners;
