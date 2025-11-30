import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

export default function DocumentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Documents" },
        ]}
        title="Documents"
        subtitle="Manage and index documents"
      />

      <Card>
        <CardHeader>
          <CardTitle>Document Management</CardTitle>
          <CardDescription>
            Upload and manage documents
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Document management functionality will be implemented here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

