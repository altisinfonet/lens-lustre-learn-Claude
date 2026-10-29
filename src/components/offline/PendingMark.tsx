/**
 * S7b-5 · "Will send when online" beside something the member did with no
 * network (a like, a follow, a report). Renders nothing once it is delivered.
 */
import { Clock } from "lucide-react";
import { useOutboxPendingSubjects } from "@/lib/offline/useOutboxPending";

export default function PendingMark({ subject, className = "" }: { subject: string; className?: string }) {
  const waiting = useOutboxPendingSubjects();
  if (!waiting.has(subject)) return null;
  return (
    <span data-testid="pending-mark" className={`inline-flex items-center gap-1 text-[11px] text-muted-foreground ${className}`}>
      <Clock className="h-3 w-3" aria-hidden="true" />
      Will send when online
    </span>
  );
}
