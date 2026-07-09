// Phase 3B — Date + time picker for scheduling a post.
// Uses shadcn Calendar + Popover (already installed) + native <input type="time"> —
// react-day-picker has no built-in time input. Emits an ISO UTC string via onChange.
// Enforces Phase 1 window: now+5min … now+90d (visual + hard).

import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface ScheduleDateTimePickerProps {
  value: Date | null;
  onChange: (next: Date | null) => void;
  disabled?: boolean;
}

const MIN_MINUTES_AHEAD = 5;
const MAX_DAYS_AHEAD = 90;

export function ScheduleDateTimePicker({
  value,
  onChange,
  disabled,
}: ScheduleDateTimePickerProps) {
  const [open, setOpen] = React.useState(false);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + MAX_DAYS_AHEAD);

  const timeStr = value ? format(value, "HH:mm") : "";

  const handleDateSelect = (d: Date | undefined) => {
    if (!d) {
      onChange(null);
      return;
    }
    const next = value ? new Date(value) : new Date();
    next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    if (!value) {
      // default to +1 hour from now, rounded to next 5-min
      const t = new Date();
      t.setMinutes(t.getMinutes() + 60);
      next.setHours(t.getHours(), Math.ceil(t.getMinutes() / 5) * 5, 0, 0);
    }
    onChange(next);
    setOpen(false);
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const [hh, mm] = e.target.value.split(":").map((s) => parseInt(s, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return;
    const base = value ? new Date(value) : new Date();
    base.setHours(hh, mm, 0, 0);
    onChange(base);
  };

  const minAllowed = new Date(Date.now() + MIN_MINUTES_AHEAD * 60 * 1000);
  const isTooSoon = !!value && value.getTime() < minAllowed.getTime();
  const isTooFar = !!value && value.getTime() > maxDate.getTime();
  const tzLabel = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarIcon className="h-3.5 w-3.5" />
        <span>Schedule this post</span>
        <span className="ml-auto tabular-nums">{tzLabel}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              className={cn(
                "w-[180px] justify-start text-left font-normal",
                !value && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {value ? format(value, "PPP") : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={value ?? undefined}
              onSelect={handleDateSelect}
              initialFocus
              disabled={(d) => d < today || d > maxDate}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        <div className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="time"
            value={timeStr}
            onChange={handleTimeChange}
            disabled={disabled || !value}
            className="bg-transparent text-sm text-foreground outline-none tabular-nums w-[110px] [color-scheme:light] dark:[color-scheme:dark]"
            step={60}
          />
        </div>

        {value && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="text-xs text-muted-foreground"
          >
            Clear
          </Button>
        )}
      </div>
      {value && (isTooSoon || isTooFar) && (
        <div className="text-[11px] text-destructive">
          {isTooSoon
            ? `Must be at least ${MIN_MINUTES_AHEAD} minutes from now.`
            : `Must be within ${MAX_DAYS_AHEAD} days from now.`}
        </div>
      )}
    </div>
  );
}
