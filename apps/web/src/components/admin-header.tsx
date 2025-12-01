"use client";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SystemStatusWidget } from "@/components/system-status-widget";
import { signOut } from "next-auth/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User } from "lucide-react";

interface AdminHeaderProps {
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

export function AdminHeader({ user }: AdminHeaderProps) {
  const isPlatformAdmin = user.memberships?.some((m) => m.role === "platform_admin");
  const userInitials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email[0].toUpperCase();

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/" });
  };

  return (
    <header className="flex h-14 items-center gap-2 border-b bg-background/80 px-4 md:px-6">
      <div className="flex flex-1 items-center gap-2">
        {/* Search input removed - not functional */}
      </div>
      <div className="flex items-center gap-3">
        {isPlatformAdmin && <SystemStatusWidget />}
        {isPlatformAdmin && <div className="h-6 w-px bg-border" />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarFallback>{userInitials}</AvatarFallback>
              </Avatar>
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
              <User className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

