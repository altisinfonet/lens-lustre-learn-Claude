import { useCookieConsent } from "@/hooks/core/useCookieConsent";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Shield, BarChart3, Megaphone, Lock } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const categories = [
  {
    key: "essential" as const,
    label: "Essential",
    description: "Authentication, security, and core functionality. Always active.",
    icon: Lock,
    locked: true,
  },
  {
    key: "analytics" as const,
    label: "Analytics",
    description: "Help us understand how you use the site so we can improve it.",
    icon: BarChart3,
    locked: false,
  },
  {
    key: "marketing" as const,
    label: "Marketing",
    description: "Personalized ads and remarketing across third-party platforms.",
    icon: Megaphone,
    locked: false,
  },
];

const CookiePreferencesModal = ({ open, onOpenChange }: Props) => {
  const { consent, updateConsent } = useCookieConsent();
  const [local, setLocal] = useState({ analytics: consent.analytics, marketing: consent.marketing });

  useEffect(() => {
    if (open) {
      setLocal({ analytics: consent.analytics, marketing: consent.marketing });
    }
  }, [open, consent.analytics, consent.marketing]);

  const handleSave = () => {
    updateConsent(local);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl border-border/60 bg-card/98 backdrop-blur-xl p-0 overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-primary via-primary/60 to-transparent" />

        <div className="p-6">
          <DialogHeader className="mb-5">
            <div className="flex items-center gap-3 mb-1">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10">
                <Shield className="w-4.5 h-4.5 text-primary" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">Cookie Preferences</DialogTitle>
            </div>
            <DialogDescription className="text-[13px] text-muted-foreground">
              Choose which cookies you allow. Essential cookies cannot be disabled.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const checked = cat.locked ? true : local[cat.key as "analytics" | "marketing"];
              return (
                <div
                  key={cat.key}
                  className="flex items-start gap-4 p-3.5 rounded-xl border border-border/50 bg-background/60 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/30 mt-0.5 shrink-0">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{cat.label}</span>
                      {cat.locked && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
                          Always On
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{cat.description}</p>
                  </div>
                  <Switch
                    checked={checked}
                    disabled={cat.locked}
                    onCheckedChange={(v) => {
                      if (!cat.locked) {
                        setLocal((prev) => ({ ...prev, [cat.key]: v }));
                      }
                    }}
                    className="mt-1 shrink-0"
                  />
                </div>
              );
            })}
          </div>

          <DialogFooter className="mt-6 flex-col sm:flex-row gap-2.5">
            <button
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium hover:bg-muted/30 active:scale-[0.98] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:brightness-110 active:scale-[0.98] transition-all"
            >
              Save Preferences
            </button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CookiePreferencesModal;
