"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { DocumentUploadDialog } from "@/components/document-upload-dialog";
import { Upload } from "lucide-react";

interface Tenant {
  slug: string;
  name: string;
}

export function AdminUploadButton() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAdminAndFetchTenants = async () => {
      try {
        // Fetch user info to check admin status
        const userResponse = await fetch("/api/auth/me");
        let userIsAdmin = false;
        
        if (userResponse.ok) {
          const userData = await userResponse.json();
          userIsAdmin = userData.isPlatformAdmin || false;
        }
        
        // Fetch accessible tenants
        const tenantsResponse = await fetch("/api/tenants/accessible");
        if (tenantsResponse.ok) {
          const tenantsData = await tenantsResponse.json();
          const userTenants = tenantsData.tenants || [];
          
          setIsAdmin(userIsAdmin);
          setTenants(userTenants);
        }
      } catch (error) {
        console.error("Error checking admin status:", error);
      } finally {
        setLoading(false);
      }
    };

    checkAdminAndFetchTenants();
  }, []);

  if (loading || !isAdmin || tenants.length === 0) {
    return null;
  }

  return (
    <>
      <Button onClick={() => setUploadDialogOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Add New Documents
      </Button>
      <DocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        tenants={tenants}
        onSuccess={() => {
          // Optionally refresh the page or show success message
        }}
      />
    </>
  );
}

