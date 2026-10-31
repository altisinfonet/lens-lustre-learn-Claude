import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const labelClass = "block text-[10px] tracking-[0.15em] uppercase text-muted-foreground mb-1.5";

interface CourseTrustSettingsProps {
  adminStudents: number;
  adminRating: number;
  adminRatingCount: number;
  reviewsEnabled: boolean;
  onAdminStudentsChange: (v: number) => void;
  onAdminRatingChange: (v: number) => void;
  onAdminRatingCountChange: (v: number) => void;
  onReviewsEnabledChange: (v: boolean) => void;
}

const CourseTrustSettings = ({
  adminStudents,
  adminRating,
  adminRatingCount,
  reviewsEnabled,
  onAdminStudentsChange,
  onAdminRatingChange,
  onAdminRatingCountChange,
  onReviewsEnabledChange,
}: CourseTrustSettingsProps) => {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4 space-y-4">
      <span
        className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Course Trust Settings
      </span>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>
            Students
          </label>
          <Input
            type="number"
            min={0}
            value={adminStudents}
            onChange={(e) => onAdminStudentsChange(parseInt(e.target.value) || 0)}
            className="h-9 text-sm"
          />
        </div>

        <div>
          <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>
            Rating (0–5)
          </label>
          <Input
            type="number"
            min={0}
            max={5}
            step={0.1}
            value={adminRating}
            onChange={(e) => onAdminRatingChange(parseFloat(e.target.value) || 0)}
            className="h-9 text-sm"
          />
        </div>

        <div>
          <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>
            Rating Count
          </label>
          <Input
            type="number"
            min={0}
            value={adminRatingCount}
            onChange={(e) => onAdminRatingCountChange(parseInt(e.target.value) || 0)}
            className="h-9 text-sm"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Switch
          id="reviews-enabled"
          checked={reviewsEnabled}
          onCheckedChange={onReviewsEnabledChange}
        />
        <Label
          htmlFor="reviews-enabled"
          className="text-sm text-foreground/80 cursor-pointer"
          style={{ fontFamily: "var(--font-body)" }}
        >
          Enable student reviews
        </Label>
      </div>
    </div>
  );
};

export default CourseTrustSettings;
