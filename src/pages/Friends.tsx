import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Users, Heart, UserMinus, UserX, UserCheck, Search, Clock } from "lucide-react";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useUserBadgesBatch } from "@/hooks/profile/useUserBadges";
import { supabase } from "@/integrations/supabase/client";
import { useAcceptFriendRequest, useRemoveFriendship, useToggleFollow } from "@/hooks/social/useFriendshipMutations";
import { profilesPublic } from "@/lib/profilesPublic";
import { toast } from "@/hooks/core/use-toast";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { getAdminIds, resolveName } from "@/lib/adminBrand";
import { profileUrl } from "@/lib/urlHelpers";
import { formatLastSeen, isActiveNow } from "@/hooks/core/useLastActive";

interface FriendProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  country: string | null;
  custom_url: string | null;
  last_active_at: string | null;
}

interface FriendRow {
  friendshipId: string;
  profile: FriendProfile;
  since: string;
}

interface FollowRow {
  id: string;
  profile: FriendProfile;
  since: string;
}

interface PendingRequest {
  friendshipId: string;
  profile: FriendProfile;
  since: string;
  direction: "sent" | "received";
}

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };
const displayFont = { fontFamily: "var(--font-display)" };

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  }),
};

const Friends = () => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const acceptMutation = useAcceptFriendRequest();
  const removeMutation = useRemoveFriendship();
  const followMutation = useToggleFollow();
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [followers, setFollowers] = useState<FollowRow[]>([]);
  const [following, setFollowing] = useState<FollowRow[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  const [mutualCounts, setMutualCounts] = useState<Map<string, number>>(new Map());
  const [mutualProfiles, setMutualProfiles] = useState<Map<string, { id: string; full_name: string | null; avatar_url: string | null }[]>>(new Map());

  const fetchAll = useCallback(async () => {
    if (!user) return;

    const [friendshipsRes, followersRes, followingRes, pendingRes] = await Promise.all([
      supabase.from("friendships")
        .select("id, requester_id, addressee_id, created_at")
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq("status", "accepted"),
      supabase.from("follows")
        .select("id, follower_id, created_at")
        .eq("following_id", user.id),
      supabase.from("follows")
        .select("id, following_id, created_at")
        .eq("follower_id", user.id),
      supabase.from("friendships")
        .select("id, requester_id, addressee_id, created_at")
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq("status", "pending"),
    ]);

    // Collect all user IDs we need profiles for
    const userIds = new Set<string>();
    friendshipsRes.data?.forEach((f) => {
      userIds.add(f.requester_id === user.id ? f.addressee_id : f.requester_id);
    });
    followersRes.data?.forEach((f) => userIds.add(f.follower_id));
    followingRes.data?.forEach((f) => userIds.add(f.following_id));
    pendingRes.data?.forEach((f) => {
      userIds.add(f.requester_id === user.id ? f.addressee_id : f.requester_id);
    });

    // Batch fetch all profiles
    const profileMap = new Map<string, FriendProfile>();
    const adminIds = await getAdminIds();
    if (userIds.size > 0) {
      const { data: profiles } = await profilesPublic()
        .select("id, full_name, avatar_url, bio, current_city, custom_url, last_active_at")
        .in("id", Array.from(userIds));
      profiles?.forEach((p: any) => {
        const resolved = {
          ...p,
          full_name: resolveName(p.id, p.full_name, adminIds),
          city: p.current_city ?? null,
          country: null,
        };
        profileMap.set(p.id, resolved);
      });
    }

    // Batch fetch mutual friend counts — 2 queries total instead of N*2
    const otherIds = Array.from(userIds);
    const mcMap = new Map<string, number>();
    const mpMap = new Map<string, { id: string; full_name: string | null; avatar_url: string | null }[]>();

    if (otherIds.length > 0) {
      // Single batch RPC for counts
      const countResults = await Promise.all(
        // Use chunks of 20 to avoid overly large RPC calls
        [otherIds].map(async (chunk) => {
          const results: { uid: string; count: number; friendIds: string[] }[] = [];
          // Fire counts in parallel but batched (max 20 concurrent)
          const batchSize = 20;
          for (let i = 0; i < chunk.length; i += batchSize) {
            const batch = chunk.slice(i, i + batchSize);
            const batchResults = await Promise.all(
              batch.map(async (uid) => {
                const { data: count } = await supabase.rpc("mutual_friends_count" as any, { _user_a: user.id, _user_b: uid });
                const total = (count as number) ?? 0;
                let friendIds: string[] = [];
                if (total > 0) {
                  const { data: ids } = await supabase.rpc("mutual_friend_ids" as any, { _user_a: user.id, _user_b: uid, _limit: 3 });
                  friendIds = ((ids as any[]) || []).map((r: any) => r.friend_id);
                }
                return { uid, count: total, friendIds };
              })
            );
            results.push(...batchResults);
          }
          return results;
        })
      );

      const allMutualFriendIds = new Set<string>();
      countResults.flat().forEach((r) => {
        mcMap.set(r.uid, r.count);
        r.friendIds.forEach((id) => allMutualFriendIds.add(id));
      });

      // Single batch profile fetch for all mutual friends
      if (allMutualFriendIds.size > 0) {
        const { data: mProfiles } = await profilesPublic()
          .select("id, full_name, avatar_url")
          .in("id", Array.from(allMutualFriendIds));
        const mProfileMap = new Map((mProfiles || []).map((p: any) => [p.id, p]));

        countResults.flat().forEach((r) => {
          if (r.friendIds.length > 0) {
            mpMap.set(r.uid, r.friendIds.map((id) => mProfileMap.get(id)).filter(Boolean) as any);
          }
        });
      }
    }

    setMutualCounts(mcMap);
    setMutualProfiles(mpMap);

    const fallback: FriendProfile = { id: "", full_name: "Unknown", avatar_url: null, bio: null, city: null, country: null, custom_url: null, last_active_at: null };

    setFriends(
      (friendshipsRes.data || []).map((f) => {
        const otherId = f.requester_id === user.id ? f.addressee_id : f.requester_id;
        return { friendshipId: f.id, profile: profileMap.get(otherId) || { ...fallback, id: otherId }, since: f.created_at };
      })
    );

    setFollowers(
      (followersRes.data || []).map((f) => ({
        id: f.id, profile: profileMap.get(f.follower_id) || { ...fallback, id: f.follower_id }, since: f.created_at,
      }))
    );

    setFollowing(
      (followingRes.data || []).map((f) => ({
        id: f.id, profile: profileMap.get(f.following_id) || { ...fallback, id: f.following_id }, since: f.created_at,
      }))
    );

    setPendingRequests(
      (pendingRes.data || []).map((f) => {
        const otherId = f.requester_id === user.id ? f.addressee_id : f.requester_id;
        return {
          friendshipId: f.id,
          profile: profileMap.get(otherId) || { ...fallback, id: otherId },
          since: f.created_at,
          direction: f.requester_id === user.id ? "sent" : "received",
        };
      })
    );

    setLoading(false);
  }, [user]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const removeFriend = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    try {
      await removeMutation.mutateAsync(friendshipId);
      setFriends((prev) => prev.filter((f) => f.friendshipId !== friendshipId));
    } catch { /* handled by hook */ }
    setActionLoading(null);
  };

  const unfollow = async (followId: string, followingId: string) => {
    setActionLoading(followId);
    try {
      await followMutation.mutateAsync({ targetUserId: followingId, isCurrentlyFollowing: true });
      setFollowing((prev) => prev.filter((f) => f.id !== followId));
    } catch { /* handled by hook */ }
    setActionLoading(null);
  };

  const acceptRequest = async (friendshipId: string, requesterId: string) => {
    setActionLoading(friendshipId);
    try {
      await acceptMutation.mutateAsync({ friendshipId, targetUserId: requesterId });
      await fetchAll();
    } catch { /* handled by hook */ }
    setActionLoading(null);
  };

  const declineRequest = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    try {
      await removeMutation.mutateAsync(friendshipId);
      setPendingRequests((prev) => prev.filter((r) => r.friendshipId !== friendshipId));
    } catch { /* handled by hook */ }
    setActionLoading(null);
  };

  const filterBySearch = (profile: FriendProfile) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (profile.full_name || "").toLowerCase().includes(q) ||
      (profile.city || "").toLowerCase().includes(q) ||
      (profile.country || "").toLowerCase().includes(q);
  };

  const allListedUserIds = useMemo(
    () => Array.from(new Set([
      ...pendingRequests.map((r) => r.profile.id),
      ...friends.map((f) => f.profile.id),
      ...followers.map((f) => f.profile.id),
      ...following.map((f) => f.profile.id),
    ].filter(Boolean))),
    [pendingRequests, friends, followers, following]
  );
  const badgeMap = useUserBadgesBatch(allListedUserIds);

  if (authLoading || loading || !user) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={headingFont}>
          Loading...
        </div>
      </main>
    );
  }

  const formatDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto py-3 md:py-20">

        <motion.div initial="hidden" animate="visible">
          <motion.div variants={fadeUp} custom={0} className="mb-4 md:mb-10 px-2 md:px-0">
            <div className="flex items-center gap-4 mb-2">
              <div className="w-12 h-px bg-primary" />
              <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={headingFont}>
                Connections
              </span>
            </div>
            <h1 className="text-xl md:text-3xl font-light tracking-tight mb-3 md:mb-6" style={displayFont}>
              Friends & <em className="italic text-primary">Network</em>
            </h1>

            {/* Summary stats */}
          </motion.div>

          <motion.div variants={fadeUp} custom={1}>
            {/* Search */}
            <div className="relative max-w-sm mb-4 md:mb-8 px-2 md:px-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name..."
                className="pl-9 bg-transparent text-sm"
              />
            </div>

            <Tabs defaultValue={pendingRequests.length > 0 ? "pending" : "friends"} className="w-full">
              <div className="overflow-x-auto scrollbar-hide -mx-2 px-2 md:mx-0 md:px-0 mb-3 md:mb-6" style={{ WebkitOverflowScrolling: "touch" }}>
                <TabsList className="inline-flex gap-2 bg-transparent border-none p-0 h-auto w-max min-w-full md:min-w-0">
                {pendingRequests.length > 0 && (
                  <TabsTrigger value="pending" className="shrink-0 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-[9px] md:text-[10px] tracking-[0.1em] uppercase gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary shadow-none" style={headingFont}>
                    <Clock className="h-3 w-3 shrink-0" /> Pending ({pendingRequests.length})
                  </TabsTrigger>
                )}
                <TabsTrigger value="friends" className="shrink-0 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-[9px] md:text-[10px] tracking-[0.1em] uppercase gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary shadow-none" style={headingFont}>
                  <Users className="h-3 w-3 shrink-0" /> Friends ({friends.length})
                </TabsTrigger>
                <TabsTrigger value="followers" className="shrink-0 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-[9px] md:text-[10px] tracking-[0.1em] uppercase gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary shadow-none" style={headingFont}>
                  <Heart className="h-3 w-3 shrink-0" /> Followers ({followers.length})
                </TabsTrigger>
                <TabsTrigger value="following" className="shrink-0 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-[9px] md:text-[10px] tracking-[0.1em] uppercase gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary shadow-none" style={headingFont}>
                  <Heart className="h-3 w-3 shrink-0" /> Following ({following.length})
                </TabsTrigger>
                </TabsList>
              </div>

              {/* Pending Requests */}
              {pendingRequests.length > 0 && (
                <TabsContent value="pending">
                  <div className="border border-border divide-y divide-border">
                    {pendingRequests.filter((r) => filterBySearch(r.profile)).map((req) => (
                      <PersonRow
                        key={req.friendshipId}
                        profile={req.profile}
                        badges={badgeMap.get(req.profile.id) || []}
                        mutualCount={mutualCounts.get(req.profile.id)}
                        mutualFriends={mutualProfiles.get(req.profile.id)}
                        subtitle={req.direction === "sent" ? "Request sent" : "Wants to be your friend"}
                        date={formatDate(req.since)}
                        actions={
                          req.direction === "received" ? (
                            <div className="flex gap-2">
                              <ActionBtn
                                icon={<UserCheck className="h-3 w-3" />}
                                label="Accept"
                                onClick={() => acceptRequest(req.friendshipId, req.profile.id)}
                                disabled={actionLoading === req.friendshipId}
                                variant="primary"
                              />
                              <ActionBtn
                                icon={<UserX className="h-3 w-3" />}
                                label="Decline"
                                onClick={() => declineRequest(req.friendshipId)}
                                disabled={actionLoading === req.friendshipId}
                                variant="muted"
                              />
                            </div>
                          ) : (
                            <ActionBtn
                              icon={<UserX className="h-3 w-3" />}
                              label="Cancel"
                              onClick={() => declineRequest(req.friendshipId)}
                              disabled={actionLoading === req.friendshipId}
                              variant="muted"
                            />
                          )
                        }
                      />
                    ))}
                  </div>
                  {pendingRequests.filter((r) => filterBySearch(r.profile)).length === 0 && (
                    <EmptyState message="No matching pending requests" />
                  )}
                </TabsContent>
              )}

              {/* Friends */}
              <TabsContent value="friends">
                {friends.filter((f) => filterBySearch(f.profile)).length > 0 ? (
                  <div className="border border-border divide-y divide-border">
                    {friends.filter((f) => filterBySearch(f.profile)).map((f) => (
                      <PersonRow
                        key={f.friendshipId}
                        profile={f.profile}
                        badges={badgeMap.get(f.profile.id) || []}
                        mutualCount={mutualCounts.get(f.profile.id)}
                        mutualFriends={mutualProfiles.get(f.profile.id)}
                        subtitle={f.profile.city && f.profile.country ? `${f.profile.city}, ${f.profile.country}` : f.profile.bio?.slice(0, 60) || null}
                        date={`Friends since ${formatDate(f.since)}`}
                        actions={
                          <ActionBtn
                            icon={<UserMinus className="h-3 w-3" />}
                            label="Remove"
                            onClick={() => removeFriend(f.friendshipId)}
                            disabled={actionLoading === f.friendshipId}
                            variant="danger"
                          />
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState message={search ? "No friends match your search" : "You haven't added any friends yet. Visit other profiles to connect!"} />
                )}
              </TabsContent>

              {/* Followers */}
              <TabsContent value="followers">
                {followers.filter((f) => filterBySearch(f.profile)).length > 0 ? (
                  <div className="border border-border divide-y divide-border">
                    {followers.filter((f) => filterBySearch(f.profile)).map((f) => (
                      <PersonRow
                        key={f.id}
                        profile={f.profile}
                        badges={badgeMap.get(f.profile.id) || []}
                        mutualCount={mutualCounts.get(f.profile.id)}
                        mutualFriends={mutualProfiles.get(f.profile.id)}
                        subtitle={f.profile.city && f.profile.country ? `${f.profile.city}, ${f.profile.country}` : null}
                        date={`Following since ${formatDate(f.since)}`}
                        actions={null}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState message={search ? "No followers match your search" : "No followers yet. Share your profile to grow your audience!"} />
                )}
              </TabsContent>

              {/* Following */}
              <TabsContent value="following">
                {following.filter((f) => filterBySearch(f.profile)).length > 0 ? (
                  <div className="border border-border divide-y divide-border">
                    {following.filter((f) => filterBySearch(f.profile)).map((f) => (
                      <PersonRow
                        key={f.id}
                        profile={f.profile}
                        badges={badgeMap.get(f.profile.id) || []}
                        mutualCount={mutualCounts.get(f.profile.id)}
                        mutualFriends={mutualProfiles.get(f.profile.id)}
                        subtitle={f.profile.city && f.profile.country ? `${f.profile.city}, ${f.profile.country}` : null}
                        date={`Since ${formatDate(f.since)}`}
                        actions={
                          <ActionBtn
                            icon={<Heart className="h-3 w-3" />}
                            label="Unfollow"
                            onClick={() => unfollow(f.id, f.profile.id)}
                            disabled={actionLoading === f.id}
                            variant="muted"
                          />
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState message={search ? "No following match your search" : "You're not following anyone yet. Discover photographers to follow!"} />
                )}
              </TabsContent>
            </Tabs>
          </motion.div>
        </motion.div>
      </div>
    </main>
  );
};

/* ─── Sub-components ─── */

const PersonRow = ({ profile, badges, subtitle, date, actions, mutualCount, mutualFriends }: {
  profile: FriendProfile;
  badges: string[];
  subtitle: string | null;
  date: string;
  actions: React.ReactNode;
  mutualCount?: number;
  mutualFriends?: { id: string; full_name: string | null; avatar_url: string | null }[];
}) => {
  const name = profile.full_name || "Unknown User";
  const initials = name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div className="flex gap-3 p-3 md:p-5">
      <Link to={profileUrl(profile)} className="shrink-0 mt-0.5 relative">
        {profile.avatar_url ? (
          <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={profile.avatar_url} alt={name} className="w-11 h-11 rounded-full object-cover" />
        ) : (
          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-sm font-light text-primary" style={{ fontFamily: "var(--font-display)" }}>{initials}</span>
          </div>
        )}
        {/* Online/Offline dot */}
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${
            isActiveNow(profile.last_active_at) ? "bg-green-500" : "bg-muted-foreground/30"
          }`}
        />
      </Link>
      <div className="flex-1 min-w-0">
        {/* Top row: name + date */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <UserIdentityBlock
              userId={profile.id}
              name={name}
              linkTo={profileUrl(profile)}
              nameClassName="text-sm font-light hover:text-primary transition-colors duration-300 break-words [font-family:var(--font-heading)]"
            />
          </div>
          <span className="text-[8px] text-muted-foreground shrink-0 mt-0.5 whitespace-nowrap" style={{ fontFamily: "var(--font-body)" }}>
            {date}
          </span>
        </div>
        {mutualCount != null && mutualCount > 0 && (
          <div className="flex items-center gap-1.5 mt-0.5">
            {/* Real avatars of mutual friends */}
            <div className="flex -space-x-1.5">
              {(mutualFriends || []).slice(0, 3).map((m) => (
                <Link key={m.id} to={`/profile/${m.id}`} className="relative z-[1] hover:z-10 transition-transform hover:scale-110">
                  {m.avatar_url ? (
                    <img loading="lazy" decoding="async"
                      src={m.avatar_url}
                      alt={m.full_name || ""}
                      className="h-5 w-5 rounded-full border-2 border-background object-cover"
                    />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-background bg-muted flex items-center justify-center">
                      <span className="text-[7px] font-semibold text-muted-foreground">
                        {(m.full_name || "?")[0]?.toUpperCase()}
                      </span>
                    </div>
                  )}
                </Link>
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground" style={headingFont}>
              {mutualCount} mutual friend{mutualCount !== 1 ? "s" : ""}
              {mutualFriends && mutualFriends.length > 0 && (
                <> including{" "}
                  <Link to={`/profile/${mutualFriends[0].id}`} className="text-foreground font-medium hover:text-primary transition-colors">
                    {mutualFriends[0].full_name || "a friend"}
                  </Link>
                  {mutualCount > 1 && mutualFriends.length > 1 && (
                    <> and{" "}
                      <Link to={`/profile/${mutualFriends[1].id}`} className="text-foreground font-medium hover:text-primary transition-colors">
                        {mutualFriends[1].full_name || "others"}
                      </Link>
                    </>
                  )}
                </>
              )}
            </span>
          </div>
        )}
        {subtitle && (
          <p className="text-[10px] text-muted-foreground truncate mt-0.5" style={{ fontFamily: "var(--font-body)" }}>
            {subtitle}
          </p>
        )}
        {/* Last seen indicator */}
        {profile.last_active_at && (
          <p className={`text-[9px] mt-0.5 ${isActiveNow(profile.last_active_at) ? "text-green-600 dark:text-green-400" : "text-muted-foreground/60"}`} style={{ fontFamily: "var(--font-body)" }}>
            {formatLastSeen(profile.last_active_at)}
          </p>
        )}
        {/* Action buttons below */}
        {actions && (
          <div className="mt-2 flex items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
};

const ActionBtn = ({ icon, label, onClick, disabled, variant }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
  variant: "primary" | "danger" | "muted";
}) => {
  const styles = {
    primary: "border-primary/50 text-primary hover:bg-primary hover:text-primary-foreground",
    danger: "border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground",
    muted: "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 border transition-all duration-300 disabled:opacity-50 ${styles[variant]}`}
      style={{ fontFamily: "var(--font-heading)" }}
    >
      {icon}
      {label}
    </button>
  );
};

const EmptyState = ({ message }: { message: string }) => (
  <div className="border border-dashed border-border p-10 text-center">
    <Users className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
    <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
      {message}
    </p>
  </div>
);

export default Friends;
