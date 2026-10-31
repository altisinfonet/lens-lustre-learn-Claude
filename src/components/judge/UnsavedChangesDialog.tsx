import { AlertTriangle, Save, Trash2, ArrowLeft } from "lucide-react";
import { useT } from "@/i18n/I18nContext";

interface UnsavedChangesDialogProps {
  open: boolean;
  onDiscard: () => void;
  onStay: () => void;
  onSaveAndLeave?: () => void;
}

const UnsavedChangesDialog = ({ open, onDiscard, onStay, onSaveAndLeave }: UnsavedChangesDialogProps) => {
  const t = useT();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <h2
            className="text-base font-medium"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("jg.unsavedChanges")}
          </h2>
          <p
            className="text-sm text-muted-foreground mt-1.5"
            style={{ fontFamily: "var(--font-body)" }}
          >
            {t("jg.unsavedDesc")}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {onSaveAndLeave && (
            <button
              onClick={onSaveAndLeave}
              className="w-full flex items-center justify-center gap-2 text-[11px] tracking-[0.1em] uppercase px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-semibold"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <Save className="h-3.5 w-3.5" />
              {t("jg.saveLeave")}
            </button>
          )}
          <div className="flex gap-3">
            <button
              onClick={onDiscard}
              className="flex-1 flex items-center justify-center gap-1.5 text-[11px] tracking-[0.1em] uppercase px-4 py-2.5 border border-destructive/50 text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <Trash2 className="h-3 w-3" />
              {t("jg.discard")}
            </button>
            <button
              onClick={onStay}
              className="flex-1 flex items-center justify-center gap-1.5 text-[11px] tracking-[0.1em] uppercase px-4 py-2.5 border border-border rounded-lg hover:bg-muted transition-colors"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <ArrowLeft className="h-3 w-3" />
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnsavedChangesDialog;
