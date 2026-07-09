import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { useUserAlbums, useAlbumPhotos, useCreateAlbum, useDeleteAlbum, type PhotoAlbum } from "@/hooks/profile/useAlbums";
import { Camera, Plus, Trash2, ChevronLeft, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

interface PhotoAlbumsProps {
  userId: string;
  isOwner: boolean;
}

/** Album grid view — shows photos inside an album */
const AlbumView = ({ album, onBack }: { album: PhotoAlbum; onBack: () => void }) => {
  const { data: photos = [], isLoading } = useAlbumPhotos(album.id);

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-[10px] text-primary hover:underline mb-2" style={headingFont}>
        <ChevronLeft className="h-3 w-3" /> All Albums
      </button>
      <h4 className="text-[11px] font-semibold mb-2" style={headingFont}>{album.name}</h4>
      {isLoading ? (
        <p className="text-[10px] text-muted-foreground" style={bodyFont}>Loading...</p>
      ) : photos.length === 0 ? (
        <p className="text-[10px] text-muted-foreground" style={bodyFont}>No photos yet</p>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {photos.map((photo) => (
            <Link
              key={photo.id}
              to={photo.post_id ? `/post/${photo.post_id}` : "#"}
              className="aspect-square rounded-sm overflow-hidden hover:opacity-80 transition-opacity"
            >
              <img
                src={photo.image_url}
                alt={photo.caption || "Album photo"}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

const PhotoAlbums = ({ userId, isOwner }: PhotoAlbumsProps) => {
  const { data: albums = [], isLoading } = useUserAlbums(userId);
  const createAlbum = useCreateAlbum();
  const deleteAlbum = useDeleteAlbum();
  const [selectedAlbum, setSelectedAlbum] = useState<PhotoAlbum | null>(null);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  if (isLoading) return null;

  // Don't show section if no albums and not owner
  if (albums.length === 0 && !isOwner) return null;

  const handleCreate = () => {
    if (!newAlbumName.trim()) return;
    createAlbum.mutate({ name: newAlbumName.trim() }, {
      onSuccess: () => { setNewAlbumName(""); setShowCreate(false); },
    });
  };

  return (
    <div className="border border-border bg-card/50 rounded-sm">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5" style={headingFont}>
          <Images className="h-3 w-3" />
          Photo Albums
        </span>
        {isOwner && (
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <button className="text-primary hover:text-primary/80">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-xs">
              <DialogHeader>
                <DialogTitle className="text-sm" style={headingFont}>Create Album</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  placeholder="Album name"
                  value={newAlbumName}
                  onChange={(e) => setNewAlbumName(e.target.value)}
                  className="text-xs"
                  maxLength={50}
                />
                <Button size="sm" onClick={handleCreate} disabled={createAlbum.isPending || !newAlbumName.trim()} className="w-full text-xs">
                  {createAlbum.isPending ? "Creating..." : "Create Album"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="p-4">
        {selectedAlbum ? (
          <AlbumView album={selectedAlbum} onBack={() => setSelectedAlbum(null)} />
        ) : (
          <>
            {albums.length === 0 ? (
              <p className="text-[10px] text-muted-foreground text-center" style={bodyFont}>
                No albums yet. {isOwner && "Change your profile picture to get started!"}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {albums.map((album) => (
                  <div key={album.id} className="relative group">
                    <button
                      onClick={() => setSelectedAlbum(album)}
                      className="w-full aspect-square rounded-sm overflow-hidden border border-border hover:border-primary/50 transition-colors bg-muted"
                    >
                      {album.cover_url ? (
                        <img src={album.cover_url} alt={album.name} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Camera className="h-5 w-5 text-muted-foreground/50" />
                        </div>
                      )}
                    </button>
                    <p className="text-[9px] font-medium mt-1 truncate" style={headingFont}>{album.name}</p>
                    {isOwner && album.album_type === "custom" && (
                      <button
                        onClick={() => deleteAlbum.mutate(album.id)}
                        className="absolute top-1 right-1 bg-destructive/80 text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PhotoAlbums;
