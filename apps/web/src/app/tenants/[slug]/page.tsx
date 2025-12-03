import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IndexInfo } from "./index-info";
import { TenantDocuments } from "./tenant-documents";
import { TenantActions } from "@/components/tenant-actions";

type Context = {
  params: Promise<{ slug: string }>;
};

export default async function TenantDetailPage(context: Context) {
  const session = await auth();
  const isPlatformAdmin =
    session?.user?.memberships?.some((m: { tenantId: string; tenantSlug: string; role: string }) => m.role === "platform_admin") ?? false;

  if (!isPlatformAdmin) {
    redirect("/dashboard");
  }

  const { slug } = await context.params;

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
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
    redirect("/tenants");
  }

  // Determine producer type based on tenant slug
  const getProducerType = (slug: string): "gutenberg" | "s3" | "govdocs" | undefined => {
    if (slug === "gutenberg") return "gutenberg";
    if (slug.startsWith("s3-tenant")) return "s3";
    if (slug === "govdocs") return "govdocs";
    return undefined;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Tenants", href: "/tenants" },
          { label: tenant.name },
        ]}
        title={tenant.name}
        subtitle={`Tenant details and member management`}
        actions={
          <TenantActions
            tenantSlug={tenant.slug}
            tenantName={tenant.name}
            isAdmin={isPlatformAdmin}
            producerType={getProducerType(tenant.slug)}
          />
        }
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
          <TenantDocuments 
            tenantSlug={tenant.slug} 
            userRole={
              isPlatformAdmin 
                ? "platform_admin" 
                : (tenant.memberships.find((m: { user: { id: string } }) => m.user.id === session.user.id)?.role as "tenant_admin" | "tenant_user" || "tenant_user")
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

