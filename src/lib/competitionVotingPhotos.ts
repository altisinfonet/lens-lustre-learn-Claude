export interface CompetitionVotingPhoto {
  entryId: string;
  entryTitle: string;
  photographerName: string;
  /**
   * F-98c source FOUR — the photographer's handle, travelling WITH the name.
   *
   * dashboard-init emitted photographer_name as a bare string with no address
   * beside it, so "by Somnath Pal" under a voting photo was structurally
   * incapable of being a link however careful this file or the lightbox was.
   * The edge function now carries photographer_handle; this is where it lands.
   *
   * null means the member has no handle. It is never an id: an id URL is the
   * one address F-95 forbids.
   */
  photographerHandle: string | null;
  competitionTitle?: string | null;
  /** Full-resolution photo URL — used by lightbox, voting modal, and download. NEVER swap for thumbnail. */
  photoUrl: string;
  /** Phase 2: low-bandwidth thumbnail URL for grid display. Falls back to photoUrl when missing. */
  thumbnailUrl: string;
  photoIndex: number;
  totalPhotos: number;
  voteCount: number;
  userVoted: boolean;
  userId: string;
  createdAt?: string | null;
}

interface SidebarVotingPhotoMapOptions {
  sort?: boolean;
}

const normalizePhotoIndex = (value: unknown) => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
};

const compareVotingPhotos = (a: CompetitionVotingPhoto, b: CompetitionVotingPhoto) => {
  if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;

  const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (bTime !== aTime) return bTime - aTime;

  if (a.entryId !== b.entryId) return a.entryId.localeCompare(b.entryId);
  return a.photoIndex - b.photoIndex;
};

const compactCompetitionVotingPhotos = (
  photos: Array<CompetitionVotingPhoto | null>,
  { sort = true }: SidebarVotingPhotoMapOptions = {},
) => {
  const filtered = photos.filter((photo): photo is CompetitionVotingPhoto => {
    return photo !== null && Boolean(photo.entryId) && Boolean(photo.photoUrl);
  });

  return sort ? filtered.sort(compareVotingPhotos) : filtered;
};

export const clampCompetitionPhotoIndex = (value: unknown, totalPhotos: number) => {
  const safeTotal = Math.max(1, totalPhotos);
  return Math.min(normalizePhotoIndex(value), safeTotal - 1);
};

export const buildCompetitionPhotoPath = (entryId: string, photoIndex: number) => {
  return `/entry/${entryId}?photo=${normalizePhotoIndex(photoIndex)}`;
};

export const buildCompetitionPhotoUrl = (origin: string, entryId: string, photoIndex: number) => {
  return `${origin}${buildCompetitionPhotoPath(entryId, photoIndex)}`;
};

export const buildCompetitionVotingPhotoKey = (entryId: string, photoIndex: number) => {
  return `${entryId}::${normalizePhotoIndex(photoIndex)}`;
};

export function mapCompetitionEntriesToVotingPhotos(entries: any[]): CompetitionVotingPhoto[] {
  return compactCompetitionVotingPhotos(entries
    .flatMap((entry: any) => {
      const photos = Array.isArray(entry?.photos) ? entry.photos : [];
      const thumbs = Array.isArray(entry?.photo_thumbnails) ? entry.photo_thumbnails : [];
      const meta = Array.isArray(entry?.photo_meta) ? entry.photo_meta : [];
      const photoVoteMap = entry?._photoVoteMap || {};
      const userVotedPhotos: number[] = Array.isArray(entry?._userVotedPhotos) ? entry._userVotedPhotos : [];

      return photos.map((photoUrl: string, photoIndex: number) => {
        // Per-photo "One Image, One Reject" — skip rejected photos site-wide.
        /*
         * Narrowed rather than cast. Adding photographerHandle to the interface
         * above shifted every line in this function, which moved three
         * BASELINED `as any` sites onto new line numbers and made the audit
         * rule report them as NEW. Re-baselining them would have been making a
         * red go away by editing the record of it — Standing Rule 19 — so the
         * casts are gone instead. Same values, same fallbacks, no behaviour
         * change; `meta` is still `any[]` from the caller and only this read of
         * it is described.
         */
        const metaItem = meta[photoIndex] as { rejected?: boolean; title?: unknown } | undefined;
        if (metaItem && metaItem.rejected === true) return null;
        // Phase 2: prefer thumbnail for grid; fall back to full-res when null/missing/empty.
        const rawThumb = thumbs[photoIndex];
        const thumbnailUrl = typeof rawThumb === "string" && rawThumb.length > 0 ? rawThumb : photoUrl;
        // FIX #3 (per-photo titles): every photo carries its OWN title from
        // photo_meta[i].title. Falls back to entry-level title (which is
        // photos[0].title at submission time) only when meta is missing.
        const metaTitle = typeof metaItem?.title === "string" ? metaItem.title : "";
        const perPhotoTitle =
          metaTitle.trim().length > 0 ? metaTitle : (entry.title || "Untitled");
        return {
          entryId: entry.id,
          entryTitle: perPhotoTitle,
          photographerName: entry.profiles?.full_name || "Anonymous",
          photographerHandle: entry.profiles?.custom_url || null,
          competitionTitle: null,
          photoUrl,
          thumbnailUrl,
          photoIndex,
          totalPhotos: photos.length,
          voteCount: Number(photoVoteMap[String(photoIndex)] || 0),
          userVoted: userVotedPhotos.includes(photoIndex),
          userId: entry.user_id || "",
          createdAt: entry.created_at || null,
        };
      });
    }));
}

export function mapSidebarVotingEntriesToVotingPhotos(
  items: any[],
  options: SidebarVotingPhotoMapOptions = {},
): CompetitionVotingPhoto[] {
  return compactCompetitionVotingPhotos(items
    .map((item: any) => {
      const entryId = String(item?.entry_id ?? item?.id ?? "");
      const photoUrl = String(item?.photo_url ?? "");

      if (!entryId || !photoUrl) return null;

      const totalPhotos = Math.max(1, Number(item?.total_photos ?? 1));
      const photoIndex = clampCompetitionPhotoIndex(item?.photo_index, totalPhotos);

      // Sidebar mapper has no thumbnail source — fall back to full-res for thumbnailUrl.
      const rawThumb = item?.thumbnail_url;
      const thumbnailUrl = typeof rawThumb === "string" && rawThumb.length > 0 ? rawThumb : photoUrl;
      return {
        entryId,
        entryTitle: String(item?.entry_title ?? item?.title ?? "Untitled"),
        photographerName: String(item?.photographer_name ?? "Anonymous"),
        photographerHandle: item?.photographer_handle ? String(item.photographer_handle) : null,
        competitionTitle: item?.competition_title ? String(item.competition_title) : null,
        photoUrl,
        thumbnailUrl,
        photoIndex,
        totalPhotos,
        voteCount: Number(item?.vote_count ?? 0),
        userVoted: item?.user_voted === true,
        userId: String(item?.user_id ?? ""),
        createdAt: item?.created_at ? String(item.created_at) : null,
      } satisfies CompetitionVotingPhoto;
    }), options);
}

export function mergeCompetitionVotingPhotoPools(
  primary: CompetitionVotingPhoto[],
  secondary: CompetitionVotingPhoto[],
) {
  const seen = new Set<string>();

  return [...primary, ...secondary].filter((photo) => {
    const key = buildCompetitionVotingPhotoKey(photo.entryId, photo.photoIndex);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}