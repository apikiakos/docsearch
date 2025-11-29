"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User } from "lucide-react";
import { SystemStatusWidget } from "@/components/system-status-widget";

interface TopNavProps {
  user: {
    email: string;
    name?: string | null;
    memberships?: Array<{
      tenantId: string;
      tenantSlug: string;
      role: string;
    }>;
  };
}

export default function TopNav({ user }: TopNavProps) {
  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/" });
  };

  const isPlatformAdmin = user.memberships?.some((m) => m.role === "platform_admin");

  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-6">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">Document Search Service</h1>
      </div>
      <div className="flex items-center gap-4">
        {isPlatformAdmin && <SystemStatusWidget />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <span className="hidden md:inline">{user.name || user.email}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{user.name || "User"}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

