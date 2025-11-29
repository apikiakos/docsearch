"use client";

import type { ReactNode } from "react";
import { AdminSidebar } from "./admin-sidebar";
import { AdminHeader } from "./admin-header";

type AdminShellProps = {
  children: ReactNode;
  user: {
    email: string;
    name?: string | null;
    memberships?: Array<{
      tenantId: string;
      tenantSlug: string;
      role: string;
    }>;
  };
};

export function AdminShell({ children, user }: AdminShellProps) {
  return (
    <div className="flex min-h-screen">
      <AdminSidebar user={user} />
      <div className="flex h-screen flex-1 flex-col md:ml-64 overflow-hidden">
        <AdminHeader user={user} />
        <main className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6 bg-gray-50 dark:bg-gray-950">
          {children}
        </main>
      </div>
    </div>
  );
}

