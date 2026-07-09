import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { Users } from "lucide-react";
import ProfileLink from "@/components/ProfileLink";

const headingFont = { fontFamily: "var(--font-heading)" };

interface MutualFriend {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

interface Props {
  targetUserId: string;
}

const MutualFriends = ({ targetUserId }: Props) => {
  const { user } = useAuth();
  const [mutuals, setMutuals] = useState<MutualFriend[]>([]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user || !targetUserId || user.id === targetUserId) return;

    const load = async () => {
      const [countRes, idsRes] = await Promise.all([
        supabase.rpc("mutual_friends_count" as any, { _user_a: user.id, _user_b: targetUserId }),
        supabase.rpc("mutual_friend_ids" as any, { _user_a: user.id, _user_b: targetUserId, _limit: 5 }),
      ]);

      const total = (countRes.data as number) ?? 0;
      setCount(total);
      if (total === 0) return;

      const friendIds = ((idsRes.data as any[]) || []).map((r: any) => r.friend_id);
      if (friendIds.length === 0) return;

      const { data: profiles } = await supabase
        .from("profiles_public_data")
        .select("id, full_name, avatar_url")
        .in("id", friendIds);

      if (profiles) setMutuals(profiles as MutualFriend[]);
    };
    load();
  }, [user, targetUserId]);

  if (!user || user.id === targetUserId || count === 0) return null;

  return (
    <div className="flex items-center gap-2 mt-1">
      {/* Stacked avatars */}
      {mutuals.length > 0 && (
        <div className="flex -space-x-2">
          {mutuals.slice(0, 4).map((m) => (
            <ProfileLink key={m.id} userId={m.id}>
              {m.avatar_url ? (
                <img loading="lazy" decoding="async"
                  src={m.avatar_url}
                  alt={m.full_name || ""}
                  className="h-6 w-6 rounded-full border-2 border-background object-cover"
                />
              ) : (
                <div className="h-6 w-6 rounded-full border-2 border-background bg-muted flex items-center justify-center">
                  <Users className="h-3 w-3 text-muted-foreground" />
                </div>
              )}
            </ProfileLink>
          ))}
        </div>
      )}
      <span className="text-[11px] text-muted-foreground" style={headingFont}>
        {count} mutual friend{count !== 1 ? "s" : ""}
        {mutuals.length > 0 && (
          <> including <strong className="text-foreground">{mutuals[0]?.full_name || "a friend"}</strong>
            {count > 1 && mutuals.length > 1 && <> and <strong className="text-foreground">{mutuals[1]?.full_name || "others"}</strong></>}
          </>
        )}
      </span>
    </div>
  );
};

export default MutualFriends;
