import { requireAuth } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { CachePageClient } from "@/components/cache-page-client";

export default async function CachePage() {
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
        title="Cache Management"
        subtitle="View and manage Redis cache entries for search results"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Documents", href: "/documents" },
          { label: "Cache" },
        ]}
      />
      <CachePageClient />
    </div>
  );
}

