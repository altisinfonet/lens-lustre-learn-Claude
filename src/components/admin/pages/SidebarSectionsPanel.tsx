import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, Save, LayoutDashboard } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { User } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";

const headingFont = { fontFamily: "var(--font-heading)" } as const;
const bodyFont = { fontFamily: "var(--font-body)" } as const;

interface Props {
  user: User | null;
}

export default function SidebarSectionsPanel({ user }: Props) {
  const [sidebarSections, setSidebarSections] = useState({
    sponsored: true,
    people_you_may_know: true,
    vote_and_earn: true,
    trending: true,
    competitions: true,
    courses: true,
    milestones: true,
    journal: true,
    winners: true,
    todays_birthday: true,
  });
  const [savingSidebar, setSavingSidebar] = useState(false);

  useEffect(() => {
    supabase
      .from("site_settings")
      .select("value")
      .eq("key", "sidebar_sections")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value && typeof data.value === "object") {
          setSidebarSections((prev) => ({ ...prev, ...(data.value as Record<string, boolean>) }));
        }
      });
  }, []);

  const saveSidebarSections = async () => {
    if (!user) return;
    setSavingSidebar(true);
    const { error } = await supabase
      .from("site_settings")
      .upsert({
        key: "sidebar_sections",
        value: sidebarSections as unknown as Json,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    setSavingSidebar(false);
    if (error) {
      toast({ title: "Failed to save sidebar settings", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Sidebar sections saved" });
    }
  };

  const RIGHT_SECTIONS = [
    { key: "sponsored" as const, label: "Sponsored ads" },
    { key: "people_you_may_know" as const, label: "People you may know" },
    { key: "competitions" as const, label: "Competitions" },
    { key: "courses" as const, label: "Recent courses" },
    { key: "winners" as const, label: "Winners of the competition" },
  ];

  const LEFT_SECTIONS = [
    { key: "vote_and_earn" as const, label: "Vote & earn" },
    { key: "trending" as const, label: "Trending this week" },
    { key: "milestones" as const, label: "Membership anniversaries" },
    { key: "journal" as const, label: "Latest from journal" },
    { key: "todays_birthday" as const, label: "Today's birthday" },
  ];

  return (
    <>
      <div className="border border-border rounded-sm mt-8">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4 text-primary" />
          <h3 className="text-xs tracking-[0.15em] uppercase font-semibold" style={headingFont}>Right column sections</h3>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed" style={bodyFont}>
            Toggle which sections appear in the right sidebar on internal pages.
          </p>
          {RIGHT_SECTIONS.map((item) => (
            <div key={item.key} className="flex items-center justify-between py-1">
              <span className="text-xs" style={bodyFont}>{item.label}</span>
              <Switch checked={sidebarSections[item.key]} onCheckedChange={(checked) => setSidebarSections((prev) => ({ ...prev, [item.key]: checked }))} />
            </div>
          ))}
        </div>
      </div>

      <div className="border border-border rounded-sm mt-6">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4 text-primary" />
          <h3 className="text-xs tracking-[0.15em] uppercase font-semibold" style={headingFont}>Left column sections</h3>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed" style={bodyFont}>
            Toggle which sections appear in the left sidebar on internal pages.
          </p>
          {LEFT_SECTIONS.map((item) => (
            <div key={item.key} className="flex items-center justify-between py-1">
              <span className="text-xs" style={bodyFont}>{item.label}</span>
              <Switch checked={sidebarSections[item.key]} onCheckedChange={(checked) => setSidebarSections((prev) => ({ ...prev, [item.key]: checked }))} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button onClick={saveSidebarSections} disabled={savingSidebar}
          className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-5 py-2.5 border border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          style={headingFont}>
          {savingSidebar ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save Sidebar Settings
        </button>
      </div>
    </>
  );
}
