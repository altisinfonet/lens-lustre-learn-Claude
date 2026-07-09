/**
 * Role Applications Module — wraps AdminRoleApplications with data from hook
 */
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useAdminRoleApplications } from "@/hooks/admin/useAdminRoleApplications";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

const AdminRoleApplications = lazy(() => import("@/components/admin/AdminRoleApplications"));

interface Props {
  userId: string;
}

const RoleApplicationsModule = ({ userId }: Props) => {
  const { roleApplications, error } = useAdminRoleApplications();
  const queryClient = useQueryClient();

  if (error) {
    return <p className="text-sm text-destructive py-8 text-center">Failed to load applications: {error.message}</p>;
  }

  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
      <AdminRoleApplications
        roleApps={roleApplications}
        onRefresh={() => queryClient.invalidateQueries({ queryKey: queryKeys.adminRoleApplications() })}
        userId={userId}
      />
    </Suspense>
  );
};

export default RoleApplicationsModule;
