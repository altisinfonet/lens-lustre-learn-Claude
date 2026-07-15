import { Link, useNavigate } from "react-router-dom";
import { Camera, Copy, Check, Edit2, ExternalLink, Globe, KeyRound, Lock, Mail, MapPin, MessageSquare, Phone, Share2, Users } from "lucide-react";
import AvatarCompletionRing from "@/components/AvatarCompletionRing";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { useProfileMap } from "@/hooks/profile/useProfileMap";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { toast } from "@/hooks/core/use-toast";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { getAdminIds, resolveBadges, isAdminUser } from "@/lib/adminBrand";
import { useIsMobile } from "@/hooks/core/use-mobile";
import { getCaptchaToken } from "@/lib/turnstile";

interface ProfileData {
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  portfolio_url: string | null;
  photography_interests: string[] | null;
  created_at: string;
  [key: string]: any;
}

const Profile = () => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [sendingReset, setSendingReset] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"about" | "settings">("about");
  const { data: profileCore, isLoading: profileLoading } = useProfileCore(user?.id);
  const profile = profileCore as (ProfileData | null);
  const { profileMap, isLoading: badgesLoading } = useProfileMap(user ? [user.id] : []);
  const userBadges = useMemo(() => {
    if (!user) return [];
    const entry = profileMap[user.id];
    return entry?.badges || [];
  }, [user, profileMap]);
  const loading = profileLoading || badgesLoading;
  const coverUrl = profile?.cover_url || null;

  const handlePasswordReset = async () => {
    if (!user?.email) return;
    setSendingReset(true);
    const captchaToken = await getCaptchaToken(); // BUG-043
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
      captchaToken,
    });
    setSendingReset(false);
    if (error) {
      toast({ title: "Failed to send reset email", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Password reset email sent", description: "Check your inbox for the reset link." });
    }
  };
  if (authLoading || loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={{ fontFamily: "var(--font-heading)" }}>
          Loading...
        </div>
      </main>
    );
  }

  const displayName = profile?.full_name || "Photographer";
  const avatarUrl = profile?.avatar_url || null;
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  const profileUrl = (profile as any)?.custom_url
    ? `${window.location.origin}/${(profile as any).custom_url}`
    : `${window.location.origin}/profile/${user?.id}`;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(profileUrl);
    setCopied(true);
    toast({ title: "Profile URL copied!" });
    setTimeout(() => setCopied(false), 2000);
  };

  /* ── MOBILE: Facebook App-style ── */
  if (isMobile) {
    return (
      <main className="min-h-screen bg-background text-foreground pb-20">
        {/* Cover area + Avatar */}
        <div className="relative w-full overflow-hidden" style={{ aspectRatio: "3/1" }}>
          {coverUrl ? (
            <img loading="eager" decoding="async" fetchPriority="high" src={coverUrl} alt="Cover" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-muted/40" />
          )}
          <div className="absolute -bottom-10 left-4">
            {profile ? (
              <AvatarCompletionRing profile={profile} avatarUrl={avatarUrl} displayName={displayName} size={80} />
            ) : (
              <div className="h-20 w-20 rounded-full bg-muted border-2 border-background flex items-center justify-center">
                <Camera className="h-6 w-6 text-muted-foreground/40" />
              </div>
            )}
          </div>
        </div>

        {/* Name + badges area */}
        <div className="pt-12 px-4 pb-2">
          <div>
            <UserIdentityBlock
              userId={user?.id || ""}
              name={displayName}
              size="full"
              nameClassName="text-base font-semibold leading-tight truncate"
            />
          </div>
          {memberSince && (
            <p className="text-[11px] text-muted-foreground mt-0.5" style={{ fontFamily: "var(--font-body)" }}>
              Member since {memberSince}
            </p>
          )}
          {profile?.bio && (
            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2" style={{ fontFamily: "var(--font-body)" }}>
              {profile.bio}
            </p>
          )}
        </div>

        {/* Action buttons row */}
        <div className="px-4 pb-3 flex gap-2">
          <Link to="/edit-profile" className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-medium py-2 bg-muted/60 border border-border rounded-lg transition-colors" style={{ fontFamily: "var(--font-heading)" }}>
            <Edit2 className="h-3 w-3" /> Edit Profile
          </Link>
          <Link to={(profile as any)?.custom_url ? `/${(profile as any).custom_url}?section=wall` : `/profile/${user?.id}?section=wall`} className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-medium py-2 bg-muted/60 border border-border rounded-lg transition-colors" style={{ fontFamily: "var(--font-heading)" }}>
            <MessageSquare className="h-3 w-3" /> My Wall
          </Link>
          <Link to="/friends" className="flex items-center justify-center gap-1.5 text-[11px] font-medium py-2 px-3 bg-muted/60 border border-border rounded-lg transition-colors" style={{ fontFamily: "var(--font-heading)" }}>
            <Users className="h-3 w-3" />
          </Link>
          <button onClick={handleCopyUrl} className="flex items-center justify-center py-2 px-3 bg-muted/60 border border-border rounded-lg transition-colors">
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Share2 className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        </div>

        {/* Compact tabs */}
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border">
          <div className="flex">
            {(["about", "settings"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2.5 text-[11px] font-medium uppercase tracking-wider text-center transition-colors relative ${activeTab === tab ? "text-primary" : "text-muted-foreground"}`}
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {tab === "about" ? "About" : "Settings"}
                {activeTab === tab && (
                  <motion.div layoutId="profileTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {activeTab === "about" && (
          <div className="px-4 py-3 space-y-3">
            {/* Details card */}
            <div className="bg-card border border-border rounded-xl p-3 space-y-2.5">
              <h3 className="text-xs font-semibold" style={{ fontFamily: "var(--font-heading)" }}>Details</h3>

              {user?.email && (
                <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate" style={{ fontFamily: "var(--font-body)" }}>{user.email}</span>
                  <span className="text-[8px] uppercase px-1.5 py-0.5 border border-border rounded text-muted-foreground/50 ml-auto flex-shrink-0">
                    <Lock className="h-2.5 w-2.5 inline mr-0.5" />Private
                  </span>
                </div>
              )}
              {(profile?.current_city || (profile as any)?.city) && (
                <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                  <span style={{ fontFamily: "var(--font-body)" }}>{[profile?.current_city || (profile as any)?.city, (profile as any)?.state, (profile as any)?.country].filter(Boolean).join(", ")}</span>
                </div>
              )}
              {profile?.phone && (
                <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                  <span style={{ fontFamily: "var(--font-body)" }}>{profile.phone}</span>
                </div>
              )}
              {profile?.portfolio_url && (
                <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <Globe className="h-3.5 w-3.5 flex-shrink-0" />
                  <a href={profile.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-primary truncate" style={{ fontFamily: "var(--font-body)" }}>
                    {profile.portfolio_url.replace(/^https?:\/\//, "")}
                  </a>
                </div>
              )}
            </div>

            {/* Bio card */}
            {profile?.bio && (
              <div className="bg-card border border-border rounded-xl p-3">
                <h3 className="text-xs font-semibold mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>Bio</h3>
                <p className="text-xs text-muted-foreground leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>{profile.bio}</p>
              </div>
            )}

            {/* Interests */}
            {profile?.photography_interests && profile.photography_interests.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-3">
                <h3 className="text-xs font-semibold mb-2" style={{ fontFamily: "var(--font-heading)" }}>Photography Interests</h3>
                <div className="flex flex-wrap gap-1.5">
                  {profile.photography_interests.map(interest => (
                    <span key={interest} className="text-[10px] px-2.5 py-1 bg-muted/50 border border-border rounded-full text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                      {interest}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Public profile link */}
            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Share2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <span className="text-[10px] text-muted-foreground truncate" style={{ fontFamily: "var(--font-heading)" }}>
                    {(profile as any)?.custom_url ? `50mmretina.com/${(profile as any).custom_url}` : "Public Profile"}
                  </span>
                </div>
                <Link
                  to={(profile as any)?.custom_url ? `/${(profile as any).custom_url}` : `/profile/${user?.id}`}
                  className="text-[10px] text-primary font-medium flex-shrink-0 ml-2"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  View <ExternalLink className="h-2.5 w-2.5 inline ml-0.5" />
                </Link>
              </div>
            </div>

            {/* Empty state */}
            {!profile?.bio && !profile?.portfolio_url && (!profile?.photography_interests || profile.photography_interests.length === 0) && (
              <div className="bg-card border border-border rounded-xl p-6 text-center">
                <Camera className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground mb-3" style={{ fontFamily: "var(--font-body)" }}>
                  Complete your profile to let others know about your work.
                </p>
                <Link to="/edit-profile" className="inline-flex items-center gap-1.5 text-[11px] font-medium px-4 py-2 bg-primary text-primary-foreground rounded-lg" style={{ fontFamily: "var(--font-heading)" }}>
                  <Edit2 className="h-3 w-3" /> Complete Profile
                </Link>
              </div>
            )}
          </div>
        )}

        {activeTab === "settings" && (
          <div className="px-4 py-3 space-y-3">
            {/* Email card */}
            <div className="bg-card border border-border rounded-xl p-3">
              <h3 className="text-xs font-semibold mb-2" style={{ fontFamily: "var(--font-heading)" }}>Email Address</h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                <span style={{ fontFamily: "var(--font-body)" }}>{user?.email}</span>
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1" style={{ fontFamily: "var(--font-heading)" }}>Cannot be changed</p>
            </div>
            {/* Password card */}
            <div className="bg-card border border-border rounded-xl p-3">
              <h3 className="text-xs font-semibold mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>Password</h3>
              <p className="text-[10px] text-muted-foreground mb-2.5" style={{ fontFamily: "var(--font-body)" }}>
                We'll send a password reset link to your email.
              </p>
              <button
                onClick={handlePasswordReset}
                disabled={sendingReset}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium px-4 py-2 border border-border rounded-lg hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <KeyRound className="h-3 w-3" />
                {sendingReset ? "Sending…" : "Send Reset Link"}
              </button>
            </div>
          </div>
        )}

      </main>
    );
  }

  /* ── DESKTOP: Original layout ── */
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Desktop cover banner (read-only) */}
      <div className="relative max-w-5xl mx-auto rounded-b-xl overflow-hidden" style={{ aspectRatio: "3/1" }}>
        {coverUrl ? (
          <img loading="eager" decoding="async" fetchPriority="high" src={coverUrl} alt="Cover" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-muted/40" />
        )}
      </div>

      <div className="container mx-auto py-3 md:py-16 max-w-5xl">

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
        >
          {/* Avatar + Name header */}
          <div className="flex flex-col items-center gap-4 md:gap-8 mb-6 md:mb-16">
            <div className="flex flex-col md:flex-row items-center md:items-end gap-4 md:gap-8 w-full">
              {profile ? (
                <AvatarCompletionRing profile={profile} avatarUrl={avatarUrl} displayName={displayName} size={160} />
              ) : (
                <div className="h-40 w-40 rounded-full bg-muted border-2 border-border flex items-center justify-center">
                  <Camera className="h-12 w-12 text-muted-foreground/40" />
                </div>
              )}

              <div className="text-center md:text-left flex-1 min-w-0">
                <div className="flex items-center gap-4 mb-2 justify-center md:justify-start">
                  <div className="w-12 h-px bg-primary hidden md:block" />
                  <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>Profile</span>
                </div>
                <div className="mb-3">
                  <UserIdentityBlock
                    userId={user?.id || ""}
                    name={displayName}
                    size="full"
                    nameClassName="text-xl md:text-2xl font-light tracking-tight"
                  />
                </div>
                <div className="space-y-2">
                  {memberSince && (
                    <div className="flex items-center gap-2 justify-center md:justify-start text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                      <span>Member since {memberSince}</span>
                    </div>
                  )}
                  {user?.email && (
                    <div className="flex items-center gap-2 justify-center md:justify-start text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                      <Mail className="h-3 w-3" />
                      <span>{user.email}</span>
                      <span className="inline-flex items-center gap-1 text-[8px] tracking-[0.15em] uppercase px-2 py-0.5 border border-border text-muted-foreground/50 rounded-sm">
                        <Lock className="h-2.5 w-2.5" />Private
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 justify-center md:justify-start w-full">
              <Link to="/edit-profile" className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 border border-border hover:border-primary hover:text-primary transition-all duration-500" style={{ fontFamily: "var(--font-heading)" }}>
                <Edit2 className="h-3 w-3" /> Edit Profile
              </Link>
              <Link to={(profile as any)?.custom_url ? `/${(profile as any).custom_url}?section=wall` : `/profile/${user?.id}?section=wall`} className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 border border-border hover:border-primary hover:text-primary transition-all duration-500" style={{ fontFamily: "var(--font-heading)" }}>
                <MessageSquare className="h-3 w-3" /> My Wall
              </Link>
              <Link to="/friends" className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 border border-border hover:border-primary hover:text-primary transition-all duration-500" style={{ fontFamily: "var(--font-heading)" }}>
                <Users className="h-3 w-3" /> Friends
              </Link>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 w-full justify-center md:justify-start">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 border border-border rounded-sm max-w-full overflow-hidden">
                <Share2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <span className="text-[10px] tracking-[0.1em] text-muted-foreground truncate" style={{ fontFamily: "var(--font-heading)" }}>
                  {(profile as any)?.custom_url ? `50mmretina.com/${(profile as any).custom_url}` : `${window.location.origin}/profile/${user?.id}`}
                </span>
                <button onClick={handleCopyUrl} className="flex-shrink-0 p-1 hover:text-primary transition-colors duration-300" title="Copy profile URL">
                  {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
              </div>
              <Link to={(profile as any)?.custom_url ? `/${(profile as any).custom_url}` : `/profile/${user?.id}`} className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-primary hover:underline transition-all duration-300" style={{ fontFamily: "var(--font-heading)" }}>
                <ExternalLink className="h-3 w-3" />View Public Profile
              </Link>
            </div>
          </div>

          {profile?.city && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.8 }} className="mb-12">
              <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-4" style={{ fontFamily: "var(--font-heading)" }}>Location</span>
              <p className="text-sm text-muted-foreground flex items-center gap-2" style={{ fontFamily: "var(--font-body)" }}>
                <MapPin className="h-3.5 w-3.5" />{[profile.city, profile.state, profile.country].filter(Boolean).join(", ")}
              </p>
            </motion.div>
          )}

          {profile?.phone && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.8 }} className="mb-12">
              <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-4" style={{ fontFamily: "var(--font-heading)" }}>Contact</span>
              <p className="text-sm text-muted-foreground flex items-center gap-2" style={{ fontFamily: "var(--font-body)" }}>
                <Phone className="h-3.5 w-3.5" /> {profile.phone}
              </p>
            </motion.div>
          )}

          {profile?.bio && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.8 }} className="mb-12">
              <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-4" style={{ fontFamily: "var(--font-heading)" }}>About</span>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-xl" style={{ fontFamily: "var(--font-body)" }}>{profile.bio}</p>
            </motion.div>
          )}

          {profile?.portfolio_url && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.8 }} className="mb-12">
              <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-4" style={{ fontFamily: "var(--font-heading)" }}>Portfolio</span>
              <a href={profile.portfolio_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline transition-all duration-500" style={{ fontFamily: "var(--font-body)" }}>
                <Globe className="h-3.5 w-3.5" />{profile.portfolio_url.replace(/^https?:\/\//, "")}<ExternalLink className="h-3 w-3 opacity-50" />
              </a>
            </motion.div>
          )}

          {profile?.photography_interests && profile.photography_interests.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.8 }} className="mb-12">
              <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-4" style={{ fontFamily: "var(--font-heading)" }}>Photography Interests</span>
              <div className="flex flex-wrap gap-2">
                {profile.photography_interests.map((interest) => (
                  <span key={interest} className="text-[11px] tracking-[0.1em] px-4 py-2 border border-border text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                    {interest}
                  </span>
                ))}
              </div>
            </motion.div>
          )}

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.8 }} className="mb-12 border border-border p-8">
            <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-6" style={{ fontFamily: "var(--font-heading)" }}>Account Settings</span>
            <div className="mb-6">
              <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-heading)" }}>Email Address</span>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                <span style={{ fontFamily: "var(--font-body)" }}>{user?.email}</span>
                <span className="text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 border border-border text-muted-foreground/60 ml-2" style={{ fontFamily: "var(--font-heading)" }}>Cannot be changed</span>
              </div>
            </div>
            <div>
              <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-heading)" }}>Password</span>
              <p className="text-xs text-muted-foreground mb-3" style={{ fontFamily: "var(--font-body)" }}>We'll send a password reset link to your email address.</p>
              <button onClick={handlePasswordReset} disabled={sendingReset} className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 border border-border hover:border-primary hover:text-primary transition-all duration-500 disabled:opacity-50" style={{ fontFamily: "var(--font-heading)" }}>
                <KeyRound className="h-3 w-3" />{sendingReset ? "Sending…" : "Send Reset Link"}
              </button>
            </div>
          </motion.div>

          {!profile?.bio && !profile?.portfolio_url && (!profile?.photography_interests || profile.photography_interests.length === 0) && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.8 }} className="border border-border p-10 text-center">
              <Camera className="h-8 w-8 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-sm text-muted-foreground mb-4" style={{ fontFamily: "var(--font-body)" }}>Your profile is looking a little empty. Add a bio, portfolio, and interests to let others know about your work.</p>
              <Link to="/edit-profile" className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-6 py-3 bg-primary text-primary-foreground hover:opacity-90 transition-opacity duration-500" style={{ fontFamily: "var(--font-heading)" }}>
                <Edit2 className="h-3 w-3" /> Complete Your Profile
              </Link>
            </motion.div>
          )}
        </motion.div>
      </div>
    </main>
  );
};

export default Profile;
