/**
 * Admin → Comments → "Suggestions under the comment box" (Owner 18 Nov 2026).
 * Edits site_settings `comment_suggestions` (src/lib/comments/photoSuggestions.ts):
 * the photography phrases members can tap to add to a comment, on web and app.
 * No app build is needed to change them.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSiteSetting } from "@/hooks/core/useSiteSetting";
import { toast } from "@/hooks/core/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_SUGGESTIONS, MAX_PHRASE_LENGTH, MAX_SUGGESTIONS, SUGGESTIONS_KEY, readSuggestions,
  type SuggestionPhrase, type SuggestionsSetting,
} from "@/lib/comments/photoSuggestions";
import type { User } from "@supabase/supabase-js";

const OTHER_LANGS: Array<[Exclude<keyof SuggestionPhrase, "en">, string]> = [
  ["hi", "हिन्दी"], ["bn", "বাংলা"], ["mr", "मराठी"], ["gu", "ગુજરાતી"], ["ta", "தமிழ்"], ["te", "తెలుగు"],
];

export default function AdminCommentSuggestions({ user }: { user: User | null }) {
  const qc = useQueryClient();
  const { data, isLoading } = useSiteSetting<unknown>(SUGGESTIONS_KEY);
  const [draft, setDraft] = useState<SuggestionsSetting | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!isLoading && draft === null) setDraft(readSuggestions(data)); }, [data, isLoading, draft]);
  if (!draft) return null;

  const setPhrase = (i: number, patch: Partial<SuggestionPhrase>) =>
    setDraft({ ...draft, phrases: draft.phrases.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  const save = async () => {
    if (!user) return;
    const value = readSuggestions(draft); // same cleaning the member's screen applies
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert(
      { key: SUGGESTIONS_KEY, value: value as never, updated_at: new Date().toISOString(), updated_by: user.id },
      { onConflict: "key" },
    );
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setDraft(value);
    qc.setQueryData(["site-setting", SUGGESTIONS_KEY], value);
    qc.invalidateQueries({ queryKey: ["dashboard-init"] });
    toast({ title: "Suggestions saved", description: "Members see them the next time they open comments." });
  };

  return (
    <section className="mb-8 rounded-lg border border-border p-4" data-testid="admin-comment-suggestions">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Suggestions under the comment box</h3>
          <p className="text-xs text-muted-foreground">
            Members tap one to add it to their comment (web and app). Shown in the member's language; English if that language is empty.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} aria-label="Show suggestions" />
          {draft.enabled ? "On" : "Off"}
        </label>
      </div>

      <ol className="mt-4 space-y-2">
        {draft.phrases.map((p, i) => (
          <li key={i} className="rounded-md border border-border/70 p-2">
            <div className="flex items-center gap-2">
              <span className="w-5 text-right text-xs text-muted-foreground">{i + 1}</span>
              <Input value={p.en} maxLength={MAX_PHRASE_LENGTH} aria-label={`Phrase ${i + 1} (English)`}
                onChange={(e) => setPhrase(i, { en: e.target.value })} className="h-9" />
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i} aria-label={`Other languages for phrase ${i + 1}`}>
                {open === i ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove phrase ${i + 1}`}
                onClick={() => setDraft({ ...draft, phrases: draft.phrases.filter((_, j) => j !== i) })}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            {open === i && (
              <div className="mt-2 grid gap-2 ps-7 sm:grid-cols-2">
                {OTHER_LANGS.map(([l, name]) => (
                  <label key={l} className="flex items-center gap-2 text-xs">
                    <span className="w-16 shrink-0 text-muted-foreground">{name}</span>
                    <Input value={p[l] ?? ""} maxLength={MAX_PHRASE_LENGTH} className="h-8"
                      onChange={(e) => setPhrase(i, { [l]: e.target.value })} />
                  </label>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={draft.phrases.length >= MAX_SUGGESTIONS}
          onClick={() => { setDraft({ ...draft, phrases: [...draft.phrases, { en: "" }] }); setOpen(draft.phrases.length); }}>
          <Plus className="me-1 h-4 w-4" /> Add phrase
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(DEFAULT_SUGGESTIONS)}>
          <RotateCcw className="me-1 h-4 w-4" /> Back to the standard list
        </Button>
        <Button type="button" size="sm" className="ms-auto" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  );
}
