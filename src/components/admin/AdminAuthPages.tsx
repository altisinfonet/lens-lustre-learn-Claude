import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSiteLogo } from "@/hooks/core/useSiteLogo";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, Save, Eye } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { AuthPageConfig, AuthPageSettings } from "@/hooks/core/useAuthPageSettings";
import { DEFAULT_AUTH_SETTINGS } from "@/hooks/core/useAuthPageSettings";

const headingFont = { fontFamily: "var(--font-heading)" };

function PageConfigEditor({
  label,
  config,
  onChange,
}: {
  label: string;
  config: AuthPageConfig;
  onChange: (c: AuthPageConfig) => void;
}) {
  const siteLogo = useSiteLogo();

  const update = (partial: Partial<AuthPageConfig>) => onChange({ ...config, ...partial });

  return (
    <div className="space-y-5">
      {/* Background image note */}
      <div className="border border-border/50 rounded-sm p-3 bg-muted/10">
        <p className="text-[10px] text-muted-foreground" style={headingFont}>
          Background images are managed in <span className="text-primary">Content → On-Page Images</span> section.
        </p>
      </div>

      {/* Heading Text */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1.5" style={headingFont}>
            Heading Text
          </label>
          <input
            type="text"
            value={config.heading}
            onChange={(e) => update({ heading: e.target.value })}
            className="w-full text-sm px-3 py-2.5 border border-border bg-transparent text-foreground focus:outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1.5" style={headingFont}>
            Accent Text <span className="normal-case text-primary">(italic)</span>
          </label>
          <input
            type="text"
            value={config.heading_accent}
            onChange={(e) => update({ heading_accent: e.target.value })}
            className="w-full text-sm px-3 py-2.5 border border-border bg-transparent text-foreground focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Subtitle */}
      <div>
        <label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1.5" style={headingFont}>
          Subtitle
        </label>
        <input
          type="text"
          value={config.subtitle}
          onChange={(e) => update({ subtitle: e.target.value })}
          className="w-full text-sm px-3 py-2.5 border border-border bg-transparent text-foreground focus:outline-none focus:border-primary"
        />
      </div>

      {/* Logo Settings */}
      <div className="border border-border/50 rounded-sm p-4 space-y-4 bg-muted/10">
        <div className="flex items-center justify-between">
          <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={headingFont}>
            Show Logo
          </span>
          <Switch checked={config.show_logo} onCheckedChange={(v) => update({ show_logo: v })} />
        </div>
        {config.show_logo && (
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-2" style={headingFont}>
              Logo Size: <span className="text-primary">{config.logo_size}px</span>
            </label>
            <Slider
              min={24}
              max={96}
              step={4}
              value={[config.logo_size]}
              onValueChange={([v]) => update({ logo_size: v })}
            />
          </div>
        )}
      </div>

      {/* OAuth Toggles */}
      <div className="border border-border/50 rounded-sm p-4 space-y-3 bg-muted/10">
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block" style={headingFont}>
          Sign-in Methods
        </span>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Google Sign In</span>
          <Switch checked={config.show_google} onCheckedChange={(v) => update({ show_google: v })} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Apple Sign In</span>
          <Switch checked={config.show_apple} onCheckedChange={(v) => update({ show_apple: v })} />
        </div>
      </div>

      {/* Preview */}
      <div className="border border-border/50 rounded-sm overflow-hidden bg-muted/10">
        <div className="px-4 py-2 border-b border-border/50">
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={headingFont}>
            <Eye className="h-3 w-3 inline mr-1.5" />Live Preview
          </span>
        </div>
        <div className="flex">
          {/* Mini background preview */}
          <div className="w-1/3 h-40 bg-muted/30 relative overflow-hidden">
            {config.background_image && (
              <img src={config.background_image} alt="" className="w-full h-full object-cover opacity-80" />
            )}
          </div>
          {/* Mini content preview */}
          <div className="w-2/3 p-4 flex flex-col items-center justify-center text-center">
            {config.show_logo && (
              <div
                className="rounded-full bg-muted/30 mb-2 flex items-center justify-center overflow-hidden"
                style={{ width: config.logo_size * 0.5, height: config.logo_size * 0.5 }}
              >
                <img src={siteLogo} alt="" className="w-full h-full object-contain" />
              </div>
            )}
            <p className="text-xs font-light">
              {config.heading} <em className="text-primary italic">{config.heading_accent}</em>
            </p>
            <p className="text-[8px] text-muted-foreground mt-0.5">{config.subtitle}</p>
            <div className="mt-2 space-y-1 w-full max-w-[120px]">
              {config.show_google && (
                <div className="text-[7px] bg-foreground text-background py-1 rounded-sm text-center">Google</div>
              )}
              {config.show_apple && (
                <div className="text-[7px] border border-foreground/30 py-1 rounded-sm text-center">Apple</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminAuthPages({ user }: { user: any }) {
  const qc = useQueryClient();
  const [settings, setSettings] = useState<AuthPageSettings>(DEFAULT_AUTH_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "auth_page_settings")
        .maybeSingle();
      if (data?.value) {
        const val = data.value as unknown as AuthPageSettings;
        setSettings({
          login: { ...DEFAULT_AUTH_SETTINGS.login, ...val.login },
          signup: { ...DEFAULT_AUTH_SETTINGS.signup, ...val.signup },
        });
      }
      setLoaded(true);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert(
      { key: "auth_page_settings", value: settings as any, updated_by: user?.id },
      { onConflict: "key" }
    );
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      qc.setQueryData(["site-setting", "auth_page_settings"], settings);
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: "Auth page settings saved" });
    }
    setSaving(false);
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3
          className="text-[11px] tracking-[0.2em] uppercase text-foreground mb-1"
          style={headingFont}
        >
          Login & Signup Pages
        </h3>
        <p className="text-[10px] text-muted-foreground">
          Customize background images, headings, logo visibility, and OAuth buttons for authentication pages.
        </p>
      </div>

      <Tabs defaultValue="login" className="w-full">
        <TabsList className="bg-muted/30 border border-border/50 p-0.5">
          <TabsTrigger value="login" className="text-[10px] tracking-[0.15em] uppercase" style={headingFont}>
            Login Page
          </TabsTrigger>
          <TabsTrigger value="signup" className="text-[10px] tracking-[0.15em] uppercase" style={headingFont}>
            Signup Page
          </TabsTrigger>
        </TabsList>

        <TabsContent value="login" className="mt-4">
          <PageConfigEditor
            label="Login"
            config={settings.login}
            onChange={(c) => setSettings((s) => ({ ...s, login: c }))}
          />
        </TabsContent>

        <TabsContent value="signup" className="mt-4">
          <PageConfigEditor
            label="Signup"
            config={settings.signup}
            onChange={(c) => setSettings((s) => ({ ...s, signup: c }))}
          />
        </TabsContent>
      </Tabs>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-5 py-2.5 border border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          style={headingFont}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save Auth Pages
        </button>
      </div>
    </div>
  );
}
