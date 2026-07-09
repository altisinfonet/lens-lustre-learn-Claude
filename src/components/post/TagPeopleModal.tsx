import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { X, Search, MapPin } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/**
 * Pending tag draft (before post is published).
 * Coordinates are percentages (0-100) of the rendered photo.
 */
export interface PendingTag {
  taggedUserId: string;
  taggedUserName: string;
  taggedUserAvatar: string | null;
  photoIndex: number;
  xPosition: number; // 0-100 (%)
  yPosition: number; // 0-100 (%)
}

interface TagPeopleModalProps {
  open: boolean;
  onClose: () => void;
  imagePreviews: string[];
  initialTags?: PendingTag[];
  onConfirm: (tags: PendingTag[]) => void;
}

interface FriendOption {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

const MAX_TAGS = 20;

/**
 * Instagram-style after-upload tagging modal.
 * - Tap photo to drop a pin
 * - Search friends to assign to that pin
 * - Tags are stored as drafts; persisted by parent on post insert
 */
export default function TagPeopleModal({
  open,
  onClose,
  imagePreviews,
  initialTags = [],
  onConfirm,
}: TagPeopleModalProps) {
  const { user } = useAuth();
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [tags, setTags] = useState<PendingTag[]>(initialTags);
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const photoRef = useRef<HTMLDivElement>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setTags(initialTags);
      setActivePhotoIndex(0);
      setPendingPin(null);
      setSearchOpen(false);
      setSearchTerm("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load accepted friends once when search panel opens
  useEffect(() => {
    if (!searchOpen || !user || friends.length > 0) return;
    let active = true;
    setLoadingFriends(true);
    (async () => {
      const { data, error } = await supabase
        .from("friendships")
        .select("requester_id, addressee_id, status")
        .eq("status", "accepted")
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

      if (!active) return;
      if (error) {
        toast({ title: "Couldn't load friends", description: error.message, variant: "destructive" });
        setLoadingFriends(false);
        return;
      }

      const friendIds = (data || [])
        .map((f) => (f.requester_id === user.id ? f.addressee_id : f.requester_id))
        .filter(Boolean);

      if (friendIds.length === 0) {
        setFriends([]);
        setLoadingFriends(false);
        return;
      }

      const { data: profiles } = await supabase
        .from("profiles_public_data")
        .select("id, full_name, avatar_url")
        .in("id", friendIds);

      if (!active) return;
      setFriends((profiles || []) as FriendOption[]);
      setLoadingFriends(false);
    })();
    return () => {
      active = false;
    };
  }, [searchOpen, user, friends.length]);

  const filteredFriends = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const tagsOnThisPhoto = tags.filter((t) => t.photoIndex === activePhotoIndex);
    const usedIds = new Set(tagsOnThisPhoto.map((t) => t.taggedUserId));
    return friends
      .filter((f) => !usedIds.has(f.id))
      .filter((f) => !q || (f.full_name || "").toLowerCase().includes(q))
      .slice(0, 50);
  }, [friends, searchTerm, tags, activePhotoIndex]);

  const tagsForCurrentPhoto = useMemo(
    () => tags.filter((t) => t.photoIndex === activePhotoIndex),
    [tags, activePhotoIndex]
  );

  const handlePhotoClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!photoRef.current) return;
      if (tags.length >= MAX_TAGS) {
        toast({ title: `Maximum ${MAX_TAGS} tags per post`, variant: "destructive" });
        return;
      }
      const rect = photoRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      const xClamped = Math.max(0, Math.min(100, x));
      const yClamped = Math.max(0, Math.min(100, y));
      setPendingPin({ x: xClamped, y: yClamped });
      setSearchOpen(true);
      setSearchTerm("");
    },
    [tags.length]
  );

  const handleSelectFriend = useCallback(
    (friend: FriendOption) => {
      if (!pendingPin) return;
      setTags((prev) => [
        ...prev,
        {
          taggedUserId: friend.id,
          taggedUserName: friend.full_name || "Unknown",
          taggedUserAvatar: friend.avatar_url,
          photoIndex: activePhotoIndex,
          xPosition: pendingPin.x,
          yPosition: pendingPin.y,
        },
      ]);
      setPendingPin(null);
      setSearchOpen(false);
      setSearchTerm("");
    },
    [pendingPin, activePhotoIndex]
  );

  const handleRemoveTag = useCallback((taggedUserId: string, photoIndex: number) => {
    setTags((prev) => prev.filter((t) => !(t.taggedUserId === taggedUserId && t.photoIndex === photoIndex)));
  }, []);

  const handleCancelPin = useCallback(() => {
    setPendingPin(null);
    setSearchOpen(false);
  }, []);

  const handleDone = useCallback(() => {
    onConfirm(tags);
    onClose();
  }, [tags, onConfirm, onClose]);

  if (!imagePreviews.length) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden bg-background">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-display)" }}>
            Tag People
          </h2>
          <button
            onClick={handleDone}
            className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            Done
          </button>
        </div>

        {/* Photo + pin overlay */}
        <div className="relative bg-black">
          <div
            ref={photoRef}
            onClick={handlePhotoClick}
            className="relative w-full aspect-square cursor-crosshair select-none"
          >
            <img
              src={imagePreviews[activePhotoIndex]}
              alt=""
              className="w-full h-full object-contain"
              draggable={false}
            />

            {/* Existing tag pins for this photo */}
            <AnimatePresence>
              {tagsForCurrentPhoto.map((t) => (
                <motion.div
                  key={`${t.taggedUserId}-${t.photoIndex}`}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  className="absolute pointer-events-auto"
                  style={{ left: `${t.xPosition}%`, top: `${t.yPosition}%`, transform: "translate(-50%, -100%)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1.5 bg-background/95 backdrop-blur px-2.5 py-1 rounded-full shadow-lg border border-border">
                    <MapPin className="h-3 w-3 text-primary" />
                    <span className="text-xs font-medium max-w-[120px] truncate">{t.taggedUserName}</span>
                    <button
                      onClick={() => handleRemoveTag(t.taggedUserId, t.photoIndex)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      aria-label="Remove tag"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Pending pin (awaiting friend selection) */}
            {pendingPin && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute pointer-events-none"
                style={{ left: `${pendingPin.x}%`, top: `${pendingPin.y}%`, transform: "translate(-50%, -50%)" }}
              >
                <div className="w-4 h-4 bg-primary rounded-full ring-2 ring-background shadow-lg animate-pulse" />
              </motion.div>
            )}
          </div>

          {/* Photo navigation dots (multi-image posts) */}
          {imagePreviews.length > 1 && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
              {imagePreviews.map((_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setActivePhotoIndex(i);
                    setPendingPin(null);
                    setSearchOpen(false);
                  }}
                  className={`h-1.5 rounded-full transition-all ${
                    i === activePhotoIndex ? "w-6 bg-primary" : "w-1.5 bg-white/50"
                  }`}
                  aria-label={`Photo ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Hint / status bar */}
        <div className="px-4 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground flex items-center justify-between">
          <span>
            Tap photo to tag a friend · {tagsForCurrentPhoto.length} on this photo · {tags.length}/{MAX_TAGS} total
          </span>
        </div>

        {/* Friend search panel (slides up when pin placed) */}
        <AnimatePresence>
          {searchOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-border overflow-hidden"
            >
              <div className="p-3">
                <div className="flex items-center gap-2 mb-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      autoFocus
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search friends..."
                      className="w-full pl-8 pr-3 py-2 text-sm bg-muted rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <button
                    onClick={handleCancelPin}
                    className="text-xs text-muted-foreground hover:text-foreground px-2"
                  >
                    Cancel
                  </button>
                </div>

                <div className="max-h-56 overflow-y-auto -mx-1">
                  {loadingFriends ? (
                    <p className="text-xs text-muted-foreground px-3 py-4 text-center">Loading friends…</p>
                  ) : filteredFriends.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-3 py-4 text-center">
                      {friends.length === 0
                        ? "You can only tag accepted friends. Add some friends first."
                        : "No matching friends."}
                    </p>
                  ) : (
                    filteredFriends.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => handleSelectFriend(f)}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted rounded-md transition-colors text-left"
                      >
                        {f.avatar_url ? (
                          <img
                            src={f.avatar_url}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs text-primary">
                            {(f.full_name || "?")[0]?.toUpperCase()}
                          </div>
                        )}
                        <span className="text-sm">{f.full_name || "Unknown"}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
