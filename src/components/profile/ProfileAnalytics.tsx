import { useEffect, useState } from "react";
import { Eye, TrendingUp, UserPlus, Heart, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSimulatedStats } from "@/lib/simulatedEngagement";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

const formatNum = (n: number) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
};

interface Props {
  userId: string;
  createdAt: string;
}

const ProfileAnalytics = ({ userId, createdAt }: Props) => {
  const [realViews, setRealViews] = useState(0);
  const [followersCount, setFollowersCount] = useState(0);
  const [reactionsCount, setReactionsCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Simulated stats for the auto-increasing effect
  const simulated = getSimulatedStats(userId, createdAt);

  useEffect(() => {
    const load = async () => {
      const [viewsRes, followersRes, reactionsRes] = await Promise.all([
        supabase.from("profile_views" as any).select("id", { count: "exact", head: true }).eq("profile_id", userId),
        supabase.from("follows").select("id", { count: "exact", head: true }).eq("following_id", userId),
        supabase.from("image_reactions").select("id", { count: "exact", head: true }).eq("user_id", userId),
      ]);
      setRealViews((viewsRes as any).count || 0);
      setFollowersCount((followersRes as any).count || 0);
      setReactionsCount((reactionsRes as any).count || 0);
      setLoading(false);
    };
    load();
  }, [userId]);

  // Combine real + simulated for display
  const totalViews = realViews + (simulated.show ? simulated.views : 0);
  const totalReach = simulated.show ? simulated.reach : Math.max(followersCount * 3, 50);

  const stats = [
    { icon: Eye, label: "Profile Views", value: formatNum(totalViews), color: "text-blue-500" },
    { icon: UserPlus, label: "Followers", value: formatNum(followersCount), color: "text-emerald-500" },
    { icon: Heart, label: "Total Reactions", value: formatNum(reactionsCount + (simulated.show ? Math.floor(simulated.views * 0.05) : 0)), color: "text-pink-500" },
    { icon: TrendingUp, label: "Reach", value: formatNum(totalReach), color: "text-primary" },
  ];

  return (
    <div className="border border-border p-6 space-y-4">
      <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
        <BarChart3 className="h-3.5 w-3.5 text-primary" />
        Profile Insights
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="p-3 bg-muted/30 border border-border rounded-sm">
            <div className="flex items-center gap-2 mb-1">
              <stat.icon className={`h-3.5 w-3.5 ${stat.color}`} />
              <span className="text-[9px] tracking-[0.12em] uppercase text-muted-foreground" style={headingFont}>{stat.label}</span>
            </div>
            <p className="text-lg font-light tracking-tight" style={bodyFont}>
              {loading ? "—" : stat.value}
            </p>
          </div>
        ))}
      </div>
      {simulated.isTrending && (
        <div className="flex items-center gap-2 text-[10px] text-primary" style={headingFont}>
          <TrendingUp className="h-3 w-3" />
          Your profile is trending!
        </div>
      )}
    </div>
  );
};

export default ProfileAnalytics;
