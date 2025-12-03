import { PageHeader } from "@/components/page-header";
import { UsersTable } from "@/components/users-table";

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
      />
      <UsersTable />
    </div>
  );
}

