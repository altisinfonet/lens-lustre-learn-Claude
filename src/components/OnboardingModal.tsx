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
import { scanFileWithToast } from "@/lib/fileSecurityScanner";

const INTEREST_OPTIONS = [
  "Wildlife", "Street", "Portrait", "Aerial", "Documentary",
  "Landscape", "Architecture", "Macro", "Sports", "Fashion",
  "Underwater", "Astrophotography", "Food", "Travel", "Abstract",
];

const USER_TYPES = [
  { value: "student", label: "Student", description: "I'm learning photography", icon: GraduationCap },
  { value: "normal", label: "Enthusiast", description: "Photography is my hobby", icon: User },
  { value: "photographer", label: "Photographer", description: "I'm a professional / aspiring pro", icon: Aperture },
];

interface OnboardingModalProps {
  open: boolean;
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

const OnboardingModal = ({ open, userId, profile, onComplete }: OnboardingModalProps) => {
  const [saving, setSaving] = useState(false);

  // Form state
  const [selectedInterests, setSelectedInterests] = useState<string[]>(profile?.photography_interests || []);
  const [userType, setUserType] = useState(profile?.user_type || "");
  const [dateOfBirth, setDateOfBirth] = useState<Date | undefined>(
    profile?.date_of_birth ? new Date(profile.date_of_birth + "T00:00:00") : undefined,
  );
  const [dobError, setDobError] = useState("");

  // Mandatory profile photo (pre-filled from an OAuth avatar if the user has one).
  const [avatarUrl, setAvatarUrl] = useState<string>(profile?.avatar_url || "");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Silent auto-follow of the official account is enforced server-side (DB trigger);
  // no UI here on purpose.
  useEffect(() => {
    if (profile?.avatar_url && !avatarUrl) setAvatarUrl(profile.avatar_url);
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
      toast({ title: "Upload failed", description: err?.message || "Please try another image", variant: "destructive" });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const ageOk = !!dateOfBirth && differenceInYears(new Date(), dateOfBirth) >= 18;
  const canProceed = ageOk && !!avatarUrl && !!userType && selectedInterests.length > 0;

  const handleFinish = async () => {
    if (!canProceed) {
      if (!dateOfBirth) toast({ title: "Please enter your date of birth", variant: "destructive" });
      else if (!ageOk) toast({ title: "You must be at least 18 years old to join", variant: "destructive" });
      else if (!avatarUrl) toast({ title: "Please add a profile photo to continue", variant: "destructive" });
      else if (!userType) toast({ title: "Please select whether you're a Student, Photographer, or Enthusiast", variant: "destructive" });
      else if (selectedInterests.length === 0) toast({ title: "Please select at least one photography interest", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const updates: Record<string, any> = {
        photography_interests: selectedInterests,
        user_type: userType,
        date_of_birth: format(dateOfBirth!, "yyyy-MM-dd"),
        avatar_url: avatarUrl,
        onboarding_completed: true,
        onboarding_skipped_at: null,
      };
      const { error } = await supabase.from("profiles").update(updates as any).eq("id", userId);
      if (error) throw error;

      // Auto-apply role based on the selection (unchanged behavior).
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

      toast({ title: "Welcome aboard! 🎉", description: "You're all set." });
      onComplete();
    } catch (err: any) {
      toast({ title: "Something went wrong", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-xl p-0 gap-0 overflow-hidden border-border bg-background [&>button]:hidden max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
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
            {/* Mandatory profile photo */}
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="relative w-24 h-24 rounded-full overflow-hidden border-2 border-dashed border-primary/40 hover:border-primary bg-muted/40 flex items-center justify-center transition-colors"
                aria-label="Upload profile photo"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
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
                {avatarUrl ? "Tap to replace your photo" : "Profile photo"} <span className="text-destructive">*</span>
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
                    <CalendarIcon className="h-4 w-4 text-muted-foreground" />
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
                {INTEREST_OPTIONS.map((interest) => {
                  const selected = selectedInterests.includes(interest);
                  return (
                    <button
                      key={interest}
                      onClick={() => toggleInterest(interest)}
                      className={`text-[10px] tracking-[0.08em] px-3 py-1.5 border rounded-sm transition-all duration-300 ${
                        selected ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      {interest}
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
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingModal;
