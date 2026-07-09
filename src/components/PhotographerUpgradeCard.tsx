import { useState } from "react";
import { Camera, CheckCircle, Globe } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { Input } from "@/components/ui/input";

interface Props {
  onUpgraded: () => void;
}

const PhotographerUpgradeCard = ({ onUpgraded }: Props) => {
  const { user } = useAuth();
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleUpgrade = async () => {
    if (!user) return;

    const web = websiteUrl.trim();

    if (!web) {
      toast({ title: "Please provide your website or portfolio link", variant: "destructive" });
      return;
    }

    setSubmitting(true);

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ website_url: web || null })
      .eq("id", user.id);

    if (profileError) {
      toast({ title: "Failed to save links", description: profileError.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    const { error: roleError } = await supabase
      .from("user_roles")
      .insert({ user_id: user.id, role: "registered_photographer" as any });

    if (roleError && !roleError.message.includes("duplicate")) {
      toast({ title: "Failed to upgrade", description: roleError.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    toast({ title: "🎉 You're now a Registered Photographer!", description: "You can now submit to competitions and build your portfolio." });
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
          Become a Registered Photographer
        </span>
      </div>

      <p className="text-sm text-muted-foreground mb-6 leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
        Submit your website or portfolio link to verify yourself as a photographer.
        This unlocks competition submissions and a verified public portfolio.
      </p>

      <div className="space-y-4 mb-6">
        <div>
          <label className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>
            <Globe className="h-3 w-3" /> Website / Portfolio URL
          </label>
          <Input
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
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
          <span className="animate-pulse">Verifying…</span>
        ) : (
          <>
            <CheckCircle className="h-3.5 w-3.5" />
            Upgrade to Photographer
          </>
        )}
      </button>
    </div>
  );
};

export default PhotographerUpgradeCard;
