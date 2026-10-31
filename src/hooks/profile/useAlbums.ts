import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";

export interface PhotoAlbum {
  id: string;
  user_id: string;
  name: string;
  album_type: "profile_pictures" | "cover_photos" | "custom";
  cover_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlbumPhoto {
  id: string;
  album_id: string;
  image_url: string;
  caption: string | null;
  post_id: string | null;
  sort_order: number;
  created_at: string;
}

/** Fetch all albums for a user */
export function useUserAlbums(userId: string | undefined) {
  return useQuery({
    queryKey: ["photo-albums", userId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("photo_albums" as any)
        .select("*")
        .eq("user_id", userId!)
        .order("album_type")
        .order("created_at", { ascending: false }) as any);
      if (error) throw error;
      return (data as PhotoAlbum[]) || [];
    },
    enabled: !!userId,
  });
}

/** Fetch photos in an album */
export function useAlbumPhotos(albumId: string | undefined) {
  return useQuery({
    queryKey: ["album-photos", albumId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("album_photos" as any)
        .select("*")
        .eq("album_id", albumId!)
        .order("created_at", { ascending: false }) as any);
      if (error) throw error;
      return (data as AlbumPhoto[]) || [];
    },
    enabled: !!albumId,
  });
}

/** Get or create an auto-album (profile_pictures or cover_photos) */
export async function getOrCreateAutoAlbum(
  userId: string,
  albumType: "profile_pictures" | "cover_photos"
): Promise<string> {
  const { data: existing } = await (supabase.from("photo_albums" as any)
    .select("id")
    .eq("user_id", userId)
    .eq("album_type", albumType)
    .maybeSingle() as any);

  if (existing?.id) return existing.id;

  const name = albumType === "profile_pictures" ? "Profile Pictures" : "Cover Photos";
  const { data: created, error } = await (supabase.from("photo_albums" as any)
    .insert({ user_id: userId, name, album_type: albumType })
    .select("id")
    .single() as any);

  if (error) throw error;
  return created.id;
}

/** Add a photo to an album */
export async function addPhotoToAlbum(
  albumId: string,
  imageUrl: string,
  postId?: string,
  caption?: string
) {
  // Ensure fresh auth session before RLS-gated insert
  await supabase.auth.getSession();
  
  const { error } = await (supabase.from("album_photos" as any).insert({
    album_id: albumId,
    image_url: imageUrl,
    post_id: postId || null,
    caption: caption || null,
  }) as any);
  if (error) throw error;
}

/** Create a custom album */
export function useCreateAlbum() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await (supabase.from("photo_albums" as any)
        .insert({ user_id: user.id, name, album_type: "custom" })
        .select()
        .single() as any);
      if (error) throw error;
      return data as PhotoAlbum;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photo-albums", user?.id] });
      toast({ title: "Album created!" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create album", description: err.message, variant: "destructive" });
    },
  });
}

/** Delete a custom album */
export function useDeleteAlbum() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (albumId: string) => {
      const { error } = await (supabase.from("photo_albums" as any)
        .delete()
        .eq("id", albumId) as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photo-albums", user?.id] });
      toast({ title: "Album deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete album", description: err.message, variant: "destructive" });
    },
  });
}
