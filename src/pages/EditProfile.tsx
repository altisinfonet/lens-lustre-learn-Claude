import { Link, useNavigate } from "react-router-dom";
import { Bell, Camera, CheckCircle2, Facebook, Instagram, Globe, KeyRound, Loader2, Mail, MapPin, Phone, Save, User, X, AlertCircle, ExternalLink, Twitter, Youtube, CloudOff, Cloud, CalendarIcon } from "lucide-react";
import ProfileCompletionBar from "@/components/ProfileCompletionBar";
import PrivacyToggle, { DEFAULT_PRIVACY, type PrivacyLevel } from "@/components/PrivacyToggle";
import { COUNTRIES } from "@/lib/profileCompletion";
import { getCountries, getStatesForCountry, getCitiesForState } from "@/lib/locationData";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";
import { toast } from "@/hooks/core/use-toast";
import { compressAvatar, compressImageToFiles } from "@/lib/imageCompression";
import { useUpdateProfile, useUpdateAvatar, useUpdateCover } from "@/hooks/profile/useProfileMutations";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import { createProfileUpdatePost } from "@/lib/profilePostHelper";
import ImageCropModal from "@/components/admin/ImageCropModal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format, differenceInYears } from "date-fns";
import { normalizeFullName } from "@/lib/nameNormalize";

const INTEREST_OPTIONS = [
  "Wildlife", "Street", "Portrait", "Aerial", "Documentary",
  "Landscape", "Architecture", "Macro", "Sports", "Fashion",
  "Underwater", "Astrophotography", "Food", "Travel", "Abstract",
];

const labelCls = "block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2";
const inputCls = "w-full bg-transparent border-b border-border focus:border-primary outline-none py-3 text-sm transition-colors duration-500";
const sectionHeadCls = "text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-6";

const EditProfile = () => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin } = useIsAdmin();
  
  const navigate = useNavigate();
  const profileMutation = useUpdateProfile();
  const avatarMutation = useUpdateAvatar();
  const coverMutation = useUpdateCover();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sendingReset, setSendingReset] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDone = useRef(false);
  

  const handlePasswordReset = async () => {
    if (!user?.email) return;
    setSendingReset(true);
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSendingReset(false);
    if (error) {
      toast({ title: "Failed to send reset email", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Password reset email sent", description: "Check your inbox for the reset link." });
    }
  };

  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [facebookUrl, setFacebookUrl] = useState(""); // stores username only
  const [instagramUrl, setInstagramUrl] = useState(""); // stores username only
  const [twitterUrl, setTwitterUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [customUrlAvailable, setCustomUrlAvailable] = useState<boolean | null>(null);
  const [checkingCustomUrl, setCheckingCustomUrl] = useState(false);
  const [urlSuggestions, setUrlSuggestions] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [privacySettings, setPrivacySettings] = useState<Record<string, PrivacyLevel>>({ ...DEFAULT_PRIVACY });
  const [pronouns, setPronouns] = useState("");
  const [currentCity, setCurrentCity] = useState("");
  const [workplace, setWorkplace] = useState("");
  const [education, setEducation] = useState("");
  
  
  const [dateOfBirth, setDateOfBirth] = useState<Date | undefined>(undefined);
  const [dobOpen, setDobOpen] = useState(false);
  const [dobDayMonthPrivacy, setDobDayMonthPrivacy] = useState<PrivacyLevel>("friends");
  const [dobYearPrivacy, setDobYearPrivacy] = useState<PrivacyLevel>("only_me");
  // SOW §5.2 — Privacy gate: hide profile from search engines
  const [indexingDisabled, setIndexingDisabled] = useState(false);

  const setFieldPrivacy = (field: string, value: PrivacyLevel) => {
    setPrivacySettings((prev) => ({ ...prev, [field]: value }));
  };

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Cascading location lists
  const availableCountries = [...new Set([...getCountries(), ...COUNTRIES])].sort();
  const availableStates = country ? getStatesForCountry(country) : [];
  const availableCities = country && state ? getCitiesForState(country, state) : [];

  // Validation helpers
  const validateFullName = (value: string): string => {
    if (!value.trim()) return "Name is required";
    if (value.trim().length < 2) return "Name must be at least 2 characters";
    if (value.trim().length > 37) return "Name must be 37 characters or less";
    if (/<[^>]*>/i.test(value)) return "Name cannot contain HTML tags";
    if (/[<>{}()\[\]\\\/;`$]/.test(value)) return "Name contains invalid characters";
    if (/script|javascript|onerror|onclick/i.test(value)) return "Name contains prohibited content";
    if (!/^[\p{L}\p{M}\s'\-.,]+$/u.test(value.trim())) return "Name can only contain letters, spaces, hyphens, apostrophes, and periods";
    return "";
  };

  const validateBio = (value: string): string => {
    if (value.length > 500) return "Bio must be less than 500 characters";
    if (/<script[\s>]/i.test(value)) return "Bio cannot contain script tags";
    if (/javascript\s*:/i.test(value)) return "Bio contains prohibited content";
    if (/<iframe|<object|<embed|<form/i.test(value)) return "Bio cannot contain HTML elements";
    if (/on\w+\s*=\s*["']/i.test(value)) return "Bio contains prohibited event handlers";
    return "";
  };

  const handleFullNameChange = (val: string) => {
    setFullName(val);
    setErrors((prev) => ({ ...prev, fullName: validateFullName(val) }));
  };

  const handleBioChange = (val: string) => {
    if (val.length > 500) return; // Hard cap
    setBio(val);
    setErrors((prev) => ({ ...prev, bio: validateBio(val) }));
  };

  const validatePhone = (value: string): string => {
    if (!value.trim()) return "";
    const cleaned = value.replace(/[\s\-()]/g, "");
    if (!/^\+?\d{7,15}$/.test(cleaned)) return "Enter a valid phone number (7-15 digits, optional + prefix)";
    return "";
  };

  const validatePostalCode = (value: string): string => {
    if (!value.trim()) return "";
    if (!/^[A-Za-z0-9\s\-]{3,10}$/.test(value.trim())) return "Enter a valid postal/ZIP code";
    return "";
  };

  // Social handle validation disabled — accept anything the user types.
  const validateFacebook = (_value: string): string => "";
  const validateInstagram = (_value: string): string => "";
  const validateTwitter = (_value: string): string => "";
  const validateYoutube = (_value: string): string => "";

  const RESERVED_URLS = ["login","signup","forgot-password","reset-password","dashboard","edit-profile","profile","friends","feed","discover","competitions","admin","judge","journal","courses","certificates","verify","winners","wallet","featured-artist","referrals","help-support","page","hashtag","not-found","root","system","api","support","help","contact","about","settings","user","users","www","mail","ftp","cdn","static","assets","media","photos","unsubscribe","cookie-policy","post","entry","certificate"];

  const validateCustomUrl = (value: string): string => {
    if (!value.trim()) return "";
    if (value.trim().length < 3) return "Custom URL must be at least 3 characters.";
    if (value.trim().length > 50) return "Custom URL must be less than 50 characters.";
    if (!/^[a-zA-Z0-9._\-]+$/.test(value.trim())) return "Only letters, numbers, dots, hyphens, and underscores allowed.";
    if (RESERVED_URLS.includes(value.trim().toLowerCase())) return "This URL is reserved.";
    return "";
  };

  const customUrlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generateSuggestions = async (base: string) => {
    const suffixes = ["_01", ".photo", ".official", ".in", ".art"];
    const prefixes = ["real", "the"];
    const candidates = [
      ...suffixes.map((s) => base + s),
      ...prefixes.map((p) => p + base),
    ].filter((c) => c.length >= 3 && c.length <= 50);

    const { data: taken } = await (supabase
      .rpc("check_custom_urls_taken" as any, { _urls: candidates }) as any);

    const takenSet = new Set(
      ((taken as any[]) || []).map((r: any) => r.custom_url?.toLowerCase())
    );
    setUrlSuggestions(candidates.filter((c) => !takenSet.has(c)).slice(0, 5));
  };

  const handleCustomUrlChange = (val: string) => {
    const cleaned = val.replace(/\s/g, "").toLowerCase();
    setCustomUrl(cleaned);
    setCustomUrlAvailable(null);
    setUrlSuggestions([]);
    const err = validateCustomUrl(cleaned);
    setErrors((prev) => ({ ...prev, customUrl: err }));
    if (err || !cleaned) {
      if (customUrlTimerRef.current) clearTimeout(customUrlTimerRef.current);
      return;
    }
    if (customUrlTimerRef.current) clearTimeout(customUrlTimerRef.current);
    customUrlTimerRef.current = setTimeout(async () => {
      setCheckingCustomUrl(true);
      const { data: resolved } = await (supabase
        .rpc("resolve_custom_url" as any, { _url: cleaned }) as any);
      const data = Array.isArray(resolved) ? resolved[0] : null;
      setCheckingCustomUrl(false);
      if (!data) {
        setCustomUrlAvailable(true);
        return;
      }
      if ((data as any).user_id === user?.id) {
        setCustomUrlAvailable(true);
        return;
      }
      if ((data as any).is_current) {
        setCustomUrlAvailable(false);
        if (cleaned.length >= 3) generateSuggestions(cleaned);
        return;
      }
      const releasedAt = (data as any).released_at ? new Date((data as any).released_at) : null;
      if (releasedAt && Date.now() - releasedAt.getTime() < 30 * 24 * 60 * 60 * 1000) {
        setCustomUrlAvailable(false);
        setErrors((prev) => ({ ...prev, customUrl: `This URL was recently released. Available after ${new Date(releasedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}.` }));
        if (cleaned.length >= 3) generateSuggestions(cleaned);
        return;
      }
      setCustomUrlAvailable(true);
    }, 400);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setCustomUrl(suggestion);
    setUrlSuggestions([]);
    setCustomUrlAvailable(true);
    setErrors((prev) => ({ ...prev, customUrl: "" }));
  };

  const handleFacebookChange = (val: string) => {
    const cleaned = val.replace(/\s/g, "");
    setFacebookUrl(cleaned);
    
    setErrors((prev) => ({ ...prev, facebook: validateFacebook(cleaned) }));
  };

  const handleInstagramChange = (val: string) => {
    const cleaned = val.replace(/\s/g, "");
    setInstagramUrl(cleaned);
    
    setErrors((prev) => ({ ...prev, instagram: validateInstagram(cleaned) }));
  };

  const handleTwitterChange = (val: string) => {
    const cleaned = val.replace(/\s/g, "");
    setTwitterUrl(cleaned);
    
    setErrors((prev) => ({ ...prev, twitter: validateTwitter(cleaned) }));
  };

  const handleYoutubeChange = (val: string) => {
    const cleaned = val.replace(/\s/g, "");
    setYoutubeUrl(cleaned);
    
    setErrors((prev) => ({ ...prev, youtube: validateYoutube(cleaned) }));
  };

  const handlePhoneChange = (val: string) => {
    setPhone(val);
    setErrors((prev) => ({ ...prev, phone: validatePhone(val) }));
  };

  const handleWhatsappChange = (val: string) => {
    setWhatsapp(val);
    setErrors((prev) => ({ ...prev, whatsapp: validatePhone(val) }));
  };

  const handlePostalCodeChange = (val: string) => {
    setPostalCode(val);
    setErrors((prev) => ({ ...prev, postalCode: validatePostalCode(val) }));
  };

  const handleCountryChange = (val: string) => {
    setCountry(val);
    setState("");
    setCity("");
  };

  const handleStateChange = (val: string) => {
    setState(val);
    setCity("");
  };

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (data) {
        setFullName(data.full_name || "");
        setBio(data.bio || "");
        setPortfolioUrl(data.portfolio_url || "");
        setInterests(data.photography_interests || []);
        const rawFb = (data as any).facebook_url || "";
        setFacebookUrl(rawFb.replace(/^https?:\/\/(www\.)?facebook\.com\//i, "").replace(/\/$/, ""));
        const rawIg = (data as any).instagram_url || "";
        setInstagramUrl(rawIg.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, ""));
        const rawTw = (data as any).twitter_url || "";
        setTwitterUrl(rawTw.replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com)\//i, "").replace(/\/$/, ""));
        const rawYt = (data as any).youtube_url || "";
        setYoutubeUrl(rawYt.replace(/^https?:\/\/(www\.)?youtube\.com\/@?/i, "").replace(/\/$/, ""));
        setWebsiteUrl((data as any).website_url || "");
        setAvatarUrl(data.avatar_url || null);
        setCoverUrl((data as any).cover_url || null);
        setCustomUrl((data as any).custom_url || "");
        setAddressLine1((data as any).address_line1 || "");
        setAddressLine2((data as any).address_line2 || "");
        setCity((data as any).city || "");
        setState((data as any).state || "");
        setCountry((data as any).country || "");
        setPostalCode((data as any).postal_code || "");
        setPhone((data as any).phone || "");
        setWhatsapp((data as any).whatsapp || "");
        setPronouns((data as any).pronouns || "");
        setCurrentCity((data as any).current_city || "");
        setWorkplace((data as any).workplace || "");
        setEducation((data as any).education || "");
        
        if ((data as any).date_of_birth) {
          setDateOfBirth(new Date((data as any).date_of_birth + "T00:00:00"));
        }
        setIndexingDisabled(Boolean((data as any).indexing_disabled));
        if ((data as any).privacy_settings) {
          const ps = (data as any).privacy_settings;
          setPrivacySettings({ ...DEFAULT_PRIVACY, ...ps });
          if (ps.dob_day_month) setDobDayMonthPrivacy(ps.dob_day_month);
          if (ps.dob_year) setDobYearPrivacy(ps.dob_year);
        }
      }
      setLoading(false);
    };
    fetch();
  }, [user]);

  /* ── Avatar upload: file select → crop → preview + caption → upload ── */
  const [avatarCropSrc, setAvatarCropSrc] = useState<string | null>(null);
  const [avatarCroppedFile, setAvatarCroppedFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarCaption, setAvatarCaption] = useState("");
  const [showAvatarPreview, setShowAvatarPreview] = useState(false);

  /* ── Cover photo upload: file select → crop → preview + caption → upload ── */
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverCropSrc, setCoverCropSrc] = useState<string | null>(null);
  const [coverCroppedFile, setCoverCroppedFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [coverCaption, setCoverCaption] = useState("");
  const [showCoverPreview, setShowCoverPreview] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverFileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }
    setAvatarCropSrc(URL.createObjectURL(file));
    // reset input so same file can be re-selected
    e.target.value = "";
  };

  const handleAvatarCropDone = (croppedFile: File) => {
    if (avatarCropSrc) URL.revokeObjectURL(avatarCropSrc);
    setAvatarCropSrc(null);
    setAvatarCroppedFile(croppedFile);
    setAvatarPreviewUrl(URL.createObjectURL(croppedFile));
    setAvatarCaption("");
    setShowAvatarPreview(true);
  };

  const handleAvatarCropCancel = () => {
    if (avatarCropSrc) URL.revokeObjectURL(avatarCropSrc);
    setAvatarCropSrc(null);
  };

  const handleAvatarConfirmUpload = async () => {
    if (!avatarCroppedFile || !user) return;
    setUploadingAvatar(true);
    try {
      const safe = await scanFileWithToast(avatarCroppedFile, toast, { allowedTypes: "image" });
      if (!safe) { setUploadingAvatar(false); return; }
      const { webpFile } = await compressAvatar(avatarCroppedFile);
      const filePath = generateImagePath({ userId: user.id, type: "avatar", ext: "webp" });
      const result = await uploadImage({ bucket: "avatars", file: webpFile, path: filePath, type: "avatar", fileName: "avatar.webp" });
      const newUrl = `${result.url}?t=${Date.now()}`;
      await avatarMutation.mutateAsync({ avatarUrl: newUrl, storagePath: filePath });
      setAvatarUrl(newUrl);
      await createProfileUpdatePost(user.id, "avatar", newUrl, avatarCaption || undefined);
      toast({ title: "Profile picture updated" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    setUploadingAvatar(false);
    setShowAvatarPreview(false);
    setAvatarCroppedFile(null);
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    setAvatarPreviewUrl(null);
    setAvatarCaption("");
  };

  const handleAvatarPreviewCancel = () => {
    setShowAvatarPreview(false);
    setAvatarCroppedFile(null);
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    setAvatarPreviewUrl(null);
    setAvatarCaption("");
  };

  /* ── Cover photo handlers ── */
  const handleCoverFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }
    setCoverCropSrc(URL.createObjectURL(file));
    e.target.value = "";
  };

  const handleCoverCropDone = (croppedFile: File) => {
    if (coverCropSrc) URL.revokeObjectURL(coverCropSrc);
    setCoverCropSrc(null);
    setCoverCroppedFile(croppedFile);
    setCoverPreviewUrl(URL.createObjectURL(croppedFile));
    setCoverCaption("");
    setShowCoverPreview(true);
  };

  const handleCoverCropCancel = () => {
    if (coverCropSrc) URL.revokeObjectURL(coverCropSrc);
    setCoverCropSrc(null);
  };

  const handleCoverConfirmUpload = async () => {
    if (!coverCroppedFile || !user) return;
    setUploadingCover(true);
    try {
      const safe = await scanFileWithToast(coverCroppedFile, toast, { allowedTypes: "image" });
      if (!safe) { setUploadingCover(false); return; }
      const { webpFile } = await compressImageToFiles(coverCroppedFile, "cover", { maxDimension: 1920, webpQuality: 0.92 });
      const filePath = generateImagePath({ userId: user.id, type: "cover", ext: "webp" });
      const result = await uploadImage({ bucket: "avatars", file: webpFile, path: filePath, type: "cover", fileName: "cover.webp" });
      const newUrl = `${result.url}?t=${Date.now()}`;
      await coverMutation.mutateAsync({ coverUrl: newUrl, coverPosition: 50, storagePath: filePath });
      setCoverUrl(newUrl);
      await createProfileUpdatePost(user.id, "cover", newUrl, coverCaption || undefined);
      toast({ title: "Cover photo updated" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    setUploadingCover(false);
    setShowCoverPreview(false);
    setCoverCroppedFile(null);
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    setCoverPreviewUrl(null);
    setCoverCaption("");
  };

  const handleCoverPreviewCancel = () => {
    setShowCoverPreview(false);
    setCoverCroppedFile(null);
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    setCoverPreviewUrl(null);
    setCoverCaption("");
  };

  const toggleInterest = (interest: string) => {
    setInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  };

  const profileData = {
    avatar_url: avatarUrl,
    full_name: fullName,
    bio,
    portfolio_url: portfolioUrl,
    photography_interests: interests,
    facebook_url: facebookUrl.trim() ? `https://www.facebook.com/${facebookUrl.trim()}` : null,
    instagram_url: instagramUrl.trim() ? `https://www.instagram.com/${instagramUrl.trim()}` : null,
    website_url: websiteUrl,
    address_line1: addressLine1,
    city,
    state,
    country,
    postal_code: postalCode,
    phone,
    whatsapp,
  };

  const performSave = useCallback(async () => {
    if (!user) return;
    // Validate all fields
    const nameErr = validateFullName(fullName);
    const bioErr = validateBio(bio);
    const phoneErr = validatePhone(phone);
    const whatsappErr = validatePhone(whatsapp);
    const postalErr = validatePostalCode(postalCode);
    const fbErr = validateFacebook(facebookUrl);
    const igErr = validateInstagram(instagramUrl);
    const twErr = validateTwitter(twitterUrl);
    const ytErr = validateYoutube(youtubeUrl);
    const customUrlErr = validateCustomUrl(customUrl);
    if (customUrl.trim() && customUrlAvailable === false) {
      setErrors((prev) => ({ ...prev, customUrl: "This URL is already taken." }));
      setSaveStatus("error");
      return;
    }
    if (nameErr || bioErr || phoneErr || whatsappErr || postalErr || fbErr || igErr || twErr || ytErr || customUrlErr) {
      setErrors({ fullName: nameErr, bio: bioErr, phone: phoneErr, whatsapp: whatsappErr, postalCode: postalErr, facebook: fbErr, instagram: igErr, twitter: twErr, youtube: ytErr, customUrl: customUrlErr });
      setSaveStatus("error");
      return;
    }
    setSaving(true);
    setSaveStatus("saving");
    try {
      const normalizedName = normalizeFullName(fullName);
      if (!normalizedName) {
        setErrors((prev) => ({ ...prev, fullName: "Name cannot be empty." }));
        setSaving(false);
        setSaveStatus("error");
        return;
      }
      // Handle custom_url via RPC (separate from profile update)
      const currentCustomUrl = customUrl.trim() || null;
      // We need to check if custom_url actually changed before calling RPC
      const { data: currentProfile } = await supabase
        .from("profiles")
        .select("custom_url")
        .eq("id", user.id)
        .maybeSingle();
      const existingUrl = (currentProfile as any)?.custom_url || null;
      
      if (currentCustomUrl !== existingUrl) {
        if (currentCustomUrl) {
          const { error: rpcError } = await supabase.rpc("change_custom_url" as any, {
            _new_url: currentCustomUrl,
          }) as any;
          if (rpcError) {
            const msg = (rpcError as any).message || "Failed to update custom URL";
            setErrors((prev) => ({ ...prev, customUrl: msg }));
            toast({ title: "Custom URL Error", description: msg, variant: "destructive" });
            setSaveStatus("error");
            setSaving(false);
            return;
          }
        } else if (existingUrl) {
          // User cleared custom_url — use RPC to maintain history consistency
          const { error: clearError } = await supabase.rpc("clear_custom_url" as any) as any;
          if (clearError) {
            toast({ title: "Error", description: "Failed to clear custom URL", variant: "destructive" });
            setSaveStatus("error");
            setSaving(false);
            return;
          }
        }
      }

      await profileMutation.mutateAsync({
        full_name: normalizedName,
        bio: bio.trim() || null,
        portfolio_url: portfolioUrl.trim() || null,
        photography_interests: interests.length > 0 ? interests : null,
        facebook_url: facebookUrl.trim() ? `https://www.facebook.com/${facebookUrl.trim()}` : null,
        instagram_url: instagramUrl.trim() ? `https://www.instagram.com/${instagramUrl.trim()}` : null,
        twitter_url: twitterUrl.trim() ? `https://x.com/${twitterUrl.trim()}` : null,
        youtube_url: youtubeUrl.trim() ? `https://www.youtube.com/@${youtubeUrl.trim()}` : null,
        website_url: websiteUrl.trim() || null,
        address_line1: addressLine1.trim() || null,
        address_line2: addressLine2.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        country: country || null,
        postal_code: postalCode.trim() || null,
        phone: phone.trim() || null,
        whatsapp: whatsapp.trim() || null,
        
        privacy_settings: { ...privacySettings, dob_day_month: dobDayMonthPrivacy, dob_year: dobYearPrivacy },
        pronouns: pronouns.trim() || null,
        current_city: currentCity.trim() || null,
        workplace: workplace.trim() || null,
        education: education.trim() || null,
        date_of_birth: dateOfBirth ? `${dateOfBirth.getFullYear()}-${String(dateOfBirth.getMonth() + 1).padStart(2, "0")}-${String(dateOfBirth.getDate()).padStart(2, "0")}` : null,
        indexing_disabled: indexingDisabled,
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (e: any) {
      const msg = e?.message || "Save failed";
      toast({ title: "Save Error", description: msg, variant: "destructive" });
      setSaveStatus("error");
    }
    setSaving(false);
  }, [user, fullName, bio, portfolioUrl, interests, facebookUrl, instagramUrl, twitterUrl, youtubeUrl, websiteUrl, addressLine1, addressLine2, city, state, country, postalCode, phone, whatsapp, privacySettings, customUrl, customUrlAvailable, pronouns, currentCity, workplace, education, dateOfBirth, dobDayMonthPrivacy, dobYearPrivacy, indexingDisabled]);

  // Debounced auto-save: triggers 1.5s after any field change
  const triggerAutoSave = useCallback(() => {
    if (!initialLoadDone.current) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setSaveStatus("idle");
    autoSaveTimerRef.current = setTimeout(() => {
      performSave();
    }, 1500);
  }, [performSave]);

  // Watch all form fields for changes and trigger auto-save
  useEffect(() => {
    triggerAutoSave();
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [fullName, bio, portfolioUrl, interests, facebookUrl, instagramUrl, twitterUrl, youtubeUrl, websiteUrl, addressLine1, addressLine2, city, state, country, postalCode, phone, whatsapp, privacySettings, customUrl, pronouns, currentCity, workplace, education, indexingDisabled]);

  // Mark initial load as done after profile is fetched
  useEffect(() => {
    if (!loading) {
      // Small delay to skip the initial state-setting triggers
      setTimeout(() => { initialLoadDone.current = true; }, 200);
    }
  }, [loading]);

  if (authLoading || loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={{ fontFamily: "var(--font-heading)" }}>Loading...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground relative">
      {/* Floating saved indicator */}
      {saveStatus === "saved" && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 px-4 py-1.5 rounded-full text-[10px] tracking-[0.15em] uppercase animate-in fade-in slide-in-from-top-2 duration-300" style={{ fontFamily: "var(--font-heading)" }}>
          <CheckCircle2 className="h-3 w-3" />
          Saved
        </div>
      )}
      <div className="container mx-auto py-3 md:py-20 max-w-2xl">

        <div className="flex items-center gap-3 mb-1 md:mb-2">
          <div className="w-8 md:w-12 h-px bg-primary" />
          <span className="text-[9px] md:text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>Profile</span>
        </div>
        <h1 className="text-xl md:text-5xl font-light tracking-tight mb-4 md:mb-8" style={{ fontFamily: "var(--font-display)" }}>
          Edit <em className="italic text-primary">Profile</em>
        </h1>

        {/* Completion Bar */}
        <ProfileCompletionBar profile={profileData} className="mb-6 md:mb-12 border border-border rounded-xl md:rounded-none p-3 md:p-6" />

        <div className="space-y-5 md:space-y-8">
          {/* Cover Photo */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Cover Photo</span>
              <PrivacyToggle value={privacySettings.cover || "public"} onChange={(v) => setFieldPrivacy("cover", v)} />
            </div>
            <div className="relative group rounded-lg overflow-hidden border border-border" style={{ aspectRatio: "3/1" }}>
              {coverUrl ? (
                <img loading="lazy" decoding="async" src={coverUrl} alt="Cover" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <Camera className="h-8 w-8 text-muted-foreground/30" />
                </div>
              )}
              <button
                type="button"
                onClick={() => coverFileInputRef.current?.click()}
                disabled={uploadingCover}
                className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-2"
              >
                {uploadingCover ? (
                  <Loader2 className="h-5 w-5 text-primary-foreground animate-spin" />
                ) : (
                  <>
                    <Camera className="h-5 w-5 text-primary-foreground" />
                    <span className="text-xs text-primary-foreground font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                      {coverUrl ? "Change Cover" : "Add Cover Photo"}
                    </span>
                  </>
                )}
              </button>
              <input ref={coverFileInputRef} type="file" accept="image/*" onChange={handleCoverFileSelect} className="hidden" />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5" style={{ fontFamily: "var(--font-body)" }}>
              Recommended: 1920×640px (3:1 ratio). JPG, PNG or WebP. Max 5MB.
            </p>
          </div>

          {/* Cover Crop Modal */}
          {coverCropSrc && (
            <ImageCropModal
              imageSrc={coverCropSrc}
              onCropComplete={handleCoverCropDone}
              onCancel={handleCoverCropCancel}
              forcedAspect={3}
              targetWidth={1920}
              targetHeight={640}
            />
          )}

          {/* Cover Preview + Caption Modal */}
          {showCoverPreview && coverPreviewUrl && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-card border border-border rounded-sm shadow-2xl w-[520px] max-w-[90vw] overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.2em] uppercase text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                    Update Cover Photo
                  </span>
                  <button type="button" onClick={handleCoverPreviewCancel} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="p-4 flex flex-col items-center gap-4">
                  <div className="w-full rounded-md overflow-hidden border border-border" style={{ aspectRatio: "3/1" }}>
                    <img loading="lazy" decoding="async" src={coverPreviewUrl} alt="Cover Preview" className="w-full h-full object-cover" />
                  </div>
                  <textarea
                    value={coverCaption}
                    onChange={(e) => setCoverCaption(e.target.value)}
                    placeholder="Say something about this cover photo…"
                    maxLength={200}
                    rows={2}
                    className="w-full bg-transparent border border-border rounded-sm p-3 text-sm resize-none focus:border-primary outline-none transition-colors"
                    style={{ fontFamily: "var(--font-body)" }}
                  />
                  <span className="text-[9px] text-muted-foreground self-end -mt-2">{coverCaption.length}/200</span>
                </div>
                <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
                  <button type="button" onClick={handleCoverPreviewCancel}
                    className="text-[10px] tracking-[0.15em] uppercase px-4 py-2 border border-border text-muted-foreground hover:text-foreground transition-colors rounded-sm"
                    style={{ fontFamily: "var(--font-heading)" }}>
                    Cancel
                  </button>
                  <button type="button" onClick={handleCoverConfirmUpload} disabled={uploadingCover}
                    className="text-[10px] tracking-[0.15em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-sm disabled:opacity-50 flex items-center gap-1.5"
                    style={{ fontFamily: "var(--font-heading)" }}>
                    {uploadingCover ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Camera className="h-3 w-3" />
                    )}
                    {uploadingCover ? "Uploading…" : "Save & Post"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Profile Picture */}
          <div className="flex items-center gap-6">
            <div className="relative group">
              {avatarUrl ? (
                <img loading="lazy" decoding="async" src={avatarUrl} alt="Profile" className="h-24 w-24 rounded-full object-cover border-2 border-border" />
              ) : (
                <div className="h-24 w-24 rounded-full bg-muted border-2 border-border flex items-center justify-center">
                  <User className="h-8 w-8 text-muted-foreground/40" />
                </div>
              )}
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingAvatar}
                className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                {uploadingAvatar ? <Loader2 className="h-5 w-5 text-primary-foreground animate-spin" /> : <Camera className="h-5 w-5 text-primary-foreground" />}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarFileSelect} className="hidden" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Profile Picture</span>
                <PrivacyToggle value={privacySettings.avatar || "public"} onChange={(v) => setFieldPrivacy("avatar", v)} />
              </div>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingAvatar}
                className="text-xs text-primary hover:underline transition-all duration-300" style={{ fontFamily: "var(--font-body)" }}>
                {uploadingAvatar ? "Uploading…" : "Change photo"}
              </button>
              <p className="text-[10px] text-muted-foreground mt-1" style={{ fontFamily: "var(--font-body)" }}>JPG, PNG or WebP. Max 5MB.</p>
            </div>
          </div>

          {/* Avatar Crop Modal */}
          {avatarCropSrc && (
            <ImageCropModal
              imageSrc={avatarCropSrc}
              onCropComplete={handleAvatarCropDone}
              onCancel={handleAvatarCropCancel}
              forcedAspect={1}
              targetWidth={400}
              targetHeight={400}
              circularCrop
            />
          )}

          {/* Avatar Preview + Caption Modal */}
          {showAvatarPreview && avatarPreviewUrl && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-card border border-border rounded-sm shadow-2xl w-[420px] max-w-[90vw] overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.2em] uppercase text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                    Update Profile Picture
                  </span>
                  <button type="button" onClick={handleAvatarPreviewCancel} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="p-6 flex flex-col items-center gap-4">
                  <img loading="lazy" decoding="async" src={avatarPreviewUrl} alt="Preview" className="h-36 w-36 rounded-full object-cover border-2 border-border" />
                  <textarea
                    value={avatarCaption}
                    onChange={(e) => setAvatarCaption(e.target.value)}
                    placeholder="Say something about this photo…"
                    maxLength={200}
                    rows={2}
                    className="w-full bg-transparent border border-border rounded-sm p-3 text-sm resize-none focus:border-primary outline-none transition-colors"
                    style={{ fontFamily: "var(--font-body)" }}
                  />
                  <span className="text-[9px] text-muted-foreground self-end -mt-2">{avatarCaption.length}/200</span>
                </div>
                <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
                  <button type="button" onClick={handleAvatarPreviewCancel}
                    className="text-[10px] tracking-[0.15em] uppercase px-4 py-2 border border-border text-muted-foreground hover:text-foreground transition-colors rounded-sm"
                    style={{ fontFamily: "var(--font-heading)" }}>
                    Cancel
                  </button>
                  <button type="button" onClick={handleAvatarConfirmUpload} disabled={uploadingAvatar}
                    className="text-[10px] tracking-[0.15em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-sm disabled:opacity-50 flex items-center gap-1.5"
                    style={{ fontFamily: "var(--font-heading)" }}>
                    {uploadingAvatar ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Camera className="h-3 w-3" />
                    )}
                    {uploadingAvatar ? "Uploading…" : "Save & Post"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bio */}
          <div>
            <div className="flex items-center gap-2 mb-0">
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Bio</label>
              <PrivacyToggle value={privacySettings.bio || "public"} onChange={(v) => setFieldPrivacy("bio", v)} />
            </div>
            <textarea value={bio} onChange={(e) => handleBioChange(e.target.value)} maxLength={500} rows={4}
              className={`w-full bg-transparent border ${errors.bio ? "border-destructive" : "border-border"} focus:border-primary outline-none p-4 text-sm transition-colors duration-500 resize-none`}
              placeholder="Tell us about yourself..." style={{ fontFamily: "var(--font-body)" }} />
            <div className="flex justify-between mt-1">
              {errors.bio ? <p className="text-[9px] text-destructive" style={{ fontFamily: "var(--font-heading)" }}>{errors.bio}</p> : <span />}
              <span className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>{bio.length}/500</span>
            </div>
          </div>

          {/* Row 1: Speaking Language + Full Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Speaking Language */}

            {/* Notification Settings Link */}
            <div>
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>
                <Bell className="inline h-3 w-3 mr-1.5" />Notifications
              </label>
              <Link
                to="/settings/notifications"
                className="flex items-center gap-3 py-3 text-sm text-primary hover:text-primary/80 transition-colors"
                style={{ fontFamily: "var(--font-body)" }}
              >
                Manage notification preferences →
              </Link>
            </div>

            {/* SOW §5.2 — Search engine privacy toggle */}
            <div className="border-t border-border pt-4">
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>
                <Globe className="inline h-3 w-3 mr-1.5" />Search Engine Visibility
              </label>
              <label className="flex items-start gap-3 py-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={indexingDisabled}
                  onChange={(e) => setIndexingDisabled(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-primary cursor-pointer"
                />
                <div className="flex-1">
                  <div className="text-sm text-foreground" style={{ fontFamily: "var(--font-body)" }}>
                    Hide my profile from search engines
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5" style={{ fontFamily: "var(--font-body)" }}>
                    When enabled, your public profile will not appear in Google, Bing, or other search engine results. Existing search listings may take a few weeks to disappear.
                  </div>
                </div>
              </label>
            </div>

          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Full Name */}
            <div>
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Full Name</label>
              <input type="text" value={fullName} onChange={(e) => handleFullNameChange(e.target.value)} maxLength={37}
                disabled={isAdmin}
                className={`${inputCls} ${errors.fullName ? "border-destructive" : ""} ${isAdmin ? "opacity-60 cursor-not-allowed" : ""}`} placeholder="Your full name" style={{ fontFamily: "var(--font-body)" }} />
              {isAdmin && <p className="text-[9px] text-muted-foreground mt-1" style={{ fontFamily: "var(--font-heading)" }}>Brand name is locked for admin accounts</p>}
              {errors.fullName && <p className="text-[9px] text-destructive mt-1" style={{ fontFamily: "var(--font-heading)" }}>{errors.fullName}</p>}
            </div>
          </div>

          {/* Row 2: Date of Birth + Visibility */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-5">
            {/* Date of Birth picker */}
            <div className="space-y-2">
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>
                <CalendarIcon className="inline h-3 w-3 mr-1.5" />Date of Birth
              </label>
              <Popover open={dobOpen} onOpenChange={setDobOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "w-full text-left border-b py-3 text-sm transition-colors duration-500 flex items-center justify-between",
                      dateOfBirth ? "border-border text-foreground" : "border-border text-muted-foreground"
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
                    onSelect={setDateOfBirth}
                    disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
                    captionLayout="dropdown-buttons"
                    fromYear={1940}
                    toYear={new Date().getFullYear()}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                  <div className="flex justify-end px-3 pb-3">
                    <button
                      type="button"
                      onClick={() => setDobOpen(false)}
                      className="px-4 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      OK
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
              {dateOfBirth && (
                <p className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                  Age: {differenceInYears(new Date(), dateOfBirth)} years
                </p>
              )}
            </div>

            {/* DOB Visibility options */}
            <div className="space-y-2">
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>
                Visibility Options
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground block mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>
                    Day & Month
                  </span>
                  <select
                    value={dobDayMonthPrivacy}
                    onChange={(e) => setDobDayMonthPrivacy(e.target.value as PrivacyLevel)}
                    className="w-full text-[10px] bg-background border border-border rounded-sm px-2 py-1.5"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    <option value="public">🌍 Public</option>
                    <option value="friends">👥 Friends only</option>
                    <option value="only_me">🔒 Only me</option>
                  </select>
                </div>
                <div>
                  <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground block mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>
                    Year
                  </span>
                  <select
                    value={dobYearPrivacy}
                    onChange={(e) => setDobYearPrivacy(e.target.value as PrivacyLevel)}
                    className="w-full text-[10px] bg-background border border-border rounded-sm px-2 py-1.5"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    <option value="public">🌍 Public</option>
                    <option value="friends">👥 Friends only</option>
                    <option value="only_me">🔒 Only me</option>
                  </select>
                </div>
              </div>
              <p className="text-[9px] text-muted-foreground/70" style={{ fontFamily: "var(--font-body)" }}>
                Control who can see your birthday — day/month and year separately.
              </p>
            </div>
          </div>

          {/* Custom Profile URL */}
          <div>
            <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>
              <Globe className="inline h-3 w-3 mr-1.5" />Custom Profile URL
            </label>
            <p className="text-[10px] text-muted-foreground mb-2" style={{ fontFamily: "var(--font-body)" }}>
              Choose a unique URL for your public profile. Leave empty to use the default.
            </p>
            <div className="flex items-center gap-0">
              <span className="text-[10px] text-muted-foreground py-3 pr-1 whitespace-nowrap" style={{ fontFamily: "var(--font-body)" }}>
                50mmretina.com/
              </span>
              <input
                type="text"
                value={customUrl}
                onChange={(e) => handleCustomUrlChange(e.target.value)}
                maxLength={50}
                className={`${inputCls} flex-1 ${errors.customUrl ? "border-destructive" : ""}`}
                placeholder="your-name"
                style={{ fontFamily: "var(--font-body)" }}
              />
              {checkingCustomUrl && (
                <span className="text-[9px] text-muted-foreground ml-2 animate-pulse" style={{ fontFamily: "var(--font-heading)" }}>
                  Checking…
                </span>
              )}
              {!checkingCustomUrl && customUrl.trim() && customUrlAvailable === true && !errors.customUrl && (
                <span className="text-[9px] text-primary ml-2" style={{ fontFamily: "var(--font-heading)" }}>
                  ✓ Available
                </span>
              )}
              {!checkingCustomUrl && customUrl.trim() && customUrlAvailable === false && (
                <span className="text-[9px] text-destructive ml-2" style={{ fontFamily: "var(--font-heading)" }}>
                  ✗ Taken
                </span>
              )}
            </div>
            {errors.customUrl && <p className="text-[9px] text-destructive mt-1" style={{ fontFamily: "var(--font-heading)" }}>{errors.customUrl}</p>}
            {urlSuggestions.length > 0 && (
              <div className="mt-2">
                <p className="text-[9px] text-muted-foreground mb-1" style={{ fontFamily: "var(--font-heading)" }}>Try one of these:</p>
                <div className="flex flex-wrap gap-1.5">
                  {urlSuggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleSuggestionClick(s)}
                      className="px-2.5 py-1 text-[9px] rounded-sm border border-border bg-muted/50 text-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
                      style={{ fontFamily: "var(--font-body)" }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Profile Intro Fields */}
          <div className="border border-border p-4 md:p-8">
            <span className={sectionHeadCls} style={{ fontFamily: "var(--font-heading)" }}>
              <User className="inline h-3 w-3 mr-2" />Profile Intro
            </span>
            <div className="space-y-5">
              <div>
                <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Pronouns</label>
                <input type="text" value={pronouns} onChange={(e) => setPronouns(e.target.value)} maxLength={30}
                  className={inputCls} placeholder="e.g. He/Him, She/Her, They/Them" style={{ fontFamily: "var(--font-body)" }} />
              </div>
              <div>
                <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Current City</label>
                <input type="text" value={currentCity} onChange={(e) => setCurrentCity(e.target.value)} maxLength={100}
                  className={inputCls} placeholder="Where you currently live" style={{ fontFamily: "var(--font-body)" }} />
              </div>
              <div>
                <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Workplace</label>
                <input type="text" value={workplace} onChange={(e) => setWorkplace(e.target.value)} maxLength={150}
                  className={inputCls} placeholder="Company or freelance" style={{ fontFamily: "var(--font-body)" }} />
              </div>
              <div>
                <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Education</label>
                <input type="text" value={education} onChange={(e) => setEducation(e.target.value)} maxLength={150}
                  className={inputCls} placeholder="School or university" style={{ fontFamily: "var(--font-body)" }} />
              </div>
            </div>

          </div>

          {/* Portfolio URL */}
          <div>
            <div className="flex items-center gap-2">
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Portfolio URL</label>
              <PrivacyToggle value={privacySettings.portfolio || "public"} onChange={(v) => setFieldPrivacy("portfolio", v)} />
            </div>
            <input type="url" value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} maxLength={255}
              className={inputCls} placeholder="https://your-portfolio.com" style={{ fontFamily: "var(--font-body)" }} />
          </div>

          {/* Address */}
          <div className="border border-border p-4 md:p-8">
            <div className="flex items-center justify-between mb-6">
              <span className={sectionHeadCls} style={{ fontFamily: "var(--font-heading)" }}>
                <MapPin className="inline h-3 w-3 mr-2" />Address
              </span>
              <PrivacyToggle value={privacySettings.city_country || "public"} onChange={(v) => setFieldPrivacy("city_country", v)} />
            </div>
            <div className="space-y-5">
              <div>
                <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Address Line 1</label>
                <input type="text" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} maxLength={200}
                  className={inputCls} placeholder="Street address" style={{ fontFamily: "var(--font-body)" }} />
              </div>
              <div>
                <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Address Line 2</label>
                <input type="text" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} maxLength={200}
                  className={inputCls} placeholder="Apartment, suite, etc." style={{ fontFamily: "var(--font-body)" }} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Country</label>
                  <select value={country} onChange={(e) => handleCountryChange(e.target.value)}
                    className={`${inputCls} bg-background`} style={{ fontFamily: "var(--font-body)" }}>
                    <option value="">Select country</option>
                    {availableCountries.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>State / Province</label>
                  <input type="text" value={state} onChange={(e) => setState(e.target.value)} maxLength={100}
                    className={inputCls} placeholder={country ? "Enter state" : "Select country first"} disabled={!country}
                    style={{ fontFamily: "var(--font-body)" }} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>City</label>
                  {availableCities.length > 0 ? (
                    <select value={city} onChange={(e) => setCity(e.target.value)}
                      className={`${inputCls} bg-background`} style={{ fontFamily: "var(--font-body)" }}>
                      <option value="">Select city</option>
                      {availableCities.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={city} onChange={(e) => setCity(e.target.value)} maxLength={100}
                      className={inputCls} placeholder={state ? "Enter city" : "Select state first"} disabled={!state && availableStates.length > 0}
                      style={{ fontFamily: "var(--font-body)" }} />
                  )}
                </div>
                <div>
                  <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Postal Code</label>
                  <input type="text" value={postalCode} onChange={(e) => handlePostalCodeChange(e.target.value)} maxLength={10}
                    className={`${inputCls} ${errors.postalCode ? "border-destructive" : ""}`} placeholder="Postal / ZIP code" style={{ fontFamily: "var(--font-body)" }} />
                  {errors.postalCode && (
                    <span className="text-[10px] text-destructive flex items-center gap-1 mt-1" style={{ fontFamily: "var(--font-body)" }}>
                      <AlertCircle className="h-3 w-3" /> {errors.postalCode}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Communication */}
          <div className="border border-border p-4 md:p-8">
            <div className="flex items-center justify-between mb-6">
              <span className={sectionHeadCls} style={{ fontFamily: "var(--font-heading)" }}>
                <Phone className="inline h-3 w-3 mr-2" />Communication
              </span>
              <PrivacyToggle value={privacySettings.phone || "only_me"} onChange={(v) => setFieldPrivacy("phone", v)} />
            </div>
            <div className="space-y-5">
              <div>
                <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Phone Number</label>
                <input type="tel" value={phone} onChange={(e) => handlePhoneChange(e.target.value)} maxLength={20}
                  className={`${inputCls} ${errors.phone ? "border-destructive" : ""}`} placeholder="+91 XXXXX XXXXX" style={{ fontFamily: "var(--font-body)" }} />
                {errors.phone && (
                  <span className="text-[10px] text-destructive flex items-center gap-1 mt-1" style={{ fontFamily: "var(--font-body)" }}>
                    <AlertCircle className="h-3 w-3" /> {errors.phone}
                  </span>
                )}
              </div>
              <div>
                <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>WhatsApp Number</label>
                <input type="tel" value={whatsapp} onChange={(e) => handleWhatsappChange(e.target.value)} maxLength={20}
                  className={`${inputCls} ${errors.whatsapp ? "border-destructive" : ""}`} placeholder="+91 XXXXX XXXXX" style={{ fontFamily: "var(--font-body)" }} />
                {errors.whatsapp && (
                  <span className="text-[10px] text-destructive flex items-center gap-1 mt-1" style={{ fontFamily: "var(--font-body)" }}>
                    <AlertCircle className="h-3 w-3" /> {errors.whatsapp}
                  </span>
                )}
              </div>
            </div>
          </div>


          {/* Other Links */}
          <div className="border border-border p-4 md:p-8">
            <div className="flex items-center justify-between mb-6">
              <span className={sectionHeadCls} style={{ fontFamily: "var(--font-heading)" }}>Other Links</span>
              <PrivacyToggle value={privacySettings.social_links || "public"} onChange={(v) => setFieldPrivacy("social_links", v)} />
            </div>
            <div className="space-y-5">
              {/* Facebook */}
              <div>
                <label className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                  <Facebook className="h-3 w-3" /> Facebook
                </label>
                <div className="flex items-center gap-0">
                  <span className="text-xs text-muted-foreground bg-muted border-b border-l border-t border-border px-3 py-3 whitespace-nowrap select-none" style={{ fontFamily: "var(--font-body)" }}>
                    https://www.facebook.com/
                  </span>
                  <input
                    type="text"
                    value={facebookUrl}
                    onChange={(e) => handleFacebookChange(e.target.value)}
                    maxLength={100}
                    className={`${inputCls} flex-1 ${errors.facebook ? "border-destructive" : ""}`}
                    placeholder="yourprofile"
                    style={{ fontFamily: "var(--font-body)" }}
                  />
                </div>
                {errors.facebook && (
                  <span className="text-[10px] text-destructive flex items-center gap-1 mt-1" style={{ fontFamily: "var(--font-body)" }}>
                    <AlertCircle className="h-3 w-3" /> {errors.facebook}
                  </span>
                )}
              </div>

              {/* Instagram */}
              <div>
                <label className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                  <Instagram className="h-3 w-3" /> Instagram
                </label>
                <div className="flex items-center gap-0">
                  <span className="text-xs text-muted-foreground bg-muted border-b border-l border-t border-border px-3 py-3 whitespace-nowrap select-none" style={{ fontFamily: "var(--font-body)" }}>
                    https://www.instagram.com/
                  </span>
                  <input
                    type="text"
                    value={instagramUrl}
                    onChange={(e) => handleInstagramChange(e.target.value)}
                    maxLength={30}
                    className={`${inputCls} flex-1 ${errors.instagram ? "border-destructive" : ""}`}
                    placeholder="yourhandle"
                    style={{ fontFamily: "var(--font-body)" }}
                  />
                </div>
                {errors.instagram && (
                  <span className="text-[10px] text-destructive flex items-center gap-1 mt-1" style={{ fontFamily: "var(--font-body)" }}>
                    <AlertCircle className="h-3 w-3" /> {errors.instagram}
                  </span>
                )}
              </div>

              {/* Twitter/X */}
              <div>
                <label className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                  <Twitter className="h-3 w-3" /> Twitter / X
                </label>
                <div className="flex items-center gap-0">
                  <span className="text-xs text-muted-foreground bg-muted border-b border-l border-t border-border px-3 py-3 whitespace-nowrap select-none" style={{ fontFamily: "var(--font-body)" }}>
                    https://x.com/
                  </span>
                  <input
                    type="text"
                    value={twitterUrl}
                    onChange={(e) => handleTwitterChange(e.target.value)}
                    maxLength={15}
                    className={`${inputCls} flex-1 ${errors.twitter ? "border-destructive" : ""}`}
                    placeholder="yourhandle"
                    style={{ fontFamily: "var(--font-body)" }}
                  />
                </div>
                {errors.twitter && (
                  <span className="text-[10px] text-destructive flex items-center gap-1 mt-1" style={{ fontFamily: "var(--font-body)" }}>
                    <AlertCircle className="h-3 w-3" /> {errors.twitter}
                  </span>
                )}
              </div>

              {/* YouTube */}
              <div>
                <label className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                  <Youtube className="h-3 w-3" /> YouTube
                </label>
                <div className="flex items-center gap-0">
                  <span className="text-xs text-muted-foreground bg-muted border-b border-l border-t border-border px-3 py-3 whitespace-nowrap select-none" style={{ fontFamily: "var(--font-body)" }}>
                    https://youtube.com/@
                  </span>
                  <input
                    type="text"
                    value={youtubeUrl}
                    onChange={(e) => handleYoutubeChange(e.target.value)}
                    maxLength={100}
                    className={`${inputCls} flex-1 ${errors.youtube ? "border-destructive" : ""}`}
                    placeholder="yourchannel"
                    style={{ fontFamily: "var(--font-body)" }}
                  />
                </div>
                {errors.youtube && (
                  <span className="text-[10px] text-destructive flex items-center gap-1 mt-1" style={{ fontFamily: "var(--font-body)" }}>
                    <AlertCircle className="h-3 w-3" /> {errors.youtube}
                  </span>
                )}
              </div>

              {/* Website */}
              <div>
                <label className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                  <Globe className="h-3 w-3" /> Website URL
                </label>
                <input type="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} maxLength={500}
                  className={inputCls} placeholder="https://yourwebsite.com" style={{ fontFamily: "var(--font-body)" }} />
              </div>
            </div>
          </div>

          {/* Photography Interests */}
          <div>
            <div className="flex items-center gap-2">
              <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Photography Interests</label>
              <PrivacyToggle value={privacySettings.interests || "public"} onChange={(v) => setFieldPrivacy("interests", v)} />
            </div>
            <div className="flex flex-wrap gap-2">
              {INTEREST_OPTIONS.map((interest) => {
                const selected = interests.includes(interest);
                return (
                  <button key={interest} type="button" onClick={() => toggleInterest(interest)}
                    className={`text-[11px] tracking-[0.1em] px-4 py-2 border transition-all duration-500 ${
                      selected ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-foreground/50"
                    }`} style={{ fontFamily: "var(--font-heading)" }}>
                    {interest}
                    {selected && <X className="inline h-3 w-3 ml-1.5 -mr-1" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Account Settings */}
          <div className="border border-border p-4 md:p-8">
            <span className={sectionHeadCls} style={{ fontFamily: "var(--font-heading)" }}>Account Settings</span>

            <div className="mb-6">
              <div className="flex items-center gap-2">
                <span className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Member Since</span>
                <PrivacyToggle value={privacySettings.member_since || "only_me"} onChange={(v) => setFieldPrivacy("member_since", v)} />
              </div>
              <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                Control whether your join date is visible on your public profile.
              </p>
            </div>

            <div className="mb-6">
              <div className="flex items-center gap-2">
                <span className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Email Address</span>
                <PrivacyToggle value={privacySettings.email || "only_me"} onChange={(v) => setFieldPrivacy("email", v)} />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                <span style={{ fontFamily: "var(--font-body)" }}>{user?.email}</span>
                <span className="text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 border border-border text-muted-foreground/60 ml-2" style={{ fontFamily: "var(--font-heading)" }}>
                  Registered
                </span>
              </div>
            </div>
            <div>
              <span className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>Password</span>
              <p className="text-xs text-muted-foreground mb-3" style={{ fontFamily: "var(--font-body)" }}>
                We'll send a password reset link to your email address.
              </p>
              <button type="button" onClick={handlePasswordReset} disabled={sendingReset}
                className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 border border-border hover:border-primary hover:text-primary transition-all duration-500 disabled:opacity-50"
                style={{ fontFamily: "var(--font-heading)" }}>
                <KeyRound className="h-3 w-3" />
                {sendingReset ? "Sending…" : "Send Reset Link"}
              </button>
            </div>
          </div>

          {/* Auto-save status indicator */}
          <div className="flex items-center gap-3 pt-4 border-t border-border">
            <div className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>
              {saveStatus === "saving" && (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground">Saving...</span>
                </>
              )}
              {saveStatus === "saved" && (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-green-500">Saved</span>
                </>
              )}
              {saveStatus === "error" && (
                <>
                  <CloudOff className="h-3.5 w-3.5 text-destructive" />
                  <span className="text-destructive">Fix errors to save</span>
                </>
              )}
              {saveStatus === "idle" && (
                <>
                  <Cloud className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <span className="text-muted-foreground/50">Auto-saved</span>
                </>
              )}
            </div>
            <div className="flex-1" />
            <Link to="/dashboard"
              className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors duration-500"
              style={{ fontFamily: "var(--font-heading)" }}>
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
};

export default EditProfile;
