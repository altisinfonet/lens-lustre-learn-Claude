import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, Check, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Module {
  id: string;
  title: string;
  sort_order: number;
  course_id: string;
}

interface CourseModuleManagerProps {
  courseId: string;
  onModulesChange?: () => void;
}

const labelClass = "text-[10px] tracking-[0.2em] uppercase text-muted-foreground";
const headingFont = { fontFamily: "var(--font-heading)" };

const CourseModuleManager = ({ courseId, onModulesChange }: CourseModuleManagerProps) => {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchModules = async () => {
    const { data, error } = await supabase
      .from("course_modules")
      .select("*")
      .eq("course_id", courseId)
      .order("sort_order", { ascending: true });

    if (error) {
      toast({ title: "Failed to load modules", description: error.message, variant: "destructive" });
    } else {
      setModules((data as Module[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (courseId) fetchModules();
  }, [courseId]);

  const addModule = async () => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setBusy(true);
    const nextOrder = modules.length > 0 ? Math.max(...modules.map((m) => m.sort_order ?? 0)) + 1 : 0;
    const { error } = await supabase.from("course_modules").insert({
      course_id: courseId,
      title: trimmed,
      sort_order: nextOrder,
    });
    if (error) {
      toast({ title: "Failed to add module", description: error.message, variant: "destructive" });
    } else {
      setNewTitle("");
      await fetchModules();
      onModulesChange?.();
      toast({ title: "Module added" });
    }
    setBusy(false);
  };

  const saveRename = async (id: string) => {
    const trimmed = editTitle.trim();
    if (!trimmed) return;
    setBusy(true);
    const { error } = await supabase.from("course_modules").update({ title: trimmed }).eq("id", id);
    if (error) {
      toast({ title: "Rename failed", description: error.message, variant: "destructive" });
    } else {
      setEditingId(null);
      await fetchModules();
      onModulesChange?.();
    }
    setBusy(false);
  };

  const deleteModule = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.from("course_modules").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      await fetchModules();
      onModulesChange?.();
      toast({ title: "Module deleted", description: "Lessons under this module are preserved." });
    }
    setBusy(false);
  };

  const swap = async (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= modules.length) return;
    setBusy(true);
    const a = modules[index];
    const b = modules[target];
    await Promise.all([
      supabase.from("course_modules").update({ sort_order: b.sort_order }).eq("id", a.id),
      supabase.from("course_modules").update({ sort_order: a.sort_order }).eq("id", b.id),
    ]);
    await fetchModules();
    onModulesChange?.();
    setBusy(false);
  };

  if (loading) {
    return (
      <div className="border border-border rounded-lg p-4 flex items-center justify-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading modules…
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <label className={labelClass} style={headingFont}>
          Modules ({modules.length})
        </label>
      </div>

      {/* Module list */}
      {modules.length > 0 && (
        <div className="space-y-2">
          {modules.map((mod, i) => (
            <div
              key={mod.id}
              className="flex items-center gap-2 border border-border rounded-sm px-3 py-2 bg-card/50"
            >
              {/* Reorder */}
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  disabled={i === 0 || busy}
                  onClick={() => swap(i, "up")}
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={i === modules.length - 1 || busy}
                  onClick={() => swap(i, "down")}
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Title / Inline edit */}
              {editingId === mod.id ? (
                <div className="flex items-center gap-1.5 flex-1">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveRename(mod.id)}
                    autoFocus
                    className="h-8 text-sm bg-transparent"
                    maxLength={120}
                  />
                  <button
                    type="button"
                    onClick={() => saveRename(mod.id)}
                    disabled={busy}
                    className="p-1 text-primary hover:opacity-80"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <span className="text-sm flex-1 truncate" style={{ fontFamily: "var(--font-body)" }}>
                  {mod.title}
                </span>
              )}

              {/* Actions */}
              {editingId !== mod.id && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(mod.id);
                      setEditTitle(mod.title);
                    }}
                    disabled={busy}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    title="Rename"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteModule(mod.id)}
                    disabled={busy}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete module (lessons preserved)"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add new module */}
      <div className="flex items-center gap-2">
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addModule()}
          placeholder="New module title…"
          className="h-8 text-sm bg-transparent flex-1"
          maxLength={120}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addModule}
          disabled={busy || !newTitle.trim()}
          className="h-8 text-xs gap-1"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {modules.length === 0 && (
        <p className="text-xs text-muted-foreground/60 italic">
          No modules yet. Lessons will appear under a "General" fallback.
        </p>
      )}
    </div>
  );
};

export default CourseModuleManager;
