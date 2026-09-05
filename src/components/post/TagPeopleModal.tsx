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

interface PersonOption {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

const MAX_TAGS = 20;

/**
 * Instagram-style after-upload tagging modal.
 * - Tap photo to drop a pin
 * - Search any member to assign to that pin (consent is the pending→approved step)
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
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(false);
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

  /**
   * ANYONE CAN TAG ANYONE — owner decision, 2026-08-10:
   * *"anyone tag anyone. not block it by ONLY friends"*.
   *
   * This used to read `friendships` (status = 'accepted') and look up only
   * those profiles, so the picker was empty for anybody without an accepted
   * friend — the owner's own account included. It now searches every member.
   *
   * CONSENT IS NOT LOST BY THIS. It moved, it did not disappear:
   *   * a new tag is created `status = 'pending'`;
   *   * the RLS policy "Anyone views approved tags" means a pending tag is
   *     visible ONLY to the tagger, the tagged member and the post owner;
   *   * only the tagged member can move it to 'approved' (validate_post_tag_update);
   *   * once they decline, the tagger can never re-tag them on that post;
   *   * no self-tagging, and 20 tags per post maximum.
   * So being tagged still requires the tagged person to say yes before anyone
   * else sees it. Removing the friend gate widens who may ASK, not who appears.
   *
   * The matching database change is
   * `supabase/migrations/20260810120001_tag_anyone_not_only_friends.sql` —
   * the `validate_post_tag_insert` trigger raised
   * *"You can only tag accepted friends"* and would have refused every tag
   * this picker now offers. Both halves are required; neither works alone.
   *
   * SEARCHED SERVER-SIDE, not filtered in the browser: the member list only
   * grows, and shipping all of it to every phone to filter locally is the kind
   * of thing that is fine at 90 members and painful at 9,000.
   */
  useEffect(() => {
    if (!searchOpen || !user) return;
    let active = true;
    const q = searchTerm.trim();
    // Debounced so a fast typist does not fire a request per keystroke.
    const timer = setTimeout(() => {
      setLoadingPeople(true);
      void (async () => {
        // Filters first, then modifiers — that is the order the generated
        // PostgREST types expect, and it keeps this free of `as any`.
        let filtered = supabase
          .from("profiles_public_data")
          .select("id, full_name, avatar_url, custom_url")
          .neq("id", user.id);
        if (q) filtered = filtered.ilike("full_name", `%${q}%`);

        const { data, error } = await filtered
          .order("full_name", { ascending: true })
          .limit(30);
        if (!active) return;
        if (error) {
          toast({ title: "Couldn't load people", description: error.message, variant: "destructive" });
          setLoadingPeople(false);
          return;
        }
        setPeople((data || []) as PersonOption[]);
        setLoadingPeople(false);
      })();
    }, q ? 200 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchOpen, user, searchTerm]);

  /** Only hide people already pinned on THIS photo; the name filter is server-side. */
  const visiblePeople = useMemo(() => {
    const usedIds = new Set(
      tags.filter((t) => t.photoIndex === activePhotoIndex).map((t) => t.taggedUserId),
    );
    return people.filter((p) => !usedIds.has(p.id));
  }, [people, tags, activePhotoIndex]);

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

  const handleSelectPerson = useCallback(
    (friend: PersonOption) => {
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
      {/**
       * THE MODAL MUST FIT ON THE SCREEN. Owner report, 2026-08-09:
       * *"Tag is not working on web and App on any post."*
       *
       * MEASURED on the live site, 2026-08-10, Chrome at a 710px viewport,
       * with a photo attached and the photo tapped:
       *
       *   viewport height   710
       *   dialog height    1020
       *   dialog top       -155   ← above the top of the screen
       *   dialog bottom     865   ← below the bottom of the screen
       *   "Search friends" input top   755   ← 45px BELOW the screen edge
       *   computed overflow-y   hidden
       *   computed max-height   none
       *
       * The friend picker opened correctly — it just opened where nobody can
       * see or reach it, and `overflow-hidden` meant it could not be scrolled
       * to. Tapping the photo therefore looked like it did nothing. Tagging
       * was not refused by anything; it was **impossible on any screen shorter
       * than the dialog**, which is every laptop and every phone.
       *
       * (This is why the Error Log holds ZERO `POST-2005` tag-insert failures
       * in 30 days. Nothing was ever refused, because nobody could ever get
       * far enough to save a tag.)
       *
       * THREE THINGS KEEP IT ON SCREEN, and all three are load-bearing:
       *   1. `max-h-[92vh]` — the base DialogContent ships `max-height: none`.
       *   2. `flex flex-col` + a `flex-1 min-h-0 overflow-y-auto` body — so
       *      anything that still does not fit can be scrolled to. `min-h-0`
       *      is required: a flex child defaults to min-height:auto and will
       *      refuse to shrink, which silently re-creates this bug.
       *   3. the photo box is capped (see below), so the picker is reachable
       *      without scrolling at all in the normal case.
       *
       * `vh` NOT `dvh`, deliberately. `dvh` needs Chromium 108+. The members
       * hitting this are on old Android System WebViews — the same phones that
       * lack `crypto.randomUUID` (Chromium 92). An unsupported unit is dropped
       * silently, `max-height` returns to `none`, and the bug comes back on
       * exactly the devices it hurts most.
       */}
      <DialogContent className="max-w-3xl p-0 overflow-hidden bg-background max-h-[92vh] flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
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

        {/**
         * The scrollable body. `min-h-0` is not decoration — without it this
         * flex child keeps its content height and pushes the picker back off
         * the screen, which is the whole bug.
         */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {/* Photo + pin overlay */}
        <div className="relative bg-black">
          {/**
           * STILL SQUARE — on purpose. A pin is stored as a percentage of THIS
           * box (see handlePhotoClick), so changing its shape would move every
           * pin relative to the photo. `max-w-[60vh]` bounds the square by
           * height without changing its aspect, which leaves the coordinate
           * system exactly as it was and still leaves room for the picker.
           */}
          <div
            ref={photoRef}
            onClick={handlePhotoClick}
            className="relative w-full max-w-[60vh] mx-auto aspect-square cursor-crosshair select-none"
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

            {/**
             * THE PICKER OPENS AT THE PIN — owner instruction, 2026-08-10:
             * *"dont open the search box below of it, open the search box small
             * (now tooo big) but exactly where pointer marked, same for App."*
             *
             * It used to be a full-width panel that slid up from the bottom of
             * the dialog. Two things were wrong with that: it was far from the
             * pin you had just placed, and it made the dialog tall enough to
             * run off the screen entirely (see the header of this file for the
             * measurements). Anchoring it to the pin fixes both at once — the
             * choice happens where you are looking, and the dialog stops
             * growing when you tap.
             *
             * STAYING INSIDE THE PHOTO, on a phone as well as a desktop:
             *   * `clamp(120px, x%, calc(100% - 120px))` keeps a 230px-wide
             *     popover fully inside the photo however close to an edge you
             *     tap. 120px is half its width plus a small gutter. `clamp()`
             *     is Chromium 79 — older than the WebViews these members run
             *     (see the `vh` note in the header; same reasoning).
             *   * Below 58% of the height it opens UPWARD, so a tag near the
             *     bottom of the photo does not push the list out of sight.
             *
             * `stopPropagation` is load-bearing: without it every tap inside
             * the popover reaches the photo's own click handler and moves the
             * pin out from under you.
             */}
            {pendingPin && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute z-30 w-[230px] rounded-lg border border-border bg-popover shadow-xl overflow-hidden"
                style={{
                  left: `clamp(120px, ${pendingPin.x}%, calc(100% - 120px))`,
                  top: `${pendingPin.y}%`,
                  transform:
                    pendingPin.y > 58
                      ? "translate(-50%, calc(-100% - 16px))"
                      : "translate(-50%, 16px)",
                }}
              >
                <div className="flex items-center gap-1 p-1.5 border-b border-border">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    <input
                      autoFocus
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search people…"
                      className="w-full pl-7 pr-2 py-1 text-xs bg-muted rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <button
                    onClick={handleCancelPin}
                    className="p-1 text-muted-foreground hover:text-foreground shrink-0"
                    aria-label="Cancel this tag"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="max-h-[168px] overflow-y-auto overscroll-contain">
                  {loadingPeople ? (
                    <p className="text-[11px] text-muted-foreground px-2 py-3 text-center">Searching…</p>
                  ) : visiblePeople.length === 0 ? (
                    <p className="text-[11px] leading-snug text-muted-foreground px-2 py-3 text-center">
                      {searchTerm.trim() ? "Nobody by that name." : "No members to tag yet."}
                    </p>
                  ) : (
                    visiblePeople.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => handleSelectPerson(f)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted transition-colors text-left"
                      >
                        {f.avatar_url ? (
                          <img
                            src={f.avatar_url}
                            alt=""
                            className="w-6 h-6 rounded-full object-cover shrink-0"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] text-primary shrink-0">
                            {(f.full_name || "?")[0]?.toUpperCase()}
                          </div>
                        )}
                        <span className="text-xs truncate">{f.full_name || "Unknown"}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
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
            Tap photo to tag a member · {tagsForCurrentPhoto.length} on this photo · {tags.length}/{MAX_TAGS} total
          </span>
        </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
