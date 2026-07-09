import { Globe, Users, Lock } from "lucide-react";
import { createElement } from "react";

export const timeAgo = (dateStr: string) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export const privacyIcon = (p: string) => {
  switch (p) {
    case "friends": return createElement(Users, { className: "h-3 w-3" });
    case "private": return createElement(Lock, { className: "h-3 w-3" });
    default: return createElement(Globe, { className: "h-3 w-3" });
  }
};
