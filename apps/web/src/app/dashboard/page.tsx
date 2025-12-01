import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SystemStatus } from "@/components/system-status";
import { PageHeader } from "@/components/page-header";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IndexInfo } from "./tenants/[slug]/index-info";
import { TenantDocuments } from "./tenants/[slug]/tenant-documents";

export default async function DashboardPage() {
  const session = await auth();
  const isPlatformAdmin =
    session?.user?.memberships?.some((m: { tenantId: string; tenantSlug: string; role: string }) => m.role === "platform_admin") ?? false;

  // For tenant users, show their tenant detail page
  if (!isPlatformAdmin && session?.user?.memberships && session.user.memberships.length > 0) {
    // Get the first tenant membership (tenant users typically have one)
    const tenantMembership = session.user.memberships[0];
    const tenantSlug = tenantMembership.tenantSlug;

    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      include: {
        memberships: {
          include: {
            user: true,
          },
        },
        _count: {
          select: {
            memberships: true,
          },
        },
      },
    });

    if (!tenant) {
      return (
        <div className="space-y-6">
          <PageHeader
            breadcrumbs={[{ label: "Dashboard" }]}
            title="Dashboard"
            subtitle="Tenant not found"
          />
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">Your tenant could not be found.</p>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumbs={[{ label: "Dashboard" }]}
          title={tenant.name}
          subtitle={`Tenant details and document search`}
        />

        <Tabs defaultValue="general" className="space-y-6">
          <TabsList>
            <TabsTrigger value="general">General Info</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Tenant Information</CardTitle>
                  <CardDescription>Basic tenant details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Slug</p>
                    <p className="text-sm font-mono">{tenant.slug}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Name</p>
                    <p className="text-sm">{tenant.name}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Members</p>
                    <p className="text-sm">{tenant._count.memberships}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Created</p>
                    <p className="text-sm">{new Date(tenant.createdAt).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Last Updated</p>
                    <p className="text-sm">{new Date(tenant.updatedAt).toLocaleString()}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Members</CardTitle>
                  <CardDescription>Users with access to this tenant</CardDescription>
                </CardHeader>
                <CardContent>
                  {tenant.memberships.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No members</p>
                  ) : (
                    <div className="space-y-2">
                      {tenant.memberships.map((membership: { id: string; role: string; user: { email: string; name: string | null } }) => (
                        <div
                          key={membership.id}
                          className="flex items-center justify-between p-3 border rounded-lg"
                        >
                          <div>
                            <p className="font-medium">{membership.user.email}</p>
                            <p className="text-sm text-muted-foreground">{membership.user.name || "-"}</p>
                          </div>
                          <Badge variant="secondary">{membership.role}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Elasticsearch Index Information */}
            <IndexInfo tenantSlug={tenant.slug} isPlatformAdmin={isPlatformAdmin} />
          </TabsContent>

          <TabsContent value="documents" className="space-y-6">
            <TenantDocuments tenantSlug={tenant.slug} />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // For platform admins, show the admin dashboard
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Dashboard" }]}
        title="Dashboard"
        subtitle="Welcome to the Document Search Service"
      />

      <div>
        <SystemStatus />
      </div>

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

