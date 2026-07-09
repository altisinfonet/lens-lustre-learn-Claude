/**
 * Users Module — extracted from AdminPanel.tsx
 * Sub-tabs: Manage Users, Blue Tick Requests, Badge & Role Types
 */
import { useState, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";

const AdminUsers = lazy(() => import("@/components/admin/AdminUsers"));
const AdminBadgeRoleDefinitions = lazy(() => import("@/components/admin/AdminBadgeRoleDefinitions"));

const LazyTab = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
    {children}
  </Suspense>
);

interface Props {
  user: User | null;
}

const UsersModule = ({ user }: Props) => {
  const [usersSubTab, setUsersSubTab] = useState<"manage" | "definitions">("manage");

  return (
    <div className="space-y-0">
      <div className="flex items-center gap-0 border-b border-border mb-6">
        <button onClick={() => setUsersSubTab("manage")}
          className={`relative px-5 py-3 text-[10px] tracking-[0.15em] uppercase transition-colors ${usersSubTab === "manage" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          style={{ fontFamily: "var(--font-heading)" }}>
          Manage Users
          {usersSubTab === "manage" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
        </button>
        <button onClick={() => setUsersSubTab("definitions")}
          className={`relative px-5 py-3 text-[10px] tracking-[0.15em] uppercase transition-colors flex items-center gap-1.5 ${usersSubTab === "definitions" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          style={{ fontFamily: "var(--font-heading)" }}>
          Badge & Role Types
          {usersSubTab === "definitions" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
        </button>
      </div>
      <LazyTab>
        {usersSubTab === "manage" && <AdminUsers user={user} />}
        {usersSubTab === "definitions" && <AdminBadgeRoleDefinitions />}
      </LazyTab>
    </div>
  );
};

export default UsersModule;
