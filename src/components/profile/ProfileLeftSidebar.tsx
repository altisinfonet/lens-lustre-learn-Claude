import { useAuth } from "@/hooks/core/useAuth";
import FeaturedPhotos from "./FeaturedPhotos";
import ProfileIntro from "./ProfileIntro";
import QRCodeCard from "./QRCodeCard";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { Award } from "lucide-react";
import { Link } from "react-router-dom";
import { getPrivacy, canViewField, type PrivacyLevel } from "@/components/PrivacyToggle";
import PhotoAlbums from "./PhotoAlbums";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

interface Certificate {
  id: string;
  title: string;
  type: string;
  issued_at: string;
}

const ProfileLeftSidebar = () => {
  const { user } = useAuth();
  const { data: profile } = useProfileCore(user?.id);
  const [certificates, setCertificates] = useState<Certificate[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase.from("certificates").select("id, title, type, issued_at").eq("user_id", user.id).order("issued_at", { ascending: false }).limit(5).then(({ data }) => {
      setCertificates((data as any[]) || []);
    });
  }, [user]);

  if (!user) return null;

  const privacy = profile?.privacy_settings as Record<string, string> | null;
  const profileUrl = profile?.custom_url
    ? `${window.location.origin}/${profile.custom_url}`
    : `${window.location.origin}/profile/${user.id}`;
  const displayName = profile?.full_name || "Photographer";

  return (
    <div className="space-y-5">
      {/* Featured Photos - always public */}
      <FeaturedPhotos userId={user.id} isOwner={true} />

      {/* Photo Albums */}
      <PhotoAlbums userId={user.id} isOwner={true} />

      {/* Intro */}
      {profile && (
        <div className="border border-border bg-card/50 rounded-sm p-4 space-y-3">
          <h3 className="text-[9px] tracking-[0.3em] uppercase text-primary" style={headingFont}>
            Intro
          </h3>
          <ProfileIntro
            pronouns={profile.pronouns}
            currentCity={profile.current_city}
            workplace={profile.workplace}
            education={profile.education}
          />
          {!profile.pronouns && !profile.current_city && !profile.workplace && !profile.education && (
            <p className="text-[10px] text-muted-foreground" style={bodyFont}>
              Add details about yourself in{" "}
              <Link to="/edit-profile" className="text-primary hover:underline">Edit Profile</Link>
            </p>
          )}
        </div>
      )}

      {/* Certificates */}
      <div className="border border-border bg-card/50 rounded-sm">
        <div className="px-4 py-3 border-b border-border">
          <span className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5" style={headingFont}>
            <Award className="h-3 w-3" />
            Certificates
          </span>
        </div>
        {certificates.length > 0 ? (
          <div className="divide-y divide-border">
            {certificates.map((cert) => (
              <div key={cert.id} className="px-4 py-3">
                <p className="text-xs font-medium truncate" style={headingFont}>{cert.title}</p>
                <span className="text-[9px] text-muted-foreground" style={bodyFont}>
                  {cert.type} · {new Date(cert.issued_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 text-center">
            <p className="text-[10px] text-muted-foreground" style={bodyFont}>No certificates yet</p>
          </div>
        )}
        <div className="px-4 py-2 border-t border-border">
          <Link to="/certificates" className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={headingFont}>
            View All →
          </Link>
        </div>
      </div>

      {/* QR Profile Card - always public */}
      <QRCodeCard
        profileUrl={profileUrl}
        displayName={displayName}
        avatarUrl={profile?.avatar_url}
      />
    </div>
  );
};

export default ProfileLeftSidebar;
