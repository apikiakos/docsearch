import { PageHeader } from "@/components/page-header";
import { TenantsTable } from "@/components/tenants-table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function TenantsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Tenants" },
        ]}
        title="Tenants"
        subtitle="Manage platform tenants and their configurations"
        actions={
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Tenant
          </Button>
        }
      />
      <TenantsTable />
    </div>
  );
}

