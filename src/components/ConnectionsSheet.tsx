import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { fetchProfileMap, type ProfileMapEntry } from "@/lib/profileMapCache";
import { memberPath } from "@/lib/urlHelpers";
import OptimizedImage from "@/components/OptimizedImage";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * THE ONE PLACE a profile's Friends / Followers / Following counts open
 * (Owner, 7 Nov 2026: the counts must be links).
 *
 * - On your OWN profile they go to your Friends page on that tab, where you
 *   can manage the lists.
 * - On someone else's profile Followers / Following open their list here (the
 *   follows table is public). Friends lists are private — each member can only
 *   read their own friendships — so "Friends" shows the friends you have IN
 *   COMMON with them (mutual_friend_ids), and says so.
 *
 * Desktop (FriendFollowStats) and phone (ProfileStatRow) both use this hook.
 */
export type ConnectionKind = "friends" | "followers" | "following";

const LIST_MAX = 200;

async function loadIds(kind: ConnectionKind, targetUserId: string, viewerId: string | null): Promise<string[]> {
  if (kind === "friends") {
    if (!viewerId) return [];
    const { data } = await supabase.rpc("mutual_friend_ids" as never, { _user_a: viewerId, _user_b: targetUserId, _limit: LIST_MAX } as never);
    return (((data as unknown) as { friend_id: string }[] | null) || []).map((r) => r.friend_id);
  }
  if (kind === "followers") {
    const { data } = await supabase.from("follows").select("follower_id")
      .eq("following_id", targetUserId).order("created_at", { ascending: false }).limit(LIST_MAX);
    return (data || []).map((r) => r.follower_id);
  }
  const { data } = await supabase.from("follows").select("following_id")
    .eq("follower_id", targetUserId).order("created_at", { ascending: false }).limit(LIST_MAX);
  return (data || []).map((r) => r.following_id);
}

function ConnectionsList({ kind, targetUserId, onPick }: { kind: ConnectionKind; targetUserId: string; onPick: () => void }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ProfileMapEntry[] | null>(null);
  useEffect(() => {
    let gone = false;
    setRows(null);
    void (async () => {
      try {
        const ids = await loadIds(kind, targetUserId, user?.id ?? null);
        const map = ids.length ? await fetchProfileMap(ids) : new Map();
        if (!gone) setRows(ids.map((id) => map.get(id)).filter((p): p is ProfileMapEntry => !!p));
      } catch {
        if (!gone) setRows([]);
      }
    })();
    return () => { gone = true; };
  }, [kind, targetUserId, user?.id]);

  if (rows === null) return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {kind === "friends" ? "No friends in common yet." : kind === "followers" ? "No followers yet." : "Not following anyone yet."}
      </p>
    );
  }
  return (
    <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
      {rows.map((p) => {
        const to = memberPath(p.custom_url);
        const inner = (
          <>
            {p.avatar_url ? (
              <OptimizedImage src={p.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <span className="h-10 w-10 rounded-full bg-muted" />
            )}
            <span className="min-w-0 truncate text-sm font-semibold">{p.full_name || "Member"}</span>
          </>
        );
        return (
          <li key={p.id}>
            {to ? (
              <Link to={to} onClick={onPick} className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted">{inner}</Link>
            ) : (
              <span className="flex min-h-11 items-center gap-3 px-2 py-1.5">{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const TITLES: Record<ConnectionKind, string> = { friends: "Friends in common", followers: "Followers", following: "Following" };

/** open(kind) for a count; render `sheet` once next to the counts. */
export function useConnections(targetUserId: string, isSelf: boolean): { open: (kind: ConnectionKind) => void; sheet: ReactNode } {
  const navigate = useNavigate();
  const [kind, setKind] = useState<ConnectionKind | null>(null);
  const open = useCallback((k: ConnectionKind) => {
    if (isSelf) navigate(`/friends?tab=${k}`);
    else setKind(k);
  }, [isSelf, navigate]);
  const sheet = (
    <Dialog open={kind !== null} onOpenChange={(o) => { if (!o) setKind(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{kind ? TITLES[kind] : ""}</DialogTitle>
          {kind === "friends" && <DialogDescription>Friends lists are private, so you see the friends you share.</DialogDescription>}
        </DialogHeader>
        {kind && <ConnectionsList kind={kind} targetUserId={targetUserId} onPick={() => setKind(null)} />}
      </DialogContent>
    </Dialog>
  );
  return { open, sheet };
}
