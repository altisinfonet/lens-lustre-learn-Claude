import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, Save, Share2 } from "lucide-react";
import type { SocialMediaLinks, SettingsSectionProps } from "./SettingsTypes";
import { SOCIAL_FIELDS, inputClass } from "./SettingsTypes";
import type { Json } from "@/integrations/supabase/types";

interface Props extends SettingsSectionProps {
  social: SocialMediaLinks;
  setSocial: React.Dispatch<React.SetStateAction<SocialMediaLinks>>;
}

export default function SocialMediaSection({ user, social, setSocial }: Props) {
  const qc = useQueryClient();
  const [savingSocial, setSavingSocial] = useState(false);

  const saveSocial = async () => {
    if (!user) return;
    setSavingSocial(true);
    const { error } = await supabase
      .from("site_settings")
      .upsert({
        key: "social_media_links",
        value: social as unknown as Json,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    setSavingSocial(false);
    if (error) {
      toast({ title: "Failed to save social media links", description: error.message, variant: "destructive" });
    } else {
      qc.setQueryData(["site-setting", "social_media_links"], social);
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: "Social media links saved", description: "Links will now appear in the website footer." });
    }
  };

  return (
    <div className="border border-border rounded-sm overflow-hidden">
      <button type="button" className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/30 transition-colors" onClick={() => {}}>
        <div className="flex items-center gap-3">
          <Share2 className="h-4 w-4 text-primary" />
          <div>
            <span className="text-xs tracking-[0.15em] uppercase font-medium" style={{ fontFamily: "var(--font-heading)" }}>Social Media Links</span>
            <p className="text-[10px] text-muted-foreground mt-0.5" style={{ fontFamily: "var(--font-body)" }}>
              Add your social media URLs — they will appear in the website footer with icons
            </p>
          </div>
        </div>
      </button>

      <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {SOCIAL_FIELDS.map(({ key, label, icon: Icon, placeholder }) => (
            <div key={key}>
              <label className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-muted-foreground mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>
                <Icon className="h-3.5 w-3.5" />
                {label}
              </label>
              <input
                type="url"
                value={social[key]}
                onChange={(e) => setSocial((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full h-9 rounded-sm border border-input bg-background px-3 text-[11px] placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
                style={{ fontFamily: "var(--font-body)" }}
              />
            </div>
          ))}
        </div>

        {Object.values(social).some((v) => v.trim()) && (
          <div className="border border-border/50 rounded-sm px-4 py-3 bg-muted/20">
            <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-heading)" }}>Footer Preview</span>
            <div className="flex flex-wrap gap-3">
              {SOCIAL_FIELDS.filter(({ key }) => social[key].trim()).map(({ key, label, icon: Icon, hoverColor }) => (
                <a key={key} href={social[key]} target="_blank" rel="noopener noreferrer"
                  className={`p-2 rounded-full border border-border text-muted-foreground transition-all duration-300 ${hoverColor} hover:border-current hover:scale-110`}
                  title={label}>
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button onClick={saveSocial} disabled={savingSocial}
            className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-5 py-2.5 border border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            style={{ fontFamily: "var(--font-heading)" }}>
            {savingSocial ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save Social Links
          </button>
        </div>
      </div>
    </div>
  );
}
