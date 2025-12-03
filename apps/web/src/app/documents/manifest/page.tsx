import { requireAuth } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ManifestTable } from "@/components/manifest-table";

export default async function ManifestPage() {
  const user = await requireAuth();
  
  // Only allow platform admins
  const isPlatformAdmin = user.memberships.some(
    (m) => m.role === "platform_admin"
  );

  if (!isPlatformAdmin) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents Manifest"
        description="View and manage all document manifest entries across all tenants"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Documents", href: "/documents" },
          { label: "Manifest" },
        ]}
      />
      <ManifestTable />
    </div>
  );
}

