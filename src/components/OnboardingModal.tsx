import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Camera, Loader2, Sparkles, GraduationCap, User, Aperture, CalendarIcon, ImagePlus,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format, differenceInYears } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { motion } from "framer-motion";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";
import { compressAvatar } from "@/lib/imageCompression";
import { isOwnProfilePhoto } from "@/lib/profilePhoto";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import { useI18n } from "@/i18n/I18nContext";
import { LANGS } from "@/i18n/translations";
import { useT } from "@/i18n/I18nContext";
import { useCategories } from "@/hooks/useCategories";
import { categoryLabelKey, normaliseInterests } from "@/lib/categories";

/**
 * The photography categories come from the database now — `public.categories`
 * is the single source of truth for the list, its order and its labels. The
 * hard-coded array that used to sit here was duplicated verbatim in
 * EditProfile.tsx and Discover.tsx, so adding or renaming one meant editing
 * three files in lockstep and a rename silently orphaned stored rows.
 */

/**
 * HE / SHE — the wording is the owner's, given 2026-08-05: *"Ask 'He / She' not
 * Male or Female"*. The label a member reads is therefore "He" and "She".
 *
 * The stored value stays `male` / `female` because that is what
 * `profiles_gender_check` allows and what the fallback-avatar filenames
 * (`m1..m5`, `f1..f5`) are keyed on. Changing the stored vocabulary would mean
 * a constraint change, a data migration and renaming ten files, for a word no
 * member ever sees. The label is the product; the value is plumbing.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT FOR: picking a fitting cartoon when a
 * member has not uploaded a photo. It is not used for permissions, visibility,
 * ranking or anything else.
 */
const GENDER_OPTIONS = [
  { value: "male", label: "He" },
  { value: "female", label: "She" },
];

const USER_TYPES = [
  { value: "student", label: "Student", description: "I'm learning photography", icon: GraduationCap },
  { value: "normal", label: "Enthusiast", description: "Photography is my hobby", icon: User },
  { value: "photographer", label: "Photographer", description: "I'm a professional / aspiring pro", icon: Aperture },
];

interface OnboardingModalProps {
  open: boolean;
  /**
   * Let the member close this without finishing.
   *
   * Owner decision, 2026-08-05: *"allow everyone to post and to comment despite
   * DP is there yes / no. But everytime if DP is not there ask to upload but if
   * everytime ignores, no issues allow them to start post, comment, to post
   * share all but on next opening again ask to upload DP."*
   *
   * Set ONLY when the profile photo is the last thing missing. A missing
   * user_type or username still blocks — those are structural (the username is
   * in the member's URL), and the owner stepped back on the photo, nothing else.
   */
  dismissible?: boolean;
  onDismiss?: () => void;
  userId: string;
  profile: Record<string, any> | null;
  onComplete: () => void;
}

/**
 * Rejects a blank / solid / all-black avatar WITHOUT rejecting legitimately dark
 * (moody, low-key) photography. A real photo has tonal variation (std well above
 * the threshold); a blank or solid-black square is near-uniform.
 */
async function isFlatOrBlank(file: File): Promise<boolean> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const S = 24;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const ctx = c.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, S, S);
    const d = ctx.getImageData(0, 0, S, S).data;
    let sum = 0, sumSq = 0, n = 0, maxLum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += lum; sumSq += lum * lum; n++;
      if (lum > maxLum) maxLum = lum;
    }
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    return std < 6 || maxLum < 12; // near-uniform OR essentially all-black
  } catch {
    return false; // never block on a read error
  } finally {
    URL.revokeObjectURL(url);
  }
}

const OnboardingModal = ({ open, userId, profile, onComplete, dismissible = false, onDismiss }: OnboardingModalProps) => {
  const [saving, setSaving] = useState(false);
  const t = useT();
  // The 46 master categories, from the database. One cached fetch, shared with
  // the feed strip and the Create picker.
  const { data: categories = [] } = useCategories();

  // Language is chosen HERE, at profile creation (Facebook/Instagram model).
  // `lang` already holds the account's saved preference if it has one
  // (LanguageAccountSync applies it on login), otherwise the device language,
  // otherwise English — so this field is never blank. Picking a language calls
  // setLang, which converts the app immediately, and handleFinish writes the
  // code to profiles.preferred_language so it follows the user across devices.
  const { lang, setLang } = useI18n();

  // Form state
  // Read through the legacy fallback: this column held English display labels
  // until 2026-08-12, so a member whose row has not been migrated yet still
  // sees their own choices selected instead of an empty picker.
  const [selectedInterests, setSelectedInterests] = useState<string[]>(
    normaliseInterests(profile?.photography_interests),
  );
  const [userType, setUserType] = useState(profile?.user_type || "");
  const [dateOfBirth, setDateOfBirth] = useState<Date | undefined>(
    profile?.date_of_birth ? new Date(profile.date_of_birth + "T00:00:00") : undefined,
  );
  const [dobError, setDobError] = useState("");
  const [gender, setGender] = useState<string>(profile?.gender || "");

  /**
   * THE STAND-IN PICTURE FOLLOWS He / She THE INSTANT IT IS TAPPED.
   *
   * OWNER REPORT, 2026-08-05, testing registration as "leeza.basu":
   *
   *   "clikced she but image not change from he to she. Formula is by default
   *    male image will fill up but when user select she instaly female any icon
   *    will take place."
   *
   * WHY IT DID NOT MOVE. The re-point lives in a database trigger on
   * profiles.gender, and gender is only written when the member presses the
   * final button. So the picture was correct AFTER registering and stubbornly
   * wrong DURING it — which is the only moment the member is actually looking
   * at it.
   *
   * This derives the displayed picture from the CURRENT choice instead of from
   * the stored row: tap She and the face is female on the same frame, with no
   * database round-trip and nothing to go wrong offline.
   *
   * THE SLOT NUMBER IS KEPT. A member on m3 who taps She sees f3, not a
   * different face — the picture changes sex, not identity. That matches the
   * database trigger exactly, so what they see while registering is what they
   * keep afterwards.
   *
   * DEFAULT IS MALE, per the owner's formula ("by default male image will fill
   * up"), which is also what handle_new_user() assigns.
   */
  const assignedFallback =
    typeof profile?.avatar_url === "string" &&
    profile.avatar_url.startsWith("/avatars/fallback/")
      ? (profile.avatar_url as string)
      : null;

  const fallbackSlot = assignedFallback?.match(/[mf]([1-5])\.svg$/)?.[1] ?? "1";

  const standInAvatar = assignedFallback
    ? `/avatars/fallback/${gender === "female" ? "f" : "m"}${fallbackSlot}.svg`
    : null;

  // Mandatory profile photo. It is pre-filled ONLY from a photo the member
  // actually uploaded to our storage — never from an OAuth picture.
  //
  // This used to be `profile?.avatar_url || ""`, which is how 31 accounts got
  // through: Google sign-in fills avatar_url with the Google account picture,
  // that value landed here, and `canProceed` was satisfied before the member
  // had chosen anything. See src/lib/profilePhoto.ts.
  const [avatarUrl, setAvatarUrl] = useState<string>(
    isOwnProfilePhoto(profile?.avatar_url) ? (profile!.avatar_url as string) : "",
  );
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Permanent public username (Instagram format: a-z 0-9 . _ , 3-30 chars).
  // Auto-suggested from the display name via the suggest_username RPC;
  // editable here ONCE; after claim_username succeeds a DB trigger makes it
  // immutable for the lifetime of the account.
  const alreadyClaimed = !!profile?.custom_url;
  const [username, setUsername] = useState<string>(profile?.custom_url || "");
  const [usernameStatus, setUsernameStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >(alreadyClaimed ? "available" : "idle");

  // One-time server-generated suggestion for accounts without a name yet.
  useEffect(() => {
    if (alreadyClaimed || username) return;
    supabase
      .rpc("suggest_username" as any, { display_name: profile?.full_name || "" })
      .then(({ data }) => {
        if (typeof data === "string" && data) setUsername(data);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced live availability check while the user edits.
  useEffect(() => {
    if (alreadyClaimed) return;
    const v = username.trim().toLowerCase();
    if (!v) { setUsernameStatus("idle"); return; }
    if (!/^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$/.test(v) || v.includes("..")) {
      setUsernameStatus("invalid");
      return;
    }
    setUsernameStatus("checking");
    const h = setTimeout(async () => {
      const { data } = await supabase.rpc("username_available" as any, { candidate: v });
      setUsernameStatus(data ? "available" : "taken");
    }, 350);
    return () => clearTimeout(h);
  }, [username, alreadyClaimed]);

  // Silent auto-follow of the official account is enforced server-side (DB trigger);
  // no UI here on purpose.
  useEffect(() => {
    // Same rule as the initial state: only an own-storage photo may back-fill.
    if (isOwnProfilePhoto(profile?.avatar_url) && !avatarUrl) {
      setAvatarUrl(profile!.avatar_url as string);
    }
  }, [profile?.avatar_url]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest],
    );
  };

  const handlePickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const safe = await scanFileWithToast(file, toast, { allowedTypes: "image" });
      if (!safe) return;
      if (await isFlatOrBlank(file)) {
        toast({
          title: "Please choose a real photo",
          description: "A blank or solid black image can't be used as your profile photo. Dark, moody photos are fine.",
          variant: "destructive",
        });
        return;
      }
      const { webpFile } = await compressAvatar(file);
      const filePath = generateImagePath({ userId, type: "avatar", ext: "webp" });
      const result = await uploadImage({ bucket: "avatars", file: webpFile, path: filePath, type: "avatar", fileName: "avatar.webp" });
      const newUrl = `${result.url}?t=${Date.now()}`;
      const { error } = await supabase.from("profiles").update({ avatar_url: newUrl } as any).eq("id", userId);
      if (error) throw error;
      setAvatarUrl(newUrl);
      toast({ title: "Profile photo added" });
    } catch (err: any) {
      // A profile photo is REQUIRED to finish signing up, so a failure here
      // stops a new member dead. On 2026-08-02 one was stopped by
      // "Upload failed / Please try another image" and had nothing to act on,
      // because the underlying rejection was a DOM Event with no `.message`
      // (see loadImage in src/lib/imageCompression.ts). Say which of the two
      // things went wrong, and say what to do about it.
      const decodeFailed = err?.name === "ImageDecodeError";
      toast({
        title: decodeFailed ? "That photo can't be opened here" : "Upload failed",
        description:
          err?.message ||
          "Something went wrong sending the photo. Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const ageOk = !!dateOfBirth && differenceInYears(new Date(), dateOfBirth) >= 18;
  const usernameOk = alreadyClaimed || usernameStatus === "available";
  /**
   * REGISTRATION DOES NOT WAIT FOR A PHOTOGRAPH.
   *
   * OWNER ORDER, 2026-08-05:
   *
   *   "DP is must, either by user, or by icon generated by 50mm, during
   *    registration time automatically must be and easy registration will go
   *    on. after that allow text and photo and comment as normal."
   *
   * This line used to include `!!avatarUrl`, so a new member could not finish
   * registering until they had found and uploaded a photograph. The "either by
   * icon generated by 50mm" half now happens in the database — handle_new_user()
   * assigns one of our ten cartoons in the same statement that creates the
   * profile (migration 20260805120000), so a member ALWAYS has a picture and
   * there is nothing left for this form to block on.
   *
   * The photo is still ASKED for — the control above is unchanged and the
   * standing prompt still reappears on the next opening. It simply no longer
   * stands between a new member and their first post.
   */
  const canProceed =
    ageOk && !!userType && !!gender && selectedInterests.length > 0 && usernameOk;

  const handleFinish = async () => {
    if (!canProceed) {
      if (!dateOfBirth) toast({ title: "Please enter your date of birth", variant: "destructive" });
      else if (!ageOk) toast({ title: "You must be at least 18 years old to join", variant: "destructive" });
      // No photo branch here on purpose — a missing photo can no longer block
      // registration, so a toast about it would name a reason that is not the
      // reason and send the member looking for the wrong thing.
      else if (!usernameOk) toast({ title: "Please choose an available username", variant: "destructive" });
      else if (!gender) toast({ title: "Please select He or She", variant: "destructive" });
      else if (!userType) toast({ title: "Please select whether you're a Student, Photographer, or Enthusiast", variant: "destructive" });
      else if (selectedInterests.length === 0) toast({ title: "Please select at least one photography interest", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // Claim the permanent username FIRST (atomic; the unique index in the
      // DB is the referee). If another signup raced us to the same name,
      // surface it and let the user pick again - nothing else written yet.
      if (!alreadyClaimed) {
        const { data: claim, error: claimErr } = await supabase
          .rpc("claim_username" as any, { candidate: username.trim().toLowerCase() });
        if (claimErr) throw claimErr;
        const res = claim as any;
        if (!res?.ok) {
          setUsernameStatus(res?.reason === "taken" ? "taken" : "invalid");
          toast({
            title: "That username was just taken - please pick another",
            variant: "destructive",
          });
          return;
        }
      }
      const updates: Record<string, any> = {
        photography_interests: selectedInterests,
        user_type: userType,
        date_of_birth: format(dateOfBirth!, "yyyy-MM-dd"),
        /**
         * ONLY write avatar_url when the member ACTUALLY UPLOADED a photo.
         *
         * This used to be a bare `avatar_url: avatarUrl`. The moment the photo
         * stopped being required, that became destructive: a member who skipped
         * it finished registration with avatarUrl === "" and this line
         * OVERWROTE the cartoon the database had just assigned them, leaving
         * them with no picture at all — the exact opposite of "DP is must,
         * either by user, or by icon generated by 50mm". Caught by the owner
         * within minutes, registering as "leeza.basu".
         *
         * The database now also refuses a blank avatar outright
         * (trg_ensure_member_always_has_picture), so this can never recur even
         * from a client that has not been updated.
         */
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        // He / She. Stored as male / female — see GENDER_OPTIONS above.
        // Writing this fires trg_sync_fallback_avatar_to_gender, which re-points
        // the stand-in cartoon to the matching set.
        gender,
        // Persist the language code chosen on this screen. Written explicitly
        // here (not left to LanguageAccountSync) so the preference is saved
        // even when the user keeps the pre-selected language and never touches
        // the picker — the column's legacy default is the string 'English',
        // which is not a valid language code and would otherwise be ignored.
        preferred_language: lang,
        onboarding_completed: true,
        onboarding_skipped_at: null,
      };
      const { error } = await supabase.from("profiles").update(updates as any).eq("id", userId);
      if (error) throw error;

      // Auto-apply role based on the selection — only on FIRST-TIME type
      // selection. Returning users (pulled back through the gate to claim a
      // username) already have user_type set; re-inserting would file a
      // duplicate pending application.
      if (!profile?.user_type) {
        if (userType === "photographer") {
          await supabase.from("role_applications" as any).insert({
            user_id: userId, requested_role: "registered_photographer",
            reason: "Selected 'Photographer' during onboarding", status: "pending",
          } as any);
        } else if (userType === "student") {
          await supabase.from("role_applications" as any).insert({
            user_id: userId, requested_role: "student",
            reason: "Selected 'Student' during onboarding", status: "pending",
          } as any);
        }
      }

      toast({ title: "Welcome aboard! 🎉", description: "You're all set." });
      onComplete();
    } catch (err: any) {
      toast({ title: "Something went wrong", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && dismissible) onDismiss?.(); }}>
      <DialogContent
        className={`sm:max-w-xl p-0 gap-0 overflow-hidden border-border bg-background max-h-[90vh] overflow-y-auto${dismissible ? "" : " [&>button]:hidden"}`}
        onPointerDownOutside={(e) => { if (!dismissible) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (!dismissible) e.preventDefault(); }}
      >
        <div className="h-1 bg-muted sticky top-0 z-10">
          <div className="h-full bg-primary transition-all duration-500 ease-out" style={{ width: "100%" }} />
        </div>

        <div className="px-8 pt-6 pb-2 text-center">
          <div className="inline-flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-[9px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
              Welcome to 50mm Retina World
            </span>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="px-8 pb-8"
        >
          <h2 className="text-xl font-light tracking-tight text-center mb-2" style={{ fontFamily: "var(--font-display)" }}>
            Let's set up your profile
          </h2>
          <p className="text-xs text-muted-foreground text-center mb-6" style={{ fontFamily: "var(--font-body)" }}>
            Just one quick step — then you're in.
          </p>

          <div className="space-y-5">
            {/* Language — chosen at profile creation, applies instantly */}
            <div className="space-y-2">
              <span className="text-[10px] tracking-[0.2em] uppercase text-foreground font-medium block" style={{ fontFamily: "var(--font-heading)" }}>
                Your language
              </span>
              <div className="flex flex-wrap gap-1.5">
                {LANGS.map((l) => {
                  const selected = lang === l.code;
                  return (
                    <button
                      key={l.code}
                      type="button"
                      onClick={() => setLang(l.code)}
                      aria-pressed={selected}
                      className={`flex items-center gap-1.5 text-[10px] tracking-[0.08em] px-3 py-1.5 border rounded-sm transition-all duration-300 ${
                        selected ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      <span className="text-sm leading-none">{l.flag}</span>
                      {l.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] text-muted-foreground leading-snug" style={{ fontFamily: "var(--font-body)" }}>
                You can change this any time from the language menu.
              </p>
            </div>

            {/* Permanent username — claimed once, then locked for life (DB trigger) */}
            <div className="space-y-2">
              <span className="text-[10px] tracking-[0.2em] uppercase text-foreground font-medium block" style={{ fontFamily: "var(--font-heading)" }}>
                Username
              </span>
              <div className={`flex items-center gap-2 border rounded-sm px-3 py-2 transition-colors ${
                alreadyClaimed ? "border-border bg-muted/40"
                : usernameStatus === "taken" || usernameStatus === "invalid" ? "border-destructive"
                : usernameStatus === "available" ? "border-primary/60"
                : "border-border"
              }`}>
                <span className="text-muted-foreground text-sm">@</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  disabled={alreadyClaimed}
                  maxLength={30}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="flex-1 bg-transparent text-sm outline-none text-foreground disabled:text-muted-foreground"
                  style={{ fontFamily: "var(--font-body)" }}
                  aria-label="Username"
                />
                {!alreadyClaimed && (
                  <span
                    className={`text-[9px] tracking-[0.15em] uppercase ${
                      usernameStatus === "available" ? "text-primary"
                      : usernameStatus === "taken" || usernameStatus === "invalid" ? "text-destructive"
                      : "text-muted-foreground"
                    }`}
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {usernameStatus === "available" ? "Available"
                      : usernameStatus === "taken" ? "Taken"
                      : usernameStatus === "invalid" ? "Invalid"
                      : usernameStatus === "checking" ? "Checking…"
                      : ""}
                  </span>
                )}
              </div>
              <p className="text-[9px] text-muted-foreground leading-snug" style={{ fontFamily: "var(--font-body)" }}>
                {alreadyClaimed
                  ? "Your username is permanent and cannot be changed."
                  : "Lowercase letters, numbers, dots and underscores (3–30). This is permanent — it can never be changed later."}
              </p>
            </div>

            {/* Mandatory profile photo */}
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="relative w-24 h-24 rounded-full overflow-hidden border-2 border-dashed border-primary/40 hover:border-primary bg-muted/40 flex items-center justify-center transition-colors"
                aria-label="Upload profile photo"
              >
                {/*
                  Show the member the picture they ALREADY have. avatarUrl is
                  only ever a photo they uploaded here; profile.avatar_url is
                  the cartoon the database assigned at registration. Showing the
                  cartoon makes "either by user, or by icon generated by 50mm"
                  visible — the member can see they are not missing anything.
                  It is display only: canProceed does not read this.
                */}
                {/*
                  Order matters. An uploaded photo always wins. Otherwise show
                  standInAvatar, which tracks the He / She choice live — see the
                  comment where it is derived. profile.avatar_url is the last
                  resort for a row carrying something that is neither an upload
                  nor one of our cartoons.
                */}
                {avatarUrl || standInAvatar || profile?.avatar_url ? (
                  <img
                    src={avatarUrl || standInAvatar || (profile?.avatar_url as string)}
                    alt="Profile"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <ImagePlus className="h-7 w-7 text-muted-foreground" />
                )}
                {uploadingAvatar && (
                  <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                )}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePickPhoto} />
              <span className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                {/* No red asterisk: this is no longer required to register. */}
                {avatarUrl ? "Tap to replace your photo" : "Add your photo (optional)"}
              </span>
            </div>

            {/* Date of Birth */}
            <div className="space-y-2">
              <span className="text-[10px] tracking-[0.2em] uppercase text-foreground font-medium block" style={{ fontFamily: "var(--font-heading)" }}>
                Date of Birth <span className="text-destructive">*</span>
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "w-full text-left border-b py-3 text-sm transition-colors duration-500 flex items-center justify-between",
                      dateOfBirth ? "border-border text-foreground" : "border-border text-muted-foreground",
                      dobError && "border-destructive",
                    )}
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    {dateOfBirth ? format(dateOfBirth, "dd MMMM yyyy") : "Select your date of birth"}
                    <CalendarIcon className="h-4 w-4 text-primary" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-[200]" align="start">
                  <Calendar
                    mode="single"
                    selected={dateOfBirth}
                    onSelect={(d) => {
                      setDateOfBirth(d);
                      if (d) setDobError(differenceInYears(new Date(), d) < 18 ? "You must be at least 18 years old" : "");
                    }}
                    disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
                    captionLayout="dropdown-buttons"
                    fromYear={1940}
                    toYear={new Date().getFullYear() - 18}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              {dobError && (
                <p className="text-[9px] text-destructive tracking-wide" style={{ fontFamily: "var(--font-heading)" }}>{dobError}</p>
              )}
            </div>

            {/* He / She — owner's wording, 2026-08-05. See GENDER_OPTIONS. */}
            <div className="space-y-2">
              <span className="text-[10px] tracking-[0.2em] uppercase text-foreground font-medium block" style={{ fontFamily: "var(--font-heading)" }}>
                You are <span className="text-destructive">*</span>
              </span>
              <RadioGroup value={gender} onValueChange={setGender} className="grid grid-cols-2 gap-2">
                {GENDER_OPTIONS.map(({ value, label }) => (
                  <Label
                    key={value}
                    htmlFor={`gender-${value}`}
                    className={`flex items-center justify-center py-3 border cursor-pointer transition-all duration-300 text-center ${
                      gender === value ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40"
                    }`}
                  >
                    <RadioGroupItem value={value} id={`gender-${value}`} className="sr-only" />
                    <span className="text-sm font-medium" style={{ fontFamily: "var(--font-heading)" }}>{label}</span>
                  </Label>
                ))}
              </RadioGroup>
              <p className="text-[9px] text-muted-foreground leading-snug" style={{ fontFamily: "var(--font-body)" }}>
                Used only to pick a matching avatar if you ever have no photo. Nothing else.
              </p>
            </div>

            {/* Role */}
            <div className="space-y-2">
              <span className="text-[10px] tracking-[0.2em] uppercase text-foreground font-medium block" style={{ fontFamily: "var(--font-heading)" }}>
                I am a... <span className="text-destructive">*</span>
              </span>
              <RadioGroup value={userType} onValueChange={setUserType} className="grid grid-cols-3 gap-2">
                {USER_TYPES.map(({ value, label, description, icon: Icon }) => (
                  <Label
                    key={value}
                    htmlFor={`type-${value}`}
                    className={`flex flex-col items-center gap-2 p-3 border cursor-pointer transition-all duration-300 text-center ${
                      userType === value ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                  >
                    <RadioGroupItem value={value} id={`type-${value}`} className="sr-only" />
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center ${userType === value ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-[11px] font-medium" style={{ fontFamily: "var(--font-heading)" }}>{label}</span>
                    <span className="text-[9px] text-muted-foreground leading-tight" style={{ fontFamily: "var(--font-body)" }}>{description}</span>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            {/* Interests */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] tracking-[0.2em] uppercase text-foreground font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                  What excites you? <span className="text-destructive">*</span>
                </span>
                {selectedInterests.length > 0 && (
                  <span className="ml-auto text-[9px] text-primary px-2 py-0.5 bg-primary/10 rounded-full" style={{ fontFamily: "var(--font-heading)" }}>
                    {selectedInterests.length} selected
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {categories.map((cat) => {
                  const selected = selectedInterests.includes(cat.slug);
                  return (
                    <button
                      key={cat.slug}
                      onClick={() => toggleInterest(cat.slug)}
                      className={`text-[10px] tracking-[0.08em] px-3 py-1.5 border rounded-sm transition-all duration-300 ${
                        selected ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      {/* The SLUG is stored; the translated NAME is shown. A slug
                          is never rendered and a display name is never stored. */}
                      {t(categoryLabelKey(cat.slug), cat.name)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-8">
            <button
              onClick={handleFinish}
              disabled={saving || uploadingAvatar}
              className="w-full inline-flex items-center justify-center gap-2 text-xs tracking-[0.15em] uppercase px-6 py-3 bg-primary text-primary-foreground hover:opacity-90 transition-opacity duration-500 disabled:opacity-40"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {saving ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" />Setting up…</>) : (<><Camera className="h-3.5 w-3.5" />Enter 50mm Retina World</>)}
            </button>

            {/*
              The way out. It exists ONLY when the photo is the last thing
              missing — see the `dismissible` prop. Ignoring it costs the member
              nothing: they can post, comment and share, and they are asked
              again next time they open the app. That is the owner's decision of
              2026-08-05, taken after 32 of 83 members turned out to be locked
              out entirely.
            */}
            {dismissible && (
              <button
                onClick={() => onDismiss?.()}
                disabled={saving || uploadingAvatar}
                className="mt-3 w-full text-[11px] tracking-[0.1em] uppercase px-6 py-2.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Not now — remind me later
              </button>
            )}
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingModal;
