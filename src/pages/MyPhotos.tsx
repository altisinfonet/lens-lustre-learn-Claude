import { useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { useUserAlbums, useAlbumPhotos, useCreateAlbum, useDeleteAlbum, addPhotoToAlbum, type PhotoAlbum } from "@/hooks/profile/useAlbums";
import { Camera, Plus, Trash2, ChevronLeft, Images, FolderPlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import PageSEO from "@/components/PageSEO";
import { toast } from "@/hooks/core/use-toast";
import { uploadImageWithThumbnail } from "@/lib/imageUpload";
import Lightbox from "@/components/Lightbox";
import ImageEngagement from "@/components/ImageEngagement";
import InfiniteScrollSentinel from "@/components/InfiniteScrollSentinel";

const PAGE_SIZE = 20;

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

type TabKey = "uploads" | "tagged" | "albums";

/* ─── Shared 1:1 Square Photo Card ─── */
const SquarePhotoCard = ({ imageUrl, postId, index, overlay, onClick }: {
  imageUrl: string; postId?: string; index: number; overlay?: React.ReactNode; onClick?: () => void;
}) => {
  const inner = (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: Math.min(index * 0.03, 0.5) }}
      className="relative aspect-square rounded-md overflow-hidden bg-muted group cursor-pointer"
    >
      <img
        src={imageUrl}
        alt="Photo"
        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        loading="lazy"
      />
      {overlay && (
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
          {overlay}
        </div>
      )}
    </motion.div>
  );

  if (onClick) {
    return <div onClick={onClick}>{inner}</div>;
  }
  if (postId) {
    return <Link to={`/post/${postId}`}>{inner}</Link>;
  }
  return inner;
};

/* ─── My Uploads Grid ─── */
const MyUploadsGrid = ({ userId }: { userId: string }) => {
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["my-photos-uploads", userId],
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0 }) => {
      const from = (pageParam as number) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from("posts")
        .select("id, image_url, content, created_at")
        .eq("user_id", userId)
        .not("image_url", "is", null)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return (data || []).filter((p: any) => p.image_url);
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length : undefined,
    enabled: !!userId,
  });

  const posts = data?.pages.flat() ?? [];

  if (isLoading) return <GridSkeleton />;
  if (posts.length === 0) return <EmptyState text="No photos uploaded yet" />;

  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1">
        {posts.map((post: any, i: number) => (
          <SquarePhotoCard key={post.id} imageUrl={post.image_url} postId={post.id} index={i} />
        ))}
      </div>
      <InfiniteScrollSentinel
        onLoadMore={fetchNextPage}
        hasNextPage={!!hasNextPage}
        isFetching={isFetchingNextPage}
        rootMargin="300px"
        showEndMarker={posts.length >= PAGE_SIZE}
        endLabel="No more photos"
      />
    </>
  );
};

/* ─── Tagged In Grid ─── */
const TaggedInGrid = ({ userId }: { userId: string }) => {
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["my-photos-tagged", userId],
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0 }) => {
      const from = (pageParam as number) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      // Page through post_tags (newest first by created_at)
      const { data: tags, error } = await (supabase
        .from("post_tags" as any)
        .select("post_id, created_at")
        .eq("tagged_user_id", userId)
        .order("created_at", { ascending: false })
        .range(from, to) as any);
      if (error || !tags?.length) return [];
      const postIds = tags.map((t: any) => t.post_id);
      const { data: posts } = await supabase
        .from("posts")
        .select("id, image_url, user_id, created_at")
        .in("id", postIds)
        .not("image_url", "is", null);
      // Preserve tag order (newest tag first)
      const postMap = new Map((posts || []).map((p: any) => [p.id, p]));
      return postIds
        .map((id: string) => postMap.get(id))
        .filter((p: any) => p && p.image_url);
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length : undefined,
    enabled: !!userId,
  });

  const photos = data?.pages.flat() ?? [];

  if (isLoading) return <GridSkeleton />;
  if (photos.length === 0) return <EmptyState text="No tagged photos yet" />;

  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1">
        {photos.map((p: any, i: number) => (
          <SquarePhotoCard key={p.id} imageUrl={p.image_url} postId={p.id} index={i} />
        ))}
      </div>
      <InfiniteScrollSentinel
        onLoadMore={fetchNextPage}
        hasNextPage={!!hasNextPage}
        isFetching={isFetchingNextPage}
        rootMargin="300px"
        showEndMarker={photos.length >= PAGE_SIZE}
        endLabel="No more tagged photos"
      />
    </>
  );
};

/* ─── Albums Tab ─── */
const AlbumsGrid = ({ userId, isOwner }: { userId: string; isOwner: boolean }) => {
  const { data: albums = [], isLoading } = useUserAlbums(userId);
  const createAlbum = useCreateAlbum();
  const deleteAlbum = useDeleteAlbum();
  const [selectedAlbum, setSelectedAlbum] = useState<PhotoAlbum | null>(null);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  if (isLoading) return <GridSkeleton />;

  if (selectedAlbum) {
    return <AlbumDetailView album={selectedAlbum} onBack={() => setSelectedAlbum(null)} isOwner={isOwner} />;
  }

  const handleCreate = () => {
    if (!newAlbumName.trim()) return;
    createAlbum.mutate({ name: newAlbumName.trim() }, {
      onSuccess: () => { setNewAlbumName(""); setShowCreate(false); },
    });
  };

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1">
        {isOwner && (
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="aspect-square rounded-md border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center gap-1.5 transition-colors bg-card/30"
              >
                <FolderPlus className="h-6 w-6 text-muted-foreground/60" />
                <span className="text-[9px] text-muted-foreground" style={headingFont}>Create</span>
              </motion.button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="text-sm" style={headingFont}>Create New Album</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  placeholder="Album name"
                  value={newAlbumName}
                  onChange={(e) => setNewAlbumName(e.target.value)}
                  className="text-sm"
                  maxLength={50}
                />
                <Button size="sm" onClick={handleCreate} disabled={createAlbum.isPending || !newAlbumName.trim()} className="w-full text-xs">
                  {createAlbum.isPending ? "Creating..." : "Create Album"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {albums.map((album, i) => (
          <AlbumCard
            key={album.id}
            album={album}
            index={i}
            isOwner={isOwner}
            onClick={() => setSelectedAlbum(album)}
            onDelete={() => deleteAlbum.mutate(album.id)}
          />
        ))}
      </div>

      {albums.length === 0 && !isOwner && <EmptyState text="No albums yet" />}
    </div>
  );
};

/* ─── Album Card ─── */
const AlbumCard = ({ album, index, isOwner, onClick, onDelete }: {
  album: PhotoAlbum; index: number; isOwner: boolean; onClick: () => void; onDelete: () => void;
}) => {
  const { data: photos = [] } = useAlbumPhotos(album.id);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="group relative"
    >
      <button onClick={onClick} className="w-full text-left">
        <div className="aspect-square rounded-md overflow-hidden relative bg-muted">
          {album.cover_url ? (
            <img src={album.cover_url} alt={album.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
          ) : photos.length > 0 ? (
            <img src={photos[0].image_url} alt={album.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-secondary/30">
              <Camera className="h-8 w-8 text-muted-foreground/30" />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
            <p className="text-[10px] font-semibold text-white truncate" style={headingFont}>{album.name}</p>
            <p className="text-[9px] text-white/70" style={bodyFont}>{photos.length} items</p>
          </div>
          {isOwner && album.album_type === "custom" && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="absolute top-1.5 right-1.5 bg-destructive/80 text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </button>
    </motion.div>
  );
};

/* ─── Album Detail View with Add Photos ─── */
const AlbumDetailView = ({ album, onBack, isOwner }: { album: PhotoAlbum; onBack: () => void; isOwner: boolean }) => {
  const { data: photos = [], isLoading } = useAlbumPhotos(album.id);
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const lightboxImages = photos.map((p) => ({
    id: p.post_id || p.id,
    src: p.image_url,
    title: p.caption || album.name,
    category: album.name,
  }));

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  }, []);

  const handleAddPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      toast({ title: "Please sign in to upload photos", variant: "destructive" });
      return;
    }
    const fileList = Array.from(files);
    setUploading(true);
    setUploadProgress({ current: 0, total: fileList.length });
    let successCount = 0;
    const uploadedUrls: string[] = [];
    const uploadedThumbs: string[] = [];
    try {
      for (let i = 0; i < fileList.length; i++) {
        setUploadProgress({ current: i, total: fileList.length });
        const result = await uploadImageWithThumbnail({
          bucket: "avatars",
          file: fileList[i],
          type: "my-photo",
          userId,
          subPath: album.id,
        });
        uploadedUrls.push(result.url);
        uploadedThumbs.push(result.thumbnailUrl);
        successCount++;
      }
      setUploadProgress({ current: fileList.length, total: fileList.length });

      // Create a wall post with all uploaded images
      if (uploadedUrls.length > 0) {
        const postContent = `added ${uploadedUrls.length} photo${uploadedUrls.length > 1 ? "s" : ""} to the album "${album.name}".`;
        const { data: post } = await supabase.from("posts").insert({
          user_id: userId,
          content: postContent,
          image_url: uploadedUrls[0],
          image_urls: uploadedUrls,
          thumbnail_urls: uploadedThumbs,
          privacy: "public",
        } as any).select("id").single();

        // Add each photo to the album, linking to the post
        for (let i = 0; i < uploadedUrls.length; i++) {
          await addPhotoToAlbum(album.id, uploadedUrls[i], post?.id);
        }

        // Invalidate feed so the post appears
        qc.invalidateQueries({ queryKey: ["feed"] });
      }

      qc.invalidateQueries({ queryKey: ["album-photos", album.id] });
      toast({ title: `${successCount} photo(s) added!` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setTimeout(() => {
        setUploading(false);
        setUploadProgress({ current: 0, total: 0 });
      }, 600);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-primary hover:underline" style={headingFont}>
          <ChevronLeft className="h-4 w-4" /> Albums
        </button>
        {isOwner && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleAddPhotos}
            />
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1.5"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Uploading..." : "Add Photos"}
            </Button>
          </>
      )}
      </div>

      {/* Animated Upload Progress Bar */}
      {uploading && uploadProgress.total > 0 && (
        <div className="mb-4 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground" style={headingFont}>
            <span>Compressing & uploading…</span>
            <span>{Math.min(uploadProgress.current + 1, uploadProgress.total)} / {uploadProgress.total}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={{ width: "0%" }}
              animate={{ width: `${((uploadProgress.current + 0.5) / uploadProgress.total) * 100}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        </div>
      )}
      <h3 className="text-base font-bold mb-3" style={headingFont}>{album.name}</h3>
      {isLoading ? <GridSkeleton /> : photos.length === 0 ? (
        <EmptyState text="No photos in this album" />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1">
          {photos.map((photo, i) => (
            <SquarePhotoCard
              key={photo.id}
              imageUrl={photo.image_url}
              postId={photo.post_id || undefined}
              index={i}
              onClick={() => openLightbox(i)}
            />
          ))}
        </div>
      )}

      {/* Lightbox for full view with engagement */}
      <Lightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        onPrev={() => setLightboxIndex((prev) => (prev - 1 + lightboxImages.length) % lightboxImages.length)}
        onNext={() => setLightboxIndex((prev) => (prev + 1) % lightboxImages.length)}
        imageType="portfolio"
      />
    </div>
  );
};

/* ─── Skeleton ─── */
const GridSkeleton = () => (
  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1">
    {Array.from({ length: 15 }).map((_, i) => (
      <div key={i} className="aspect-square rounded-md bg-muted animate-pulse" />
    ))}
  </div>
);

/* ─── Empty State ─── */
const EmptyState = ({ text }: { text: string }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <Images className="h-12 w-12 text-muted-foreground/30 mb-3" />
    <p className="text-sm text-muted-foreground" style={bodyFont}>{text}</p>
  </div>
);

/* ─── Main Page ─── */
const MyPhotos = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>("uploads");

  if (!user) return null;

  const tabs: { key: TabKey; label: string }[] = [
    { key: "uploads", label: "Your Photos" },
    { key: "tagged", label: "Photos of You" },
    { key: "albums", label: "Albums" },
  ];

  return (
    <>
      <PageSEO title="My Photos" description="Browse and manage your photo collection" />
      <div className="max-w-5xl mx-auto py-6 px-0 sm:px-4">
        <div className="px-4 sm:px-0 mb-4">
          <h1 className="text-xl font-bold" style={headingFont}>Photos</h1>
          <div className="flex gap-6 mt-3 border-b border-border">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative pb-2.5 text-sm transition-colors ${
                  activeTab === tab.key
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                style={headingFont}
              >
                {tab.label}
                {activeTab === tab.key && (
                  <motion.div
                    layoutId="photos-tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-full"
                  />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="px-1 sm:px-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              {activeTab === "uploads" && <MyUploadsGrid userId={user.id} />}
              {activeTab === "tagged" && <TaggedInGrid userId={user.id} />}
              {activeTab === "albums" && <AlbumsGrid userId={user.id} isOwner={true} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </>
  );
};

export default MyPhotos;
