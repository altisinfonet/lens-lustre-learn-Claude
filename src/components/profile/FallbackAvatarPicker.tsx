/**
 * PICK YOUR STAND-IN PICTURE.
 *
 * OWNER REQUEST, 2026-08-05:
 *
 *   "Create AI DP small icons type 10 options 5 male 5 female (cartoon type).
 *    Once you can do, based on man and woman, if DP fails allow then to choose
 *    anyone **user can change too**. This DP update wont as updated profile
 *    picture on the feed and wall anyone, its just for fall back or as user is
 *    not giving DP, using that only."
 *
 * The automatic half shipped first: every member without an uploaded photo was
 * given a cartoon by `20260805070000_fallback_avatars.sql`. This is the other
 * half — "user can change too".
 *
 * ALL TEN ARE OFFERED, NOT FIVE
 *
 * The automatic assignment uses gender to pick a *fitting* default. The choice
 * does not: the owner said "allow then to choose **anyone**". A member who was
 * auto-assigned m2 and would rather have f4 can take f4. Filtering the list by
 * the stored gender would turn a helpful default into a rule he did not ask for
 * — and the stored gender is, for the 33 members who never answered, a guess.
 *
 * WHY THIS STILL DOES NOT COUNT AS A PROFILE PHOTO
 *
 * The value written is a SITE-RELATIVE path (`/avatars/fallback/m3.svg`).
 * `isOwnProfilePhoto()` and `public.has_profile_photo()` are both ALLOWLISTS of
 * our own upload storage, and a site-relative path matches neither. So:
 *
 *   * the "add a photo" prompt keeps asking on the next opening;
 *   * when the owner reinstates the photo rule at ~1000 members, picking a
 *     cartoon will not have bought anyone a way around it;
 *   * and this component keeps rendering, because the member still has no
 *     uploaded photo.
 *
 * That is exactly his "this DP update wont [count] as updated profile picture".
 *
 * NOT SHOWN AT ALL to a member who HAS uploaded a real photo — offering to
 * replace a real portrait with a cartoon would be a downgrade nobody asked for.
 */
import { useState } from "react";
import { Loader2, Check } from "lucide-react";
import { useUpdateAvatar } from "@/hooks/profile/useProfileMutations";
import { isOwnProfilePhoto } from "@/lib/profilePhoto";
import { toast } from "@/hooks/core/use-toast";

/** The ten files in public/avatars/fallback/. */
const FALLBACK_AVATARS = [
  "m1", "m2", "m3", "m4", "m5",
  "f1", "f2", "f3", "f4", "f5",
] as const;

const pathFor = (key: string) => `/avatars/fallback/${key}.svg`;

interface Props {
  /** The member's current avatar_url, as stored. */
  currentAvatarUrl: string | null;
  /** Called with the new site-relative path after a successful save. */
  onPicked?: (url: string) => void;
  className?: string;
}

const FallbackAvatarPicker = ({ currentAvatarUrl, onPicked, className = "" }: Props) => {
  const avatarMutation = useUpdateAvatar();
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // A real uploaded photo wins. Nothing to offer here.
  if (isOwnProfilePhoto(currentAvatarUrl)) return null;

  const currentKey =
    currentAvatarUrl && currentAvatarUrl.startsWith("/avatars/fallback/")
      ? currentAvatarUrl.replace("/avatars/fallback/", "").replace(".svg", "")
      : null;

  const choose = async (key: string) => {
    if (savingKey) return;
    const url = pathFor(key);
    if (url === currentAvatarUrl) return;
    setSavingKey(key);
    try {
      await avatarMutation.mutateAsync({ avatarUrl: url });
      onPicked?.(url);
      toast({ title: "Stand-in picture updated" });
    } catch {
      // useUpdateAvatar already rolls the cache back and shows the error.
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className={className} data-testid="fallback-avatar-picker">
      <span
        className="text-[10px] tracking-[0.2em] uppercase text-foreground font-medium block mb-1"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Or pick a stand-in picture
      </span>
      <p
        className="text-[10px] text-muted-foreground mb-3 leading-snug"
        style={{ fontFamily: "var(--font-body)" }}
      >
        Used until you add a real photo. It does not count as your profile photo,
        so we will still ask you for one.
      </p>

      <div className="flex flex-wrap gap-2">
        {FALLBACK_AVATARS.map((key) => {
          const selected = currentKey === key;
          const busy = savingKey === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => choose(key)}
              disabled={!!savingKey}
              aria-pressed={selected}
              aria-label={`Stand-in picture ${key}`}
              className={`relative h-14 w-14 rounded-full overflow-hidden border-2 transition-colors duration-300 disabled:opacity-50 ${
                selected ? "border-primary" : "border-border hover:border-primary/50"
              }`}
            >
              <img
                src={pathFor(key)}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
              {selected && !busy && (
                <span className="absolute inset-0 flex items-center justify-center bg-primary/25">
                  <Check className="h-4 w-4 text-primary-foreground drop-shadow" />
                </span>
              )}
              {busy && (
                <span className="absolute inset-0 flex items-center justify-center bg-background/70">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default FallbackAvatarPicker;
