"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useState } from "react";
import { DocumentUploadDialog } from "@/components/document-upload-dialog";

interface Tenant {
  slug: string;
  name: string;
}

interface AdminDashboardCardProps {
  title: string;
  description: string;
  content: string;
  href?: string;
  openUploadDialog?: boolean;
  className?: string;
}

export function AdminDashboardCard({
  title,
  description,
  content,
  href,
  openUploadDialog = false,
  className,
}: AdminDashboardCardProps) {
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  const handleClick = async (e: React.MouseEvent) => {
    if (openUploadDialog) {
      e.preventDefault();
      // Fetch tenants and open dialog
      try {
        const response = await fetch("/api/tenants/accessible");
        if (response.ok) {
          const data = await response.json();
          setTenants(data.tenants || []);
          setUploadDialogOpen(true);
        }
      } catch (error) {
        console.error("Error fetching tenants:", error);
      }
    }
    // If href is provided and not openUploadDialog, Link will handle navigation
  };

  const cardContent = (
    <Card
      className={cn(
        "transition-all duration-200 cursor-pointer hover:shadow-lg hover:border-primary/50",
        (href || openUploadDialog) ? "hover:scale-[1.02]" : "",
        className
      )}
      onClick={openUploadDialog ? handleClick : undefined}
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{content}</p>
      </CardContent>
    </Card>
  );

  if (href && !openUploadDialog) {
    return (
      <Link href={href} className="block">
        {cardContent}
      </Link>
    );
  }

  return (
    <>
      {cardContent}
      {openUploadDialog && tenants.length > 0 && (
        <DocumentUploadDialog
          open={uploadDialogOpen}
          onOpenChange={setUploadDialogOpen}
          tenants={tenants}
          onSuccess={() => {
            setUploadDialogOpen(false);
          }}
        />
      )}
    </>
  );
}

