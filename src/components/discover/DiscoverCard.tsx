import { memo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { UserPlus, Clock, UserCheck, UserMinus, Users, X } from "lucide-react";
import { useFriendFollow } from "@/hooks/social/useFriendFollow";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { profilesPublic } from "@/lib/profilesPublic";
import { useT } from "@/i18n/I18nContext";

const headingFont = { fontFamily: "var(--font-heading)" };
const displayFont = { fontFamily: "var(--font-display)" };

interface DiscoverProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

interface Props {
  profile: DiscoverProfile;
  onDismiss: (id: string) => void;
}

const DiscoverCard = memo(({ profile, onDismiss }: Props) => {
  const { user } = useAuth();
  const {
    friendStatus, loading, isSelf, isTargetAdmin, mutualFriendsCount,
    sendFriendRequest, removeFriend, acceptFriendRequest,
  } = useFriendFollow(profile.id);
  const t = useT();

  const [mutualFriends, setMutualFriends] = useState<{ id: string; full_name: string | null; avatar_url: string | null }[]>([]);

  useEffect(() => {
    if (!user || !profile.id || user.id === profile.id || mutualFriendsCount === 0) return;
    const load = async () => {
      const { data } = await supabase.rpc("mutual_friend_ids" as any, { _user_a: user.id, _user_b: profile.id, _limit: 3 });
      const ids = ((data as any[]) || []).map((r: any) => r.friend_id);
      if (ids.length === 0) return;
      const { data: profiles } = await profilesPublic().select("id, full_name, avatar_url").in("id", ids);
      if (profiles) setMutualFriends(profiles as any);
    };
    load();
  }, [user, profile.id, mutualFriendsCount]);

  if (isSelf) return null;

  const btnBase =
    "inline-flex items-center justify-center gap-1.5 text-[11px] md:text-xs font-semibold tracking-wide px-3 py-1.5 rounded-md transition-all duration-200 disabled:opacity-40";

  return (
    <div className="flex items-start gap-3 px-3 md:px-4 py-3 border-b border-border">
      {/* Large circular avatar — clickable */}
      <Link to={`/profile/${profile.id}`} className="shrink-0">
        {profile.avatar_url ? (
          <img loading="lazy" decoding="async"
            src={profile.avatar_url}
            alt=""
            className="w-16 h-16 md:w-14 md:h-14 rounded-full object-cover border-2 border-border"
          />
        ) : (
          <div className="w-16 h-16 md:w-14 md:h-14 rounded-full bg-primary/10 border-2 border-border flex items-center justify-center">
            <span className="text-lg md:text-base text-primary" style={displayFont}>
              {(profile.full_name || "?")[0]?.toUpperCase()}
            </span>
          </div>
        )}
      </Link>

      {/* Right content */}
      <div className="flex-1 min-w-0">
        {/* Name + Badge — clickable */}
        <UserIdentityBlock
          userId={profile.id}
          name={profile.full_name || "Photographer"}
          linkTo={`/profile/${profile.id}`}
          size="compact"
          nameClassName="text-sm md:text-[13px] font-semibold hover:text-primary transition-colors truncate"
        />

        {/* Mutual friends */}
        {mutualFriendsCount > 0 && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="flex -space-x-1.5">
              {mutualFriends.length > 0
                ? mutualFriends.slice(0, 3).map((m) => (
                    <Link key={m.id} to={`/profile/${m.id}`} className="relative z-[1] hover:z-10 transition-transform hover:scale-110">
                      {m.avatar_url ? (
                        <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={m.avatar_url} alt={m.full_name || ""} className="h-5 w-5 rounded-full border-2 border-background object-cover" />
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-background bg-muted flex items-center justify-center">
                          <span className="text-[7px] font-semibold text-muted-foreground">{(m.full_name || "?")[0]?.toUpperCase()}</span>
                        </div>
                      )}
                    </Link>
                  ))
                : Array.from({ length: Math.min(mutualFriendsCount, 2) }).map((_, i) => (
                    <div key={i} className="h-5 w-5 rounded-full bg-muted border-2 border-background flex items-center justify-center">
                      <Users className="h-2.5 w-2.5 text-muted-foreground" />
                    </div>
                  ))
              }
            </div>
            <span className="text-[11px] text-muted-foreground" style={headingFont}>
              {mutualFriendsCount} {t("fr.mutualFriends")}
              {mutualFriends.length > 0 && (
                <> {t("fr.including")}{" "}
                  <Link to={`/profile/${mutualFriends[0].id}`} className="text-foreground font-medium hover:text-primary transition-colors">
                    {mutualFriends[0].full_name || "a friend"}
                  </Link>
                </>
              )}
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-2">
          {!isTargetAdmin && friendStatus === "none" && (
            <>
              <button
                onClick={sendFriendRequest}
                disabled={loading}
                className={`${btnBase} bg-primary text-primary-foreground hover:bg-primary/90`}
                style={headingFont}
              >
                <UserPlus className="h-3.5 w-3.5" />
                {t("fr.addFriend")}
              </button>
              <button
                onClick={() => onDismiss(profile.id)}
                className={`${btnBase} bg-muted text-muted-foreground hover:bg-muted/80`}
                style={headingFont}
              >
                {t("fr.remove")}
              </button>
            </>
          )}
          {friendStatus === "pending_sent" && (
            <>
              <button
                onClick={removeFriend}
                disabled={loading}
                className={`${btnBase} bg-muted text-muted-foreground`}
                style={headingFont}
              >
                <Clock className="h-3.5 w-3.5" />
                {t("fr.requestSent")}
              </button>
              <button
                onClick={() => onDismiss(profile.id)}
                className={`${btnBase} bg-muted/60 text-muted-foreground hover:bg-muted/80`}
                style={headingFont}
              >
                {t("fr.remove")}
              </button>
            </>
          )}
          {friendStatus === "pending_received" && (
            <>
              <button
                onClick={acceptFriendRequest}
                disabled={loading}
                className={`${btnBase} bg-primary text-primary-foreground hover:bg-primary/90`}
                style={headingFont}
              >
                <UserCheck className="h-3.5 w-3.5" />
                {t("dash.accept")}
              </button>
              <button
                onClick={() => onDismiss(profile.id)}
                className={`${btnBase} bg-muted text-muted-foreground hover:bg-muted/80`}
                style={headingFont}
              >
                {t("fr.remove")}
              </button>
            </>
          )}
          {friendStatus === "accepted" && (
            <button
              onClick={removeFriend}
              disabled={loading}
              className={`${btnBase} bg-muted text-destructive hover:bg-destructive/10`}
              style={headingFont}
            >
              <UserMinus className="h-3.5 w-3.5" />
              {t("fr.unfriend")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

DiscoverCard.displayName = "DiscoverCard";
export default DiscoverCard;
