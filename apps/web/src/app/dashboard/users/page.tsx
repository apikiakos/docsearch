import { PageHeader } from "@/components/page-header";
import { UsersTable } from "@/components/users-table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Users" },
        ]}
        title="Users"
        subtitle="Manage platform users and their tenant memberships"
        actions={
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        }
      />
      <UsersTable />
    </div>
  );
}
