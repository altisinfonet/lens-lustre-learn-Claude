import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, Save, Eye, EyeOff, Sparkles, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { AiModelSettings, SettingsSectionProps } from "./SettingsTypes";
import { AI_MODELS, inputClass, labelClass } from "./SettingsTypes";

interface Props extends SettingsSectionProps {
  ai: AiModelSettings;
  setAi: React.Dispatch<React.SetStateAction<AiModelSettings>>;
}

export default function AiModelSection({ user, ai, setAi }: Props) {
  const [savingAi, setSavingAi] = useState(false);
  const [showAiKey, setShowAiKey] = useState(false);

  const saveAi = async () => {
    if (!user) return;
    setSavingAi(true);
    const { data, error } = await supabase.functions.invoke("admin-secure-settings", {
      body: { action: "write", key: "ai_model_settings", value: ai },
    });
    setSavingAi(false);
    if (error || data?.error) {
      toast({ title: "Failed to save AI settings", description: error?.message || data?.error, variant: "destructive" });
    } else {
      toast({ title: "AI model settings saved", description: "Changes take effect immediately for all AI features." });
    }
  };

  return (
    <div className="border border-border rounded-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card/50">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium tracking-wide uppercase" style={{ fontFamily: "var(--font-heading)" }}>AI Model Configuration</h3>
      </div>
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-3 mb-2">
          <label className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Enable AI Features</label>
          <Switch checked={ai.enabled} onCheckedChange={(checked) => setAi({ ...ai, enabled: checked })} />
          <span className={`text-[9px] tracking-wider uppercase ${ai.enabled ? "text-primary" : "text-muted-foreground"}`} style={{ fontFamily: "var(--font-heading)" }}>
            {ai.enabled ? "Active" : "Disabled"}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
          Configure which AI models power features like image analysis, Ask Anything, and auto-suggestions.
        </p>

        {/* API Provider & Key */}
        <div className="border border-border/50 rounded-sm p-5 bg-muted/10 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] tracking-[0.15em] uppercase text-foreground font-medium" style={{ fontFamily: "var(--font-heading)" }}>API Provider & Key</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>API Provider</label>
              <select className={inputClass} value={ai.api_provider} onChange={(e) => setAi({ ...ai, api_provider: e.target.value as AiModelSettings["api_provider"] })}>
                <option value="lovable">Lovable Cloud (Built-in, no key needed)</option>
                <option value="google">Google AI (Custom API Key)</option>
                <option value="openai">OpenAI (Custom API Key)</option>
              </select>
              <p className="text-[9px] text-muted-foreground mt-1">
                {ai.api_provider === "lovable" && "Uses Lovable Cloud's built-in AI gateway — usage-based pricing, no setup required."}
                {ai.api_provider === "google" && "Use your own Google AI / Gemini API key from Google AI Studio."}
                {ai.api_provider === "openai" && "Use your own OpenAI API key from platform.openai.com."}
              </p>
            </div>
            {ai.api_provider !== "lovable" && (
              <div>
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>
                  {ai.api_provider === "google" ? "Google AI API Key" : "OpenAI API Key"}
                </label>
                <div className="relative">
                  <input className={inputClass + " pr-10"} type={showAiKey ? "text" : "password"}
                    placeholder={ai.api_provider === "google" ? "AIza..." : "sk-..."}
                    value={ai.custom_api_key} onChange={(e) => setAi({ ...ai, custom_api_key: e.target.value })} />
                  <button onClick={() => setShowAiKey(!showAiKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showAiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <p className="text-[9px] text-muted-foreground mt-1">
                  {ai.api_provider === "google" && "Get your key from aistudio.google.com → API Keys"}
                  {ai.api_provider === "openai" && "Get your key from platform.openai.com → API Keys"}
                </p>
              </div>
            )}
          </div>
          {ai.api_provider === "lovable" && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-sm bg-primary/5 border border-primary/20">
              <Info className="h-3 w-3 text-primary shrink-0 mt-0.5" />
              <p className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                Lovable Cloud provides built-in AI access with usage-based pricing. You get free monthly credits — check your balance in Settings → Cloud & AI balance.
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Image Analysis Model</label>
            <select className={inputClass} value={ai.image_analysis_model} onChange={(e) => setAi({ ...ai, image_analysis_model: e.target.value })}>
              {AI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <p className="text-[9px] text-muted-foreground mt-1">Used for gallery auto-categorization & title suggestions</p>
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Ask Anything Model</label>
            <select className={inputClass} value={ai.ask_anything_model} onChange={(e) => setAi({ ...ai, ask_anything_model: e.target.value })}>
              {AI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <p className="text-[9px] text-muted-foreground mt-1">Powers the conversational AI assistant</p>
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Primary Model (General)</label>
            <select className={inputClass} value={ai.primary_model} onChange={(e) => setAi({ ...ai, primary_model: e.target.value })}>
              {AI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <p className="text-[9px] text-muted-foreground mt-1">Default model for general AI tasks</p>
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Fallback Model</label>
            <select className={inputClass} value={ai.fallback_model} onChange={(e) => setAi({ ...ai, fallback_model: e.target.value })}>
              {AI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <p className="text-[9px] text-muted-foreground mt-1">Used when the primary model is unavailable</p>
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Max Tokens</label>
            <input type="number" className={inputClass} value={ai.max_tokens} min={50} max={4000}
              onChange={(e) => setAi({ ...ai, max_tokens: parseInt(e.target.value) || 200 })} />
            <p className="text-[9px] text-muted-foreground mt-1">Maximum response length (50–4000)</p>
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Temperature</label>
            <input type="number" className={inputClass} value={ai.temperature} min={0} max={2} step={0.1}
              onChange={(e) => setAi({ ...ai, temperature: parseFloat(e.target.value) || 0.7 })} />
            <p className="text-[9px] text-muted-foreground mt-1">Creativity level: 0 = deterministic, 1+ = more creative</p>
          </div>
        </div>

        {/* Model Reference Table */}
        <div className="border border-border/50 rounded-sm overflow-hidden mt-4">
          <div className="px-4 py-2 bg-muted/30 border-b border-border/50">
            <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Available Models Reference</span>
          </div>
          <div className="divide-y divide-border/30">
            {AI_MODELS.map(m => (
              <div key={m.id} className="px-4 py-2 flex items-center gap-3">
                <span className="text-[10px] font-medium text-foreground w-40 shrink-0" style={{ fontFamily: "var(--font-heading)" }}>{m.label}</span>
                <span className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>{m.desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button onClick={saveAi} disabled={savingAi}
            className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-5 py-2.5 border border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            style={{ fontFamily: "var(--font-heading)" }}>
            {savingAi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save AI Settings
          </button>
        </div>
      </div>
    </div>
  );
}
