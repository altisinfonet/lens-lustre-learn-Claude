import { useState } from "react";
import { Camera, CheckCircle, Globe } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/I18nContext";

interface Props {
  onUpgraded: () => void;
}

const PhotographerUpgradeCard = ({ onUpgraded }: Props) => {
  const t = useT();
  const { user } = useAuth();
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleUpgrade = async () => {
    if (!user) return;

    const web = websiteUrl.trim();

    if (!web) {
      toast({ title: t("pug.needLink"), variant: "destructive" });
      return;
    }

    setSubmitting(true);

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ website_url: web || null })
      .eq("id", user.id);

    if (profileError) {
      toast({ title: t("pug.saveLinksFailed"), description: profileError.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    const { error: roleError } = await supabase
      .from("user_roles")
      .insert({ user_id: user.id, role: "registered_photographer" as any });

    if (roleError && !roleError.message.includes("duplicate")) {
      toast({ title: t("pug.upgradeFailed"), description: roleError.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    toast({ title: t("pug.successTitle"), description: t("pug.successDesc") });
    setSubmitting(false);
    onUpgraded();
  };

  return (
    <div className="border border-primary/30 p-8 md:p-10 bg-primary/5">
      <div className="flex items-center gap-3 mb-4">
        <Camera className="h-5 w-5 text-primary" />
        <span
          className="text-[10px] tracking-[0.3em] uppercase text-primary"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {t("pug.heading")}
        </span>
      </div>

      <p className="text-sm text-muted-foreground mb-6 leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
        {t("pug.intro")}
      </p>

      <div className="space-y-4 mb-6">
        <div>
          <label className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>
            <Globe className="h-3 w-3" /> {t("pug.websiteLabel")}
          </label>
          <Input
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            // Deliberately NOT translated: this is a URL example. A non-Latin
            // placeholder would falsely imply a non-Latin URL is accepted.
            placeholder="https://yourportfolio.com"
            className="bg-transparent"
            maxLength={500}
          />
        </div>
      </div>

      <button
        onClick={handleUpgrade}
        disabled={submitting}
        className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-xs tracking-[0.2em] uppercase hover:opacity-90 transition-opacity duration-500 disabled:opacity-50"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {submitting ? (
          <span className="animate-pulse">{t("pug.verifying")}</span>
        ) : (
          <>
            <CheckCircle className="h-3.5 w-3.5" />
            {t("pug.upgradeCta")}
          </>
        )}
      </button>
    </div>
  );
};

export default PhotographerUpgradeCard;
