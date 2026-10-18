/**
 * S12-F5 · on a member's profile: "★ Add to Favourites" / "★ Favourite"
 * (remove), and "Unmute" when the viewer has muted them (S12-F1 Extra D; muted
 * from a post's ⋯ menu).
 *
 * Both go through the OFF-2 outbox (favouriteAuthor / unfavouriteAuthor /
 * unmuteAuthor in feedSignals.ts): kept on the device, sent exactly once — the
 * natural key (user_id, author_id) makes a resend the same row. The button
 * flips at once; a refusal (e.g. the 50-favourites cap, FAVOURITES-001) flips
 * it back and says why. State is read from the viewer's OWN rows (RLS: own
 * rows only), so it works the same on the web and in the Android app.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, Volume2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { favouriteAuthor, unfavouriteAuthor, unmuteAuthor } from "@/lib/feed/feedSignals";
import { forgetMute, mutedThisSession } from "@/hooks/feed/useHideAndMute";
import { useFeatureAllowed } from "@/hooks/core/useFeatureAllowed";

interface Prefs { favourite: boolean; muted: boolean }

export const authorPrefsKey = (viewerId: string | null | undefined, authorId: string) => ["author-prefs", viewerId ?? null, authorId] as const;

type From = (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> } } } };

async function readPrefs(viewerId: string, authorId: string): Promise<Prefs> {
  const one = async (table: string) => {
    try {
      // call position (supabase-js keeps `from` on its prototype — RED-1)
      const { data, error } = await (supabase.from as unknown as From)(table).select("author_id").eq("user_id", viewerId).eq("author_id", authorId).maybeSingle();
      return !error && !!data;
    } catch {
      return false;
    }
  };
  const [favourite, muted] = await Promise.all([one("feed_favourite_authors"), one("feed_muted_authors")]);
  return { favourite, muted: muted || mutedThisSession(authorId) };
}

function refusalMessage(e: unknown): string {
  const m = (e as { message?: string } | null)?.message ?? "";
  if (m.includes("FAVOURITES-001")) return "You can have up to 50 favourites. Remove one first.";
  return "Couldn't save that — try again.";
}

export default function FavouriteMuteButtons({ viewerId, authorId, authorName }: { viewerId: string | null | undefined; authorId: string; authorName?: string | null }) {
  const qc = useQueryClient();
  const key = authorPrefsKey(viewerId, authorId);
  // Shown only to members the personal_feed switch includes (review #466 B1):
  // with the switch Off a ★ would feed a tab the member cannot open.
  const allowed = useFeatureAllowed("personal_feed");
  const enabled = allowed && !!viewerId && viewerId !== authorId;
  const { data } = useQuery({ queryKey: key, enabled, queryFn: () => readPrefs(viewerId!, authorId), staleTime: 60_000 });
  if (!enabled) return null;
  const prefs: Prefs = data ?? { favourite: false, muted: mutedThisSession(authorId) };

  const set = (patch: Partial<Prefs>) => qc.setQueryData<Prefs>(key, (old) => ({ ...(old ?? prefs), ...patch }));

  const toggleFavourite = () => {
    const next = !prefs.favourite;
    set({ favourite: next });
    const send = next ? favouriteAuthor(viewerId, authorId) : unfavouriteAuthor(viewerId, authorId);
    void send.then(() => {
      toast({ title: next ? `${authorName?.trim() || "Member"} added to Favourites` : "Removed from Favourites" });
    }).catch((e) => {
      set({ favourite: !next });
      toast({ title: refusalMessage(e), variant: "destructive" });
    });
  };

  const unmute = () => {
    set({ muted: false });
    forgetMute(authorId);
    void unmuteAuthor(viewerId, authorId).then(() => {
      toast({ title: `Unmuted ${authorName?.trim() || "member"}` });
    }).catch((e) => {
      set({ muted: true });
      toast({ title: refusalMessage(e), variant: "destructive" });
    });
  };

  const btn = "inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-3 py-2 border transition-all duration-300 disabled:opacity-50";
  return (
    <>
      <button
        type="button"
        onClick={toggleFavourite}
        // until the member's own row has been read, a tap could be overwritten by it
        disabled={data === undefined}
        aria-pressed={prefs.favourite}
        aria-label={prefs.favourite ? "Remove from Favourites" : "Add to Favourites"}
        title={prefs.favourite ? "Remove from Favourites" : "Add to Favourites"}
        data-testid="profile-favourite-button"
        className={`${btn} ${prefs.favourite ? "border-primary bg-primary text-primary-foreground" : "border-primary/50 text-primary hover:bg-primary/10"}`}
        style={{ fontFamily: "var(--font-heading)" }}
      >
        <Star className="h-3 w-3" fill={prefs.favourite ? "currentColor" : "none"} />
        {/* phone width: the star alone (the action row is already full) */}
        <span className="hidden sm:inline">{prefs.favourite ? "Favourite" : "Add to Favourites"}</span>
      </button>
      {prefs.muted && (
        <button
          type="button"
          onClick={unmute}
          data-testid="profile-unmute-button"
          className={`${btn} border-border text-muted-foreground hover:text-foreground`}
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <Volume2 className="h-3 w-3" /> Unmute
        </button>
      )}
    </>
  );
}
