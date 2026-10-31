import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { SmtpSettings, WhatsAppSettings, SocialMediaLinks, S3StorageSettings, AiModelSettings } from "./settings/SettingsTypes";
import { defaultSmtp, defaultWhatsApp, defaultSocial, defaultS3, defaultAi } from "./settings/SettingsTypes";
import EmailSettingsSection from "./settings/EmailSettingsSection";
import WhatsAppSettingsSection from "./settings/WhatsAppSettingsSection";
import StorageSettingsSection from "./settings/StorageSettingsSection";
import AiModelSection from "./settings/AiModelSection";
import SocialMediaSection from "./settings/SocialMediaSection";

interface Props {
  user: User | null;
}

export default function AdminSettings({ user }: Props) {
  const [smtp, setSmtp] = useState<SmtpSettings>(defaultSmtp);
  const [whatsapp, setWhatsapp] = useState<WhatsAppSettings>(defaultWhatsApp);
  const [s3, setS3] = useState<S3StorageSettings>(defaultS3);
  const [social, setSocial] = useState<SocialMediaLinks>(defaultSocial);
  const [ai, setAi] = useState<AiModelSettings>(defaultAi);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSettings = async () => {
      const { data, error } = await supabase.functions.invoke("admin-secure-settings", {
        body: { action: "read" },
      });

      if (!error && data?.settings) {
        const settings = data.settings;
        if (settings.smtp_settings) setSmtp({ ...defaultSmtp, ...settings.smtp_settings });
        if (settings.whatsapp_settings) setWhatsapp({ ...defaultWhatsApp, ...settings.whatsapp_settings });
        if (settings.s3_storage_settings) setS3({ ...defaultS3, ...settings.s3_storage_settings });
        if (settings.ai_model_settings) setAi({ ...defaultAi, ...settings.ai_model_settings });
      }

      const { data: publicData } = await supabase
        .from("site_settings")
        .select("key, value")
        .in("key", ["social_media_links"]);

      if (publicData) {
        for (const row of publicData) {
          if (row.key === "social_media_links") {
            setSocial({ ...defaultSocial, ...(row.value as unknown as Partial<SocialMediaLinks>) });
          }
        }
      }
      setLoading(false);
    };
    fetchSettings();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-20 justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>Loading settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-px bg-primary" />
          <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>Configuration</span>
        </div>
        <h2 className="text-2xl md:text-3xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          Integration <em className="italic text-primary">Settings</em>
        </h2>
        <p className="text-xs text-muted-foreground mt-2 max-w-md" style={{ fontFamily: "var(--font-body)" }}>
          Configure SMTP email and WhatsApp API credentials for notifications and messaging.
        </p>
      </div>

      <EmailSettingsSection user={user} smtp={smtp} setSmtp={setSmtp} />
      <WhatsAppSettingsSection user={user} whatsapp={whatsapp} setWhatsapp={setWhatsapp} />
      <StorageSettingsSection user={user} s3={s3} setS3={setS3} />
      <AiModelSection user={user} ai={ai} setAi={setAi} />
      <SocialMediaSection user={user} social={social} setSocial={setSocial} />

      <div className="border border-border/50 rounded-sm px-5 py-4 bg-muted/20">
        <p className="text-[11px] text-muted-foreground leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
          <strong className="text-foreground">Note:</strong> These credentials are stored securely and used by the platform for sending email notifications and WhatsApp messages. 
          Make sure to test your configurations after saving. Changes take effect immediately.
        </p>
      </div>
    </div>
  );
}
