import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Context = {
  params: Promise<{ id: string }>;
};

export default async function UserDetailPage(context: Context) {
  const session = await auth();
  const isPlatformAdmin =
    session?.user?.memberships?.some((m: { tenantId: string; tenantSlug: string; role: string }) => m.role === "platform_admin") ?? false;

  if (!isPlatformAdmin) {
    redirect("/dashboard");
  }

  const { id } = await context.params;

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      memberships: {
        include: {
          tenant: true,
        },
      },
    },
  });

  if (!user) {
    redirect("/users");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Users", href: "/users" },
          { label: user.email },
        ]}
        title={user.name || user.email}
        subtitle={`User details and tenant memberships`}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>User Information</CardTitle>
            <CardDescription>Basic user details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Email</p>
              <p className="text-sm">{user.email}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Name</p>
              <p className="text-sm">{user.name || "-"}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Created</p>
              <p className="text-sm">{new Date(user.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Last Updated</p>
              <p className="text-sm">{new Date(user.updatedAt).toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tenant Memberships</CardTitle>
            <CardDescription>Tenants this user has access to</CardDescription>
          </CardHeader>
          <CardContent>
            {user.memberships.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tenant memberships</p>
            ) : (
              <div className="space-y-2">
                {user.memberships.map((membership: { id: string; role: string; tenant: { name: string; slug: string } }) => (
                  <div
                    key={membership.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div>
                      <p className="font-medium">{membership.tenant.name}</p>
                      <p className="text-sm text-muted-foreground">{membership.tenant.slug}</p>
                    </div>
                    <Badge variant="secondary">{membership.role}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

