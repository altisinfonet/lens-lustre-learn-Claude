import { useEffect, useMemo, useState } from "react";
import { Trophy, UserPlus, BookOpen, Camera, Award } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { profilesPublic } from "@/lib/profilesPublic";
import { useGatedEntryStatus, resolveDisplayStatus } from "@/hooks/judging/useGatedEntryStatus";
import { getR4AwardStages } from "@/lib/judging/stageCatalog";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

// B1.11 — Profile activity feed must respect the admin publish gate.
// `status='winner'` is a server-side pre-filter only; final visibility is
// delegated to `useGatedEntryStatus`. A judge's pre-publish winner write is
// NEVER surfaced here until admin declares R4. Mirrors the Winners.tsx (B1.10)
// pattern, sourcing keys from v3_stage_catalog (no hardcoded vocabulary).
const WINNER_PUBLIC_KEYS = new Set<string>([
  ...getR4AwardStages().filter(s => s.decision_token === "winner").map(s => s.stage_key),
  "winner", // legacy entry.status value (pre-v3 catalog) for back-compat
]);

interface ActivityItem {
  id: string;
  icon: React.ReactNode;
  text: string;
  time: string;
}

interface RawWin {
  id: string;
  title: string;
  created_at: string;
  competitionTitle: string;
}

interface Props {
  userId: string;
}

const timeAgo = (d: string) => {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString("en", { month: "short", day: "numeric" });
};

const ProfileActivityFeed = ({ userId }: Props) => {
  // Non-winner activity items (no gate needed) — populated once per userId.
  const [baseItems, setBaseItems] = useState<ActivityItem[]>([]);
  // Raw winner candidates (status='winner' DB pre-filter) — gated below.
  const [winCandidates, setWinCandidates] = useState<RawWin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Recent competition wins — RAW pre-filter only; gate applied below.
      const { data: wins } = await supabase
        .from("competition_entries")
        .select("id, title, created_at, competition:competitions(title)")
        .eq("user_id", userId)
        .eq("status", "winner")
        .order("created_at", { ascending: false })
        .limit(3);

      const rawWins: RawWin[] = (wins || []).map((w: any) => ({
        id: w.id,
        title: w.title,
        created_at: w.created_at,
        competitionTitle: (w.competition as any)?.title || "a competition",
      }));

      const items: ActivityItem[] = [];

      // Recent follows
      const { data: follows } = await supabase
        .from("follows")
        .select("id, following_id, created_at")
        .eq("follower_id", userId)
        .order("created_at", { ascending: false })
        .limit(3);
      if (follows && follows.length > 0) {
        const followIds = follows.map(f => f.following_id);
        const { data: profiles } = await profilesPublic().select("id, full_name").in("id", followIds);
        const nameMap = new Map(((profiles as any[]) || []).map((p: any) => [p.id, p.full_name]));
        follows.forEach((f) => {
          items.push({
            id: `follow-${f.id}`,
            icon: <UserPlus className="h-3.5 w-3.5 text-blue-500" />,
            text: `Started following ${nameMap.get(f.following_id) || "someone"}`,
            time: f.created_at,
          });
        });
      }

      // Recent submissions (benign — 'submitted' is not a judging-outcome status)
      const { data: subs } = await supabase
        .from("competition_entries")
        .select("id, title, created_at")
        .eq("user_id", userId)
        .eq("status", "submitted")
        .order("created_at", { ascending: false })
        .limit(3);
      (subs || []).forEach((s: any) => {
        items.push({
          id: `sub-${s.id}`,
          icon: <Camera className="h-3.5 w-3.5 text-muted-foreground" />,
          text: `Submitted "${s.title}"`,
          time: s.created_at,
        });
      });

      // Recent certificates
      const { data: certs } = await supabase
        .from("certificates")
        .select("id, title, issued_at")
        .eq("user_id", userId)
        .order("issued_at", { ascending: false })
        .limit(2);
      (certs || []).forEach((c: any) => {
        items.push({
          id: `cert-${c.id}`,
          icon: <Award className="h-3.5 w-3.5 text-amber-500" />,
          text: `Earned "${c.title}"`,
          time: c.issued_at,
        });
      });

      if (cancelled) return;
      setBaseItems(items);
      setWinCandidates(rawWins);
    };
    load();
    return () => { cancelled = true; };
  }, [userId]);

  // B1.11 — Gate raw winner candidates. If R4 is not yet admin-declared the
  // entry's gated public_status will not be in WINNER_PUBLIC_KEYS and the
  // win is silently dropped from the feed.
  const winIds = useMemo(() => winCandidates.map(w => w.id), [winCandidates]);
  const gated = useGatedEntryStatus(winIds);

  const activities = useMemo<ActivityItem[]>(() => {
    // Wait for the gate to resolve before rendering wins, otherwise we'd
    // either leak (if we showed eagerly) or flicker (if we showed then hid).
    if (winIds.length > 0 && !gated.data) return [];

    const winItems: ActivityItem[] = winCandidates
      .filter(w => {
        const row = gated.data?.[w.id];
        if (!row) return false;
        const display = resolveDisplayStatus(row);
        return WINNER_PUBLIC_KEYS.has(display);
      })
      .map(w => ({
        id: `win-${w.id}`,
        icon: <Trophy className="h-3.5 w-3.5 text-primary" />,
        text: `Won in ${w.competitionTitle}`,
        time: w.created_at,
      }));

    const merged = [...winItems, ...baseItems];
    merged.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return merged.slice(0, 8);
  }, [winCandidates, baseItems, gated.data, winIds.length]);

  // Mark loading=false once both base load and (if needed) gate have resolved.
  useEffect(() => {
    if (winIds.length === 0) {
      // No winner candidates → loading is done as soon as base load returns.
      // baseItems may still be empty (no follows/subs/certs either) — that's fine.
      setLoading(false);
    } else if (gated.data) {
      setLoading(false);
    }
  }, [winIds.length, gated.data, baseItems]);

  if (loading || activities.length === 0) return null;

  return (
    <div className="border border-border p-5 space-y-3">
      <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground" style={headingFont}>
        Recent Activity
      </h3>
      <div className="space-y-3">
        {activities.map((a) => (
          <div key={a.id} className="flex items-start gap-2.5">
            <div className="mt-0.5 flex-shrink-0">{a.icon}</div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground truncate" style={bodyFont}>{a.text}</p>
              <p className="text-[9px] text-muted-foreground/60" style={headingFont}>{timeAgo(a.time)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProfileActivityFeed;
