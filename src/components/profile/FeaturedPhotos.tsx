import { useEffect, useState } from "react";
import { Plus, X, Star, Expand } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { uploadImageWithThumbnail } from "@/lib/imageUpload";
import { AnimatePresence, motion } from "framer-motion";

const headingFont = { fontFamily: "var(--font-heading)" };

interface FeaturedPhoto {
  id: string;
  image_url: string;
  thumbnail_url: string | null;
  title: string | null;
  sort_order: number;
}

interface Props {
  userId: string;
  isOwner: boolean;
}

const MAX_FEATURED = 6;

const FeaturedPhotos = ({ userId, isOwner }: Props) => {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<FeaturedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const fetchPhotos = async () => {
    const { data } = await supabase
      .from("featured_photos" as any)
      .select("id, image_url, thumbnail_url, title, sort_order")
      .eq("user_id", userId)
      .order("sort_order");
    setPhotos((data as any[]) || []);
  };

  useEffect(() => { fetchPhotos(); }, [userId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !user) return;
    if (photos.length >= MAX_FEATURED) {
      toast({ title: `Maximum ${MAX_FEATURED} featured photos`, variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const file = e.target.files[0];
      const result = await uploadImageWithThumbnail({
        bucket: "portfolio-images",
        file,
        type: "featured",
        userId: user.id,
      });
      await supabase.from("featured_photos" as any).insert({
        user_id: user.id,
        image_url: result.url,
        thumbnail_url: result.thumbnailUrl,
        sort_order: photos.length,
      } as any);
      await fetchPhotos();
      toast({ title: "Featured photo added!" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    setUploading(false);
  };

  const handleRemove = async (id: string) => {
    await supabase.from("featured_photos" as any).delete().eq("id", id);
    await fetchPhotos();
    toast({ title: "Photo removed" });
  };

  if (photos.length === 0 && !isOwner) return null;

  return (
    <>
      <div className="border border-border p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
            <Star className="h-3.5 w-3.5 text-primary" />
            Featured Photos
          </h3>
          {isOwner && photos.length < MAX_FEATURED && (
            <label className="text-[10px] tracking-[0.1em] uppercase text-primary hover:underline cursor-pointer flex items-center gap-1" style={headingFont}>
              <Plus className="h-3 w-3" /> Add
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
          )}
        </div>

        {photos.length === 0 && isOwner && (
          <div className="border border-dashed border-border p-6 text-center">
            <Star className="h-6 w-6 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-[10px] text-muted-foreground" style={headingFont}>
              Pin your best photos here
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-1.5">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group aspect-square overflow-hidden cursor-pointer" onClick={() => setLightbox(photo.image_url)}>
              <img
                src={photo.thumbnail_url || photo.image_url}
                alt={photo.title || "Featured"}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                <Expand className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              {isOwner && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemove(photo.id); }}
                  className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/95 backdrop-blur-md flex items-center justify-center p-6 cursor-pointer"
            onClick={() => setLightbox(null)}
          >
            <img loading="lazy" decoding="async" src={lightbox} alt="Featured" className="max-w-4xl w-full max-h-[80vh] object-contain" />
            <button onClick={() => setLightbox(null)} className="absolute top-6 right-6 text-muted-foreground hover:text-foreground">
              <X className="h-6 w-6" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default FeaturedPhotos;
