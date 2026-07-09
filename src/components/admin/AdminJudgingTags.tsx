import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Tag, Plus, Trash2, Loader2, GripVertical, ToggleLeft, ToggleRight, Upload, X, Lock, ChevronDown, FileText } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";
import JudgingStampBadge, { STAMP_ICONS } from "@/components/JudgingStampBadge";
import SystemTagRequestForm from "@/components/admin/SystemTagRequestForm";

interface JudgingTag {
  id: string;
  label: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  icon: string;
  image_url: string | null;
  visible_in_round: number[];
  is_system?: boolean;
}

// Spec v3 Golden Rule #3: All judge-assignable tags live in Round 4 only.
// Custom (non-system) tags are hard-locked to R4 in the UI and enforced by a
// DB trigger (enforce_non_system_tags_round4). System tags retain their own
// fixed round set by migration and are not editable here.
const ROUND_OPTIONS = [
  { value: 4, label: "Round 4" },
];
const LOCKED_ROUND = 4;

interface Props {
  adminId: string;
}

const AdminJudgingTags = ({ adminId }: Props) => {
  const qc = useQueryClient();
  const [tags, setTags] = useState<JudgingTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#d4a017");
  const [newIcon, setNewIcon] = useState("award");
  const [newImageUrl, setNewImageUrl] = useState<string | null>(null);
  const [newSelectedRound] = useState<number>(LOCKED_ROUND);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingTagId, setUploadingTagId] = useState<string | null>(null);
  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  const fetchTags = async () => {
    // Spec v3: Admin editor shows ONLY user-curated R4 award tags.
    // System tags (R1 buttons, R2/R3 auto-tier outputs, Verification Required)
    // remain in DB and continue to power the judging pipeline, but are hidden
    // from the admin palette via the is_visible flag.
    const { data } = await supabase
      .from("judging_tags" as any)
      .select("id, label, color, sort_order, is_active, icon, image_url, visible_in_round, is_system")
      .eq("is_visible", true)
      .order("sort_order", { ascending: true });
    setTags((data as any as JudgingTag[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchTags();
  }, []);

  const handleImageUpload = async (file: File, tagId?: string) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Only image files allowed", variant: "destructive" });
      return null;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image must be under 5MB", variant: "destructive" });
      return null;
    }

    const ext = file.name.split(".").pop() || "png";
    const path = generateImagePath({ type: "judging-tag", ext });

    try {
      const result = await uploadImage({ bucket: "competition-photos", file, path, type: "judging-tag" });
      return result.url;
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      return null;
    }
  };

  const handleNewTagImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const url = await handleImageUpload(file);
    if (url) setNewImageUrl(url);
    setUploading(false);
    e.target.value = "";
  };

  const handleExistingTagImage = async (tagId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingTagId(tagId);
    const url = await handleImageUpload(file, tagId);
    if (url) {
      await supabase.from("judging_tags" as any).update({ image_url: url } as any).eq("id", tagId);
      setTags((prev) => prev.map((t) => (t.id === tagId ? { ...t, image_url: url } : t)));
      toast({ title: "Tag image updated" });
    }
    setUploadingTagId(null);
    e.target.value = "";
  };

  const removeExistingTagImage = async (tagId: string) => {
    await supabase.from("judging_tags" as any).update({ image_url: null } as any).eq("id", tagId);
    setTags((prev) => prev.map((t) => (t.id === tagId ? { ...t, image_url: null } : t)));
    toast({ title: "Tag image removed" });
  };

  const addTag = async () => {
    if (!newLabel.trim()) return;
    if (!newSelectedRound) {
      toast({ title: "Select exactly one round", variant: "destructive" });
      return;
    }
    const duplicate = tags.find((t) => t.label.toLowerCase() === newLabel.trim().toLowerCase());
    if (duplicate) {
      toast({ title: "Tag name already exists", description: `"${newLabel.trim()}" is already used. Choose a unique name.`, variant: "destructive" });
      return;
    }
    setAdding(true);
    const maxOrder = tags.length > 0 ? Math.max(...tags.map((t) => t.sort_order)) : 0;
    const { error } = await supabase.from("judging_tags" as any).insert({
      label: newLabel.trim(),
      color: newColor,
      icon: newIcon,
      image_url: newImageUrl,
      visible_in_round: [newSelectedRound],
      sort_order: maxOrder + 1,
      created_by: adminId,
    } as any);
    setAdding(false);
    if (error) {
      toast({ title: "Failed to add tag", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Tag created" });
      setNewLabel("");
      setNewColor("#d4a017");
      setNewIcon("award");
      setNewImageUrl(null);
      // newSelectedRound is locked to Round 4 — no reset needed
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      fetchTags();
    }
  };

  const deleteTag = async (id: string) => {
    const tag = tags.find((t) => t.id === id);
    if (tag?.is_system) {
      toast({ title: "System tag", description: "System tags cannot be deleted.", variant: "destructive" });
      return;
    }
    confirmAction({
      title: "Delete this judging tag?",
      onConfirm: async () => {
        const { error } = await supabase.from("judging_tags" as any).delete().eq("id", id);
        if (error) {
          toast({ title: "Delete failed", description: error.message, variant: "destructive" });
        } else {
          toast({ title: "Tag deleted" });
          qc.invalidateQueries({ queryKey: ["dashboard-init"] });
          fetchTags();
        }
      },
    });
  };

  const toggleActive = async (id: string, current: boolean) => {
    const tag = tags.find((t) => t.id === id);
    if (tag?.is_system) {
      toast({ title: "System tag", description: "System tags cannot be deactivated.", variant: "destructive" });
      return;
    }
    await supabase.from("judging_tags" as any).update({ is_active: !current } as any).eq("id", id);
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, is_active: !current } : t)));
  };

  // Round changes are no longer permitted from the UI. Custom tags are
  // hard-locked to Round 4 (Spec v3 Golden Rule #3) and system tags to
  // their migration-defined round. The DB trigger
  // `enforce_non_system_tags_round4` is the final guard.

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-xs">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading tags...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-px bg-primary" />
          <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>Configuration</span>
        </div>
        <h2 className="text-2xl md:text-3xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          Judging <em className="italic text-primary">Tags</em>
        </h2>
        <p className="text-xs text-muted-foreground mt-2 max-w-md" style={{ fontFamily: "var(--font-body)" }}>
          Create the tags judges assign in the <strong className="text-foreground">Final Round (Round 4)</strong>: Top 100, Top 50, Winner, Runner-Up, Honorary Mention, Special Jury, etc. Per Spec v3 Golden Rule #3, all judge-applied tags live in Round 4 only — R1/R2/R3 use decision buttons and 10-criteria scores instead.
        </p>
      </div>

      {/* Add new tag */}
      <div className="border border-border p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="w-8 h-8 cursor-pointer border border-border bg-transparent"
            title="Tag color"
          />
          <select
            value={newIcon}
            onChange={(e) => setNewIcon(e.target.value)}
            className="bg-transparent border border-border px-2 py-1.5 text-xs outline-none focus:border-primary"
            style={{ fontFamily: "var(--font-body)" }}
            title="Tag icon"
          >
            {STAMP_ICONS.map((ic) => (
              <option key={ic} value={ic}>{ic.charAt(0).toUpperCase() + ic.slice(1)}</option>
            ))}
          </select>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New tag name (e.g. Top 100 Global Photographer)"
            className="flex-1 min-w-[200px] bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm transition-colors duration-500"
            style={{ fontFamily: "var(--font-body)" }}
            maxLength={100}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
          />
          <button
            onClick={addTag}
            disabled={!newLabel.trim() || adding}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-[10px] tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Add Tag
          </button>
        </div>

        {/* Image upload for new tag */}
        <div className="flex items-center gap-3">
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
            Custom Image:
          </span>
          {newImageUrl ? (
            <div className="flex items-center gap-2">
              <img loading="lazy" decoding="async" src={newImageUrl} alt="Tag preview" className="h-8 w-auto object-contain border border-border rounded-sm" />
              <button
                onClick={() => setNewImageUrl(null)}
                className="p-1 hover:text-destructive transition-colors"
                title="Remove image"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-border text-[10px] tracking-[0.1em] uppercase text-muted-foreground hover:border-primary hover:text-primary cursor-pointer transition-colors"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              {uploading ? "Uploading…" : "Upload Tag Image"}
              <input type="file" accept="image/*" className="hidden" onChange={handleNewTagImage} disabled={uploading} />
            </label>
          )}
          <span className="text-[9px] text-muted-foreground italic" style={{ fontFamily: "var(--font-body)" }}>
            (overrides icon if set)
          </span>
        </div>

        {/* Round — LOCKED to Round 4 per Spec v3 Golden Rule #3 */}
        <div className="flex items-center gap-3">
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
            Round:
          </span>
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[9px] tracking-[0.1em] uppercase border border-primary bg-primary/10 text-primary"
            style={{ fontFamily: "var(--font-heading)" }}
            title="Per Spec v3, all judge-applied tags live in Round 4 only."
          >
            <Lock className="h-2.5 w-2.5" /> Round 4 (locked)
          </span>
          <span className="text-[9px] text-muted-foreground italic" style={{ fontFamily: "var(--font-body)" }}>
            All judging tags are assigned in the Final Round only.
          </span>
        </div>

        {/* Live preview */}
        {newLabel.trim() && (
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider" style={{ fontFamily: "var(--font-heading)" }}>Preview:</span>
            <JudgingStampBadge label={newLabel} color={newColor} icon={newIcon} imageUrl={newImageUrl} size="sm" />
            <JudgingStampBadge label={newLabel} color={newColor} icon={newIcon} imageUrl={newImageUrl} size="md" />
          </div>
        )}
      </div>

      {/* System tag request form — collapsed by default; drafts a migration, never writes directly */}
      <Collapsible className="border border-border rounded-sm">
        <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 transition-colors group">
          <div className="flex items-center gap-3">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-xs font-semibold tracking-wide uppercase">Request a System Tag</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Drafts a migration request for engineering review — never writes to the DB directly.</div>
            </div>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border px-4 py-4">
          <SystemTagRequestForm />
        </CollapsibleContent>
      </Collapsible>

      {/* Tag list */}
      <div className="border border-border divide-y divide-border">
        {tags.map((tag) => {
          const currentRound = (tag.visible_in_round && tag.visible_in_round.length > 0) ? tag.visible_in_round[0] : 2;
          return (
            <div key={tag.id} className={`relative flex items-center gap-3 px-4 py-3 group ${!tag.is_active ? "opacity-50" : ""} ${tag.is_system ? "bg-primary/[0.03]" : ""}`}>
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
              <div className="relative">
                <JudgingStampBadge label={tag.label} color={tag.color} icon={tag.icon || "award"} imageUrl={tag.image_url} size="sm" />
                {/* Hover preview */}
                <div className="absolute left-0 bottom-full mb-3 z-50 hidden group-hover:flex flex-col items-start pointer-events-none">
                  <div className="bg-card border border-border shadow-lg p-4 rounded-sm">
                    <span className="text-[8px] tracking-[0.2em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                      Preview
                    </span>
                    <JudgingStampBadge label={tag.label} color={tag.color} icon={tag.icon || "award"} imageUrl={tag.image_url} size="md" className={tag.image_url ? "scale-[2] origin-top-left" : "scale-150 origin-top-left"} />
                  </div>
                  <div className="w-3 h-3 bg-card border-b border-r border-border rotate-45 -mt-1.5 ml-4" />
                </div>
              </div>
              {tag.is_system && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-primary/40 text-primary text-[8px] tracking-[0.2em] uppercase shrink-0"
                  style={{ fontFamily: "var(--font-heading)" }}
                  title="System tag — cannot be renamed, moved, or deleted"
                >
                  <Lock className="h-2.5 w-2.5" /> System
                </span>
              )}

              {/* Upload / change image for existing tag */}
              <div className="flex items-center gap-1.5 shrink-0">
                {tag.image_url ? (
                  <>
                    <img loading="lazy" decoding="async" src={tag.image_url} alt="" className="h-5 w-auto object-contain opacity-60" />
                    <button
                      onClick={() => removeExistingTagImage(tag.id)}
                      className="p-1 hover:text-destructive transition-colors"
                      title="Remove custom image"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : null}
                <label className={`p-1.5 cursor-pointer transition-colors ${uploadingTagId === tag.id ? "text-primary" : "text-muted-foreground/50 hover:text-primary"}`} title="Upload custom image">
                  {uploadingTagId === tag.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleExistingTagImage(tag.id, e)} disabled={uploadingTagId === tag.id} />
                </label>
              </div>

              {/* Round — display-only. System tags show their fixed round; custom tags are R4-locked. */}
              <div className="flex items-center gap-1 shrink-0">
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[7px] tracking-[0.1em] uppercase border ${
                    tag.is_system
                      ? "border-border/60 text-muted-foreground"
                      : "border-primary/60 bg-primary/10 text-primary"
                  }`}
                  style={{ fontFamily: "var(--font-heading)" }}
                  title={
                    tag.is_system
                      ? `System tag — locked to Round ${currentRound}`
                      : "Per Spec v3, all judge-applied tags live in Round 4 only."
                  }
                >
                  <Lock className="h-2 w-2" /> Round {currentRound}
                </span>
              </div>

              <span className="flex-1" />
              <button
                onClick={() => toggleActive(tag.id, tag.is_active)}
                className="p-1.5 hover:text-primary transition-colors"
                title={tag.is_active ? "Deactivate" : "Activate"}
              >
                {tag.is_active ? (
                  <ToggleRight className="h-4 w-4 text-primary" />
                ) : (
                  <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              <button
                onClick={() => deleteTag(tag.id)}
                className="p-1.5 hover:text-destructive transition-colors"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        {tags.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
            No judging tags created yet
          </div>
        )}
      </div>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

export default AdminJudgingTags;
