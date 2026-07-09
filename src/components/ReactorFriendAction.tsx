import { useState, useEffect } from "react";
import { UserPlus, UserCheck, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import {
  useSendFriendRequest,
  useAcceptFriendRequest,
} from "@/hooks/social/useFriendshipMutations";

interface Props {
  targetUserId: string;
}

type Status = "none" | "pending_sent" | "pending_received" | "accepted" | "self";

const ReactorFriendAction = ({ targetUserId }: Props) => {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status>("none");
  const [friendshipId, setFriendshipId] = useState<string | null>(null);

  const sendMutation = useSendFriendRequest();
  const acceptMutation = useAcceptFriendRequest();

  useEffect(() => {
    if (!user) return;
    if (user.id === targetUserId) {
      setStatus("self");
      return;
    }

    const check = async () => {
      const { data } = await supabase
        .from("friendships")
        .select("id, status, requester_id")
        .or(
          `and(requester_id.eq.${user.id},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${user.id})`
        )
        .maybeSingle();

      if (data) {
        setFriendshipId(data.id);
        if (data.status === "accepted") setStatus("accepted");
        else if (data.requester_id === user.id) setStatus("pending_sent");
        else setStatus("pending_received");
      } else {
        setStatus("none");
        setFriendshipId(null);
      }
    };
    check();
  }, [user, targetUserId]);

  if (!user || status === "self") return null;

  const loading = sendMutation.isPending || acceptMutation.isPending;

  const handleAdd = async () => {
    if (loading) return;
    await sendMutation.mutateAsync(targetUserId);
    setStatus("pending_sent");
  };

  const handleAccept = async () => {
    if (loading || !friendshipId) return;
    await acceptMutation.mutateAsync({ friendshipId, targetUserId });
    setStatus("accepted");
  };

  const base = "inline-flex items-center gap-1 text-[9px] tracking-wide uppercase font-semibold px-2 py-0.5 rounded-md border transition-colors whitespace-nowrap shrink-0";

  if (status === "accepted") {
    return (
      <span className={`${base} border-primary/30 text-primary bg-primary/5`}>
        <UserCheck className="h-3 w-3" />
        Friends
      </span>
    );
  }

  if (status === "pending_sent") {
    return (
      <span className={`${base} border-muted-foreground/30 text-muted-foreground`}>
        <Clock className="h-3 w-3" />
        Pending
      </span>
    );
  }

  if (status === "pending_received") {
    return (
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAccept(); }}
        disabled={loading}
        className={`${base} border-emerald-500/40 text-emerald-600 hover:bg-emerald-500 hover:text-white cursor-pointer`}
      >
        <UserCheck className="h-3 w-3" />
        Accept
      </button>
    );
  }

  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAdd(); }}
      disabled={loading}
      className={`${base} border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground cursor-pointer`}
    >
      <UserPlus className="h-3 w-3" />
      Add Friend
    </button>
  );
};

export default ReactorFriendAction;
