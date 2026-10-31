/**
 * S7b-6 · course lesson videos are YouTube embeds. YouTube does not allow them
 * to be saved on the phone, so with no network the lesson says so plainly —
 * never a broken player.
 */
import { useSyncExternalStore, type ReactNode } from "react";
import { CloudOff } from "lucide-react";
import { getNetState, subscribeNetState } from "@/lib/offline/networkQuality";

const online = () => getNetState().online;

export default function LessonVideoGate({ children }: { children: ReactNode }) {
  const isOnline = useSyncExternalStore(subscribeNetState, online, online);
  if (isOnline) return <>{children}</>;
  return (
    <div role="status" className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white/80">
      <CloudOff className="h-6 w-6" aria-hidden="true" />
      No internet — this video needs a connection. The lesson text is below.
    </div>
  );
}
