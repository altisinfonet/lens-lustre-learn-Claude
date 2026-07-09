import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, MessageCircle, Eye, EyeOff, Save } from "lucide-react";
import type { WhatsAppSettings, SettingsSectionProps } from "./SettingsTypes";
import { inputClass, labelClass } from "./SettingsTypes";

interface Props extends SettingsSectionProps {
  whatsapp: WhatsAppSettings;
  setWhatsapp: React.Dispatch<React.SetStateAction<WhatsAppSettings>>;
}

export default function WhatsAppSettingsSection({ user, whatsapp, setWhatsapp }: Props) {
  const [savingWa, setSavingWa] = useState(false);
  const [showWaSecret, setShowWaSecret] = useState(false);

  const saveWhatsApp = async () => {
    if (!user) return;
    setSavingWa(true);
    const { data, error } = await supabase.functions.invoke("admin-secure-settings", {
      body: { action: "write", key: "whatsapp_settings", value: whatsapp },
    });
    setSavingWa(false);
    if (error || data?.error) {
      toast({ title: "Failed to save WhatsApp settings", description: error?.message || data?.error, variant: "destructive" });
    } else {
      toast({ title: "WhatsApp settings saved" });
    }
  };

  return (
    <div className="border border-border rounded-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card/50">
        <MessageCircle className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium tracking-wide uppercase" style={{ fontFamily: "var(--font-heading)" }}>WhatsApp API Settings</h3>
      </div>
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Provider</label>
            <select className={inputClass} value={whatsapp.provider} onChange={(e) => setWhatsapp({ ...whatsapp, provider: e.target.value as WhatsAppSettings["provider"] })}>
              <option value="twilio">Twilio</option>
              <option value="meta">Meta (WhatsApp Business API)</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Phone Number</label>
            <input className={inputClass} placeholder="+1234567890" value={whatsapp.phone_number} onChange={(e) => setWhatsapp({ ...whatsapp, phone_number: e.target.value })} />
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>
              {whatsapp.provider === "twilio" ? "Account SID" : "App ID"}
            </label>
            <input className={inputClass} placeholder={whatsapp.provider === "twilio" ? "ACxxxxxxxx" : "App ID"} value={whatsapp.account_sid} onChange={(e) => setWhatsapp({ ...whatsapp, account_sid: e.target.value })} />
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>API Key / Token</label>
            <input className={inputClass} placeholder="API Key or Access Token" value={whatsapp.api_key} onChange={(e) => setWhatsapp({ ...whatsapp, api_key: e.target.value })} />
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>API Secret / Auth Token</label>
            <div className="relative">
              <input className={inputClass + " pr-10"} type={showWaSecret ? "text" : "password"} placeholder="••••••••" value={whatsapp.api_secret} onChange={(e) => setWhatsapp({ ...whatsapp, api_secret: e.target.value })} />
              <button onClick={() => setShowWaSecret(!showWaSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showWaSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Webhook URL (optional)</label>
            <input className={inputClass} placeholder="https://..." value={whatsapp.webhook_url} onChange={(e) => setWhatsapp({ ...whatsapp, webhook_url: e.target.value })} />
          </div>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button onClick={saveWhatsApp} disabled={savingWa}
            className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-5 py-2.5 border border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            style={{ fontFamily: "var(--font-heading)" }}>
            {savingWa ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save WhatsApp Settings
          </button>
        </div>
      </div>
    </div>
  );
}
