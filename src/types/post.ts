import type { ReactionType } from "@/components/ReactionPicker";

/**
 * Unified Post type — used by BOTH Feed and Wall.
 * The only difference between the two surfaces is the query, not the shape.
 */
export interface UnifiedPost {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  image_urls: string[];
  /**
   * The 600px thumbnails the uploader stored beside each image, aligned with
   * image_urls by index (posts.thumbnail_urls). Optional: older posts have
   * none, and the feed RPC does not return it (it is batch-fetched after).
   * The feed card shows this small copy when present; NEVER derive a thumbnail
   * address by string rule — that broke many old posts on 2026-08-07, because
   * their originals live on the CDN but their thumbnails live on Supabase
   * storage. Read the note in PostMedia.tsx before changing this.
   */
  thumbnail_urls?: (string | null)[] | null;
  privacy: string;
  created_at: string;
  author_name: string | null;
  author_avatar: string | null;
  author_last_active?: string | null;
  author_badges?: string[];
  like_count: number;
  comment_count: number;
  share_count: number;
  is_liked: boolean;
  user_reaction: ReactionType | null;
  top_reactions: string[];
  reaction_counts: Record<string, number>;
  is_suggested?: boolean;
  /**
   * Friendship state between the viewer and this post's author.
   * "none" = no friendship row exists in either direction (the only state where
   * an "Add friend" button may be shown). Anything else means a row already
   * exists, and inserting another would violate the unique constraint on
   * (requester_id, addressee_id) — the cause of the "duplicate key value"
   * error users hit on 2026-07-31.
   *
   * "unavailable" = this account does not accept friend requests at all
   * (the official/admin account — POLICY: follow only, never friend).
   */
  friend_state?: "none" | "sent" | "received" | "friends" | "unavailable";
  views?: number;
  reach?: number;
  /**
   * True when this row reached the wall through post_shares rather than being
   * authored by the wall's owner. Set ONLY by useUserPostsQuery — the feed does
   * not distinguish reshares. It is what lets the wall offer "Remove from my
   * wall" on a post somebody else wrote: before 2026-08-01 a mis-tapped share
   * could not be undone at all, because the post is not yours to delete and the
   * card offered nothing but "Report content".
   */
  is_reshare?: boolean;
  /**
   * People tagged in this post's photos, for the header line
   * "50mm Retina World with Avijit Sheel" (owner, 2026-08-10, with an
   * Instagram screenshot showing "vineet_vohra and ifp.festival").
   *
   * 'approved' rows appear for everyone. 'pending' rows appear ONLY for the
   * member who created the tag, flagged with `pending: true` — that is the
   * owner's ruling of 2026-08-10. A 'declined' or 'removed' row NEVER appears
   * for anybody: those are refusals, and the accept/decline flow exists exactly
   * so that a refusal is honoured.
   *
   * Empty or absent = nothing is rendered. Names go through resolveName(), so
   * a tagged admin shows as the brand exactly like an author does.
   */
  tagged_people?: TaggedPerson[];
}

/** One tag, already name-resolved for display. */
export interface TaggedPerson {
  id: string;
  name: string;
  /**
   * TRUE when the tagged person has not accepted yet.
   *
   * A pending tag is shown ONLY to the member who created it (owner decision,
   * 2026-08-10: "Show immediately, but only to me until accepted"), so that
   * tagging visibly works straight away without putting a stranger's name on a
   * photo before they have agreed. It is rendered differently — see
   * TaggedPeople.tsx — because a name that looks public but is not would be a
   * worse lie than showing nothing.
   */
  pending?: boolean;
  /**
   * The tagged member's badges, CARRIED WITH THE POST.
   *
   * Owner, 2026-08-14, with a screenshot of "Sophia Agarcia with 50mm Retina
   * World" and no tick, on an account that is verified in the database.
   *
   * The tick used to come from a SECOND, independent lookup (`AutoBadge` ->
   * `useProfileMap`) fired per name at render time, even though every query
   * that builds this list — useFeedQuery, useUserPostsQuery, HashtagFeed —
   * had already fetched these exact profiles, badges included, and thrown the
   * badges away. Two requests for one line of text, and the one that mattered
   * could fail, race or come back empty on its own.
   *
   * This is the same correction as the "names showing as ?" fix: if the post
   * and the name arrive together, "name visible, badge missing" stops being a
   * state the app can be in. Optional, so a caller that has not been migrated
   * still falls back to the lookup rather than silently losing the tick.
   */
  badges?: string[];
}
