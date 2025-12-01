import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SystemStatus } from "@/components/system-status";
import { PageHeader } from "@/components/page-header";
import { auth } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();
  const isPlatformAdmin =
    session?.user?.memberships?.some((m: { tenantId: string; tenantSlug: string; role: string }) => m.role === "platform_admin") ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Dashboard" }]}
        title="Dashboard"
        subtitle="Welcome to the Document Search Service"
      />

      {isPlatformAdmin && (
        <div>
          <SystemStatus />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Search Documents</CardTitle>
            <CardDescription>
              Search through indexed documents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Use the search functionality to find documents across your accessible tenants.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Index Documents</CardTitle>
            <CardDescription>
              Add new documents to the search index
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Upload and index new documents for full-text search.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Manage Tenants</CardTitle>
            <CardDescription>
              View and manage tenant access
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Manage your tenant memberships and access levels.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

