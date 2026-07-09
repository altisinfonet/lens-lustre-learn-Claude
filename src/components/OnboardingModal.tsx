import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Camera, ChevronRight, ChevronLeft, Loader2, Sparkles,
  GraduationCap, User, Aperture, Globe, Phone, MapPin,
  Share2, SkipForward, Heart, CheckCircle2, CalendarIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format, differenceInYears } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useSiteLogo } from "@/hooks/core/useSiteLogo";
import { toast } from "@/hooks/core/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { COUNTRIES } from "@/lib/profileCompletion";

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

type StepKey = "interests" | "name" | "bio" | "contact" | "address" | "social";

interface StepConfig {
  key: StepKey;
  title: string;
  subtitle: string;
  required?: boolean;
}

const ALL_STEPS: StepConfig[] = [
  { key: "interests", title: "Welcome! Let's get started", subtitle: "Choose your role, select interests, and follow us.", required: true },
  { key: "name", title: "Let's set up your identity", subtitle: "Add your name so others can find you." },
  { key: "bio", title: "Tell us about yourself", subtitle: "A short bio and portfolio link help showcase your work." },
  { key: "contact", title: "How can we reach you?", subtitle: "Your phone and WhatsApp stay private." },
  { key: "address", title: "Where are you based?", subtitle: "Helps connect you with local photography communities." },
  { key: "social", title: "Connect your social profiles", subtitle: "Let others discover your work across platforms." },
  
];

const inputCls = "w-full bg-transparent border-b border-border focus:border-primary outline-none py-3 text-sm transition-colors duration-500";
const labelCls = "block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2";

const OnboardingModal = ({ open, userId, profile, onComplete }: OnboardingModalProps) => {
  // Determine which steps are still needed
  const neededSteps = ALL_STEPS.filter((s) => {
    if (s.required) return !isStepComplete(s.key, profile);
    return !isStepComplete(s.key, profile);
  });

  const steps = neededSteps.length > 0 ? neededSteps : ALL_STEPS.slice(0, 2);

  const [stepIndex, setStepIndex] = useState(0);
  const siteLogo = useSiteLogo();
  const [direction, setDirection] = useState(1);
  const [saving, setSaving] = useState(false);

  // Form state
  const [selectedInterests, setSelectedInterests] = useState<string[]>(profile?.photography_interests || []);
  const [userType, setUserType] = useState(profile?.user_type || "");
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [dateOfBirth, setDateOfBirth] = useState<Date | undefined>(
    profile?.date_of_birth ? new Date(profile.date_of_birth + "T00:00:00") : undefined
  );
  const [dobError, setDobError] = useState("");
  const [bio, setBio] = useState(profile?.bio || "");
  const [portfolioUrl, setPortfolioUrl] = useState(profile?.portfolio_url || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [whatsapp, setWhatsapp] = useState(profile?.whatsapp || "");
  const [country, setCountry] = useState(profile?.country || "");
  const [state, setState] = useState(profile?.state || "");
  const [city, setCity] = useState(profile?.city || "");
  const [postalCode, setPostalCode] = useState(profile?.postal_code || "");
  const [addressLine1, setAddressLine1] = useState(profile?.address_line1 || "");
  const [facebookUrl, setFacebookUrl] = useState(profile?.facebook_url || "");
  const [instagramUrl, setInstagramUrl] = useState(profile?.instagram_url || "");
  const [websiteUrl, setWebsiteUrl] = useState(profile?.website_url || "");

  // Admin follow state
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [isFollowingAdmin, setIsFollowingAdmin] = useState(false);
  const [followingAdminLoading, setFollowingAdminLoading] = useState(false);

  // Fetch admin user id and check follow status
  useEffect(() => {
    const fetchAdmin = async () => {
      const { data: adminId, error: rpcErr } = await supabase.rpc("get_primary_admin_user_id" as any);
      if (rpcErr || !adminId) return;
      setAdminUserId(adminId as string);
      const { data: follow } = await supabase
        .from("follows")
        .select("id")
        .eq("follower_id", userId)
        .eq("following_id", adminId as string)
        .maybeSingle();
      setIsFollowingAdmin(!!follow);
    };
    fetchAdmin();
  }, [userId]);

  const handleFollowAdmin = useCallback(async () => {
    if (!adminUserId || isFollowingAdmin || followingAdminLoading) return;
    setFollowingAdminLoading(true);
    const { error } = await supabase.from("follows").insert({
      follower_id: userId,
      following_id: adminUserId,
    });
    if (!error) {
      setIsFollowingAdmin(true);
      toast({ title: "You're now following 50mm Retina World! 🎉" });
    } else {
      toast({ title: "Failed to follow", description: error.message, variant: "destructive" });
    }
    setFollowingAdminLoading(false);
  }, [adminUserId, userId, isFollowingAdmin, followingAdminLoading]);

  const currentStep = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;
  const isFirstStep = stepIndex === 0;

  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  };

  const canProceed = (): boolean => {
    if (!currentStep) return false;
    switch (currentStep.key) {
      case "interests": {
        if (!dateOfBirth) return false;
        const age = differenceInYears(new Date(), dateOfBirth);
        if (age < 18) return false;
        return selectedInterests.length > 0 && isFollowingAdmin && !!userType;
      }
      default: return true;
    }
  };

  const goNext = async () => {
    if (currentStep?.required && !canProceed()) {
      if (currentStep.key === "interests") {
        if (!dateOfBirth) {
          toast({ title: "Please enter your date of birth", variant: "destructive" });
        } else if (differenceInYears(new Date(), dateOfBirth) < 18) {
          toast({ title: "You must be at least 18 years old to join", variant: "destructive" });
        } else if (!userType) {
          toast({ title: "Please select whether you're a Student, Photographer, or Enthusiast", variant: "destructive" });
        } else if (selectedInterests.length === 0) {
          toast({ title: "Please select at least one photography interest", variant: "destructive" });
        } else if (!isFollowingAdmin) {
          toast({ title: "Please follow 50mm Retina World to continue", variant: "destructive" });
        }
      } else {
        toast({ title: "Please make a selection", variant: "destructive" });
      }
      return;
    }

    // Save data on EVERY step transition (not just the last step)
    setSaving(true);
    try {
      if (isLastStep) {
        await handleFinish();
      } else {
        await saveCurrentData(false);
        setDirection(1);
        setStepIndex((i) => i + 1);
      }
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    if (!isFirstStep) {
      setDirection(-1);
      setStepIndex((i) => i - 1);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      // Save whatever has been filled so far
      await saveCurrentData(false);

      if (isLastStep) {
        // On last step, skip closes the modal with a 24h cooldown
        await supabase
          .from("profiles")
          .update({ onboarding_skipped_at: new Date().toISOString() } as any)
          .eq("id", userId);
        toast({ title: "No worries!", description: "We'll remind you in 24 hours to complete your profile." });
        onComplete();
      } else {
        // On non-last steps, skip advances to next step
        setDirection(1);
        setStepIndex((i) => i + 1);
      }
    } catch (err: any) {
      toast({ title: "Something went wrong", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const saveCurrentData = async (markComplete: boolean) => {
    const updates: Record<string, any> = {};

    if (selectedInterests.length > 0) updates.photography_interests = selectedInterests;
    if (userType) updates.user_type = userType;
    if (dateOfBirth) updates.date_of_birth = format(dateOfBirth, "yyyy-MM-dd");
    if (fullName.trim()) updates.full_name = fullName.trim();
    if (bio.trim()) updates.bio = bio.trim();
    if (portfolioUrl.trim()) updates.portfolio_url = portfolioUrl.trim();
    if (phone.trim()) updates.phone = phone.trim();
    if (whatsapp.trim()) updates.whatsapp = whatsapp.trim();
    if (country) updates.country = country;
    if (state) updates.state = state;
    if (city) updates.city = city;
    if (postalCode.trim()) updates.postal_code = postalCode.trim();
    if (addressLine1.trim()) updates.address_line1 = addressLine1.trim();
    if (facebookUrl.trim()) updates.facebook_url = facebookUrl.trim();
    if (instagramUrl.trim()) updates.instagram_url = instagramUrl.trim();
    if (websiteUrl.trim()) updates.website_url = websiteUrl.trim();

    if (markComplete) {
      updates.onboarding_completed = true;
      updates.onboarding_skipped_at = null;
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from("profiles")
        .update(updates as any)
        .eq("id", userId);
      if (error) throw error;
    }

  };

  const handleFinish = async () => {
    try {
      await saveCurrentData(true);

      // Auto-apply role based on user type selection
      if (userType === "photographer") {
        await supabase.from("role_applications" as any).insert({
          user_id: userId,
          requested_role: "registered_photographer",
          reason: "Selected 'Photographer' during onboarding",
          status: "pending",
        } as any);
      } else if (userType === "student") {
        await supabase.from("role_applications" as any).insert({
          user_id: userId,
          requested_role: "student",
          reason: "Selected 'Student' during onboarding",
          status: "pending",
        } as any);
      }

      toast({ title: "Welcome aboard! 🎉", description: "Your profile has been set up." });
      onComplete();
    } catch (err: any) {
      toast({ title: "Something went wrong", description: err.message, variant: "destructive" });
    }
  };

  const renderStep = () => {
    if (!currentStep) return null;

    switch (currentStep.key) {
      case "interests":
        return (
          <div className="space-y-5">
            {/* Date of Birth */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                  <CalendarIcon className="h-3 w-3 text-primary" />
                </div>
                <span className="text-[10px] tracking-[0.2em] uppercase text-foreground font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                  Date of Birth <span className="text-destructive">*</span>
                </span>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "w-full text-left border-b py-3 text-sm transition-colors duration-500 flex items-center justify-between",
                      dateOfBirth ? "border-border text-foreground" : "border-border text-muted-foreground",
                      dobError && "border-destructive"
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
                      if (d) {
                        const age = differenceInYears(new Date(), d);
                        setDobError(age < 18 ? "You must be at least 18 years old" : "");
                      }
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
                <p className="text-[9px] text-destructive tracking-wide" style={{ fontFamily: "var(--font-heading)" }}>
                  {dobError}
                </p>
              )}
              {dateOfBirth && !dobError && (
                <p className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                  Age: {differenceInYears(new Date(), dateOfBirth)} years — Privacy controls available in Edit Profile
                </p>
              )}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[8px] tracking-[0.3em] uppercase text-muted-foreground/50" style={{ fontFamily: "var(--font-heading)" }}>
                Role
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* User type selection */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-3 w-3 text-primary" />
                </div>
                <span className="text-[10px] tracking-[0.2em] uppercase text-foreground font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                  I am a...
                </span>
              </div>
              <RadioGroup value={userType} onValueChange={setUserType} className="grid grid-cols-3 gap-2">
                {USER_TYPES.map(({ value, label, description, icon: Icon }) => (
                  <Label
                    key={value}
                    htmlFor={`type-${value}`}
                    className={`flex flex-col items-center gap-2 p-3 border cursor-pointer transition-all duration-300 text-center ${
                      userType === value
                        ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <RadioGroupItem value={value} id={`type-${value}`} className="sr-only" />
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors duration-300 ${
                      userType === value ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    }`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-[11px] font-medium" style={{ fontFamily: "var(--font-heading)" }}>{label}</span>
                    <span className="text-[9px] text-muted-foreground leading-tight" style={{ fontFamily: "var(--font-body)" }}>{description}</span>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[8px] tracking-[0.3em] uppercase text-muted-foreground/50" style={{ fontFamily: "var(--font-heading)" }}>
                Interests
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Photography interests */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                  <Camera className="h-3 w-3 text-primary" />
                </div>
                <span className="text-[10px] tracking-[0.2em] uppercase text-foreground font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                  What excites you?
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
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      {interest}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mandatory follow 50mm Retina World */}
            {adminUserId && (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[8px] tracking-[0.3em] uppercase text-muted-foreground/50" style={{ fontFamily: "var(--font-heading)" }}>
                    Community
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="border border-primary/20 bg-primary/5 p-4 space-y-3 rounded-sm">
                  <div className="flex items-center gap-3">
                    <img src={siteLogo} alt="50mm Retina World" className="w-9 h-9 rounded-full object-contain border border-primary/20" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium block" style={{ fontFamily: "var(--font-heading)" }}>50mm Retina World</span>
                      <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                        Follow to stay updated with competitions & community highlights
                      </p>
                    </div>
                    <button
                      onClick={handleFollowAdmin}
                      disabled={isFollowingAdmin || followingAdminLoading}
                      className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-2 border transition-all duration-300 rounded-sm ${
                        isFollowingAdmin
                          ? "border-green-500/50 bg-green-500/10 text-green-600 cursor-default"
                          : "border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                      }`}
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      {followingAdminLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : isFollowingAdmin ? (
                        <>
                          <CheckCircle2 className="h-3 w-3" />
                          Following
                        </>
                      ) : (
                        <>
                          <Heart className="h-3 w-3" />
                          Follow
                        </>
                      )}
                    </button>
                  </div>
                  {!isFollowingAdmin && (
                    <p className="text-[9px] text-destructive text-center tracking-wide uppercase" style={{ fontFamily: "var(--font-heading)" }}>
                      * Required to continue
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        );

      case "name":
        return (
          <div className="space-y-4">
            <div>
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Full Name</label>
              <input className={inputCls} value={fullName} onChange={(e) => { if (e.target.value.length <= 50) setFullName(e.target.value); }} maxLength={50} placeholder="Your full name" style={{ fontFamily: "var(--font-body)" }} />
            </div>
          </div>
        );

      case "bio":
        return (
          <div className="space-y-4">
            <div>
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Bio</label>
              <textarea
                className={`${inputCls} resize-none`}
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us about your photography journey..."
                style={{ fontFamily: "var(--font-body)" }}
              />
            </div>
            <div>
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Portfolio URL</label>
              <input className={inputCls} value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} placeholder="https://your-portfolio.com" style={{ fontFamily: "var(--font-body)" }} />
            </div>
          </div>
        );

      case "contact":
        return (
          <div className="space-y-4">
            <div>
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Phone Number</label>
              <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" style={{ fontFamily: "var(--font-body)" }} />
            </div>
            <div>
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>WhatsApp Number</label>
              <input className={inputCls} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+91 98765 43210" style={{ fontFamily: "var(--font-body)" }} />
            </div>
          </div>
        );

      case "address":
        return (
          <div className="space-y-4">
            <div>
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Country</label>
              <select className={`${inputCls} bg-background`} value={country} onChange={(e) => setCountry(e.target.value)} style={{ fontFamily: "var(--font-body)" }}>
                <option value="">Select Country</option>
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>State</label>
                <input className={inputCls} value={state} onChange={(e) => setState(e.target.value)} placeholder="State" style={{ fontFamily: "var(--font-body)" }} />
              </div>
              <div>
                <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>City</label>
                <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" style={{ fontFamily: "var(--font-body)" }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Address</label>
                <input className={inputCls} value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="Street address" style={{ fontFamily: "var(--font-body)" }} />
              </div>
              <div>
                <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Postal Code</label>
                <input className={inputCls} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="400001" style={{ fontFamily: "var(--font-body)" }} />
              </div>
            </div>
          </div>
        );

      case "social":
        return (
          <div className="space-y-4">
            <div>
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Facebook URL</label>
              <input className={inputCls} value={facebookUrl} onChange={(e) => setFacebookUrl(e.target.value)} placeholder="https://facebook.com/yourpage" style={{ fontFamily: "var(--font-body)" }} />
            </div>
            <div>
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Instagram URL</label>
              <input className={inputCls} value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} placeholder="https://instagram.com/yourhandle" style={{ fontFamily: "var(--font-body)" }} />
            </div>
            <div>
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Website URL</label>
              <input className={inputCls} value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://your-website.com" style={{ fontFamily: "var(--font-body)" }} />
            </div>
          </div>
        );


      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-xl p-0 gap-0 overflow-hidden border-border bg-background [&>button]:hidden max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Progress bar */}
        <div className="h-1 bg-muted sticky top-0 z-10">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* Header */}
        <div className="px-8 pt-6 pb-2 text-center">
          <div className="inline-flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <span
              className="text-[9px] tracking-[0.3em] uppercase text-primary"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {`Step ${stepIndex + 1} of ${steps.length}`}
            </span>
          </div>
        </div>

        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentStep?.key}
            custom={direction}
            initial={{ opacity: 0, x: direction * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -40 }}
            transition={{ duration: 0.3 }}
            className="px-8 pb-8"
          >
            <h2
              className="text-xl font-light tracking-tight text-center mb-2"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {currentStep?.title || ""}
            </h2>
            <p className="text-xs text-muted-foreground text-center mb-6" style={{ fontFamily: "var(--font-body)" }}>
              {currentStep?.subtitle || ""}
            </p>

            {renderStep()}

            {/* Navigation buttons */}
            <div className="flex items-center gap-3 mt-8">
              {!isFirstStep && (
                <button
                  onClick={goBack}
                  className="inline-flex items-center justify-center gap-1.5 text-xs tracking-[0.15em] uppercase px-4 py-3 border border-border hover:border-primary text-muted-foreground hover:text-primary transition-all duration-300"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </button>
              )}

              <button
                onClick={goNext}
                disabled={saving || (currentStep?.required && !canProceed())}
                className="flex-1 inline-flex items-center justify-center gap-2 text-xs tracking-[0.15em] uppercase px-6 py-3 bg-primary text-primary-foreground hover:opacity-90 transition-opacity duration-500 disabled:opacity-30"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving…
                  </>
                ) : isLastStep ? (
                  <>
                    <Camera className="h-3.5 w-3.5" />
                    Complete Profile
                  </>
                ) : (
                  <>
                    Continue
                    <ChevronRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>

            {/* Skip button — not shown on required steps (interests & usertype) */}
            {!currentStep?.required && (
              <button
                onClick={handleSkip}
                disabled={saving}
                className="w-full mt-3 inline-flex items-center justify-center gap-2 text-[10px] tracking-[0.15em] uppercase py-2.5 text-muted-foreground hover:text-primary transition-colors duration-300"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <SkipForward className="h-3 w-3" />
                {isLastStep ? "Skip for now — I'll do this later" : "Skip this step"}
              </button>
            )}
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
};

/** Check if a step is already complete based on existing profile data */
function isStepComplete(key: StepKey, profile: Record<string, any> | null): boolean {
  if (!profile) return false;
  switch (key) {
    case "interests": return !!(profile.photography_interests && profile.photography_interests.length > 0 && profile.user_type);
    case "name": return !!profile.full_name?.trim();
    case "bio": return !!profile.bio?.trim();
    case "contact": return !!profile.phone?.trim();
    case "address": return !!(profile.country && profile.city?.trim());
    case "social": return !!(profile.facebook_url || profile.instagram_url || profile.website_url);
    
    default: return false;
  }
}

export default OnboardingModal;
