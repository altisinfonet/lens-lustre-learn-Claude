import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/I18nContext";

/**
 * Self-serve permanent account deletion. Any signed-in user can irreversibly
 * delete their own account and ALL associated data (profile, posts, photos,
 * competition entries, comments, stories, wallet, etc.). Calls the
 * `delete-my-account` edge function, which only ever acts on the caller's own id.
 */
// NOT translated, deliberately: this is the token the user must TYPE. It is
// compared against their input via `confirmText.trim().toUpperCase() ===
// CONFIRM_WORD`, so it must stay the Latin literal "DELETE" in every language —
// translating it would change what the user has to type. Only the surrounding
// instruction text is translated.
const CONFIRM_WORD = "DELETE";

const DeleteAccountSection = () => {
  const t = useT();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);

  const canConfirm = confirmText.trim().toUpperCase() === CONFIRM_WORD && !loading;

  const handleDelete = async () => {
    if (!canConfirm) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-my-account");
      const errMsg = error?.message || (data as { error?: string } | null)?.error;
      if (errMsg) {
        toast({ title: t("dsa.failed"), description: errMsg, variant: "destructive" });
        setLoading(false);
        return;
      }
      toast({ title: t("dsa.deleted"), description: t("dsa.deletedDesc") });
      // Clear the session locally and leave the app.
      try { await signOut(); } catch { /* session already gone with the user row */ }
      navigate("/", { replace: true });
    } catch (e) {
      toast({ title: t("dsa.failed"), description: (e as Error).message, variant: "destructive" });
      setLoading(false);
    }
  };

  return (
    <div className="border border-destructive/40 p-4 md:p-5">
      <span
        className="text-[9px] tracking-[0.3em] uppercase text-destructive block mb-3 flex items-center gap-1.5"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        <AlertTriangle className="h-3 w-3" /> {t("dsa.dangerZone")}
      </span>

      <p className="text-xs text-muted-foreground leading-relaxed mb-1" style={{ fontFamily: "var(--font-body)" }}>
        {t("dsa.intro")}
      </p>
      <p className="text-[11px] text-destructive/80 leading-relaxed mb-4" style={{ fontFamily: "var(--font-body)" }}>
        {t("dsa.warning")}
      </p>

      <button
        onClick={() => { setConfirmText(""); setOpen(true); }}
        className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-3 py-2 border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-all duration-500"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        <Trash2 className="h-3 w-3" /> {t("dsa.deleteMyAccount")}
      </button>

      <Dialog open={open} onOpenChange={(v) => { if (!loading) setOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive" style={{ fontFamily: "var(--font-heading)" }}>
              <AlertTriangle className="h-4 w-4" /> {t("dsa.dialogTitle")}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed pt-1" style={{ fontFamily: "var(--font-body)" }}>
              {/* `dsa.dialogDesc` embeds a {t} placeholder because the emphasised
                  verb phrase sits at different positions in different languages;
                  splitting on it keeps the <strong> around the right words. */}
              {(() => {
                const [before, after = ""] = t("dsa.dialogDesc").split("{t}");
                return (<>{before}<strong>{t("dsa.permanentlyErase")}</strong>{after}</>);
              })()}
            </DialogDescription>
          </DialogHeader>

          <div className="py-1">
            <label
              className="block text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-1.5"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {(() => {
                const [before, after = ""] = t("dsa.typeToConfirm").split("{t}");
                return (<>{before}<span className="text-destructive font-semibold">{CONFIRM_WORD}</span>{after}</>);
              })()}
            </label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
              autoFocus
              disabled={loading}
              className="bg-transparent text-sm"
              aria-label={t("dsa.ariaConfirm").replace("{t}", CONFIRM_WORD)}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="text-[10px] tracking-[0.1em] uppercase h-9"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleDelete}
              disabled={!canConfirm}
              className="text-[10px] tracking-[0.1em] uppercase h-9 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {loading ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Trash2 className="h-3 w-3 mr-1.5" />}
              {loading ? t("dsa.deleting") : t("dsa.deleteForever")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DeleteAccountSection;
