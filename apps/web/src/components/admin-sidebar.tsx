"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Search,
  FileText,
  Settings,
  Building2,
  Users,
  Database,
} from "lucide-react";

type NavItem = {
  label: string;
  href?: string;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  disabled?: boolean;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const sectionColors: Record<string, string> = {
  Main: "text-[#A78BFA]",
  Search: "text-[#34D399]",
  System: "text-[#60A5FA]",
};

const bulletColors: Record<string, string> = {
  Main: "bg-[#A78BFA]",
  Search: "bg-[#34D399]",
  System: "bg-[#60A5FA]",
};

const navSections: NavSection[] = [
  {
    label: "Main",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        disabled: false,
      },
      {
        label: "Documents",
        href: "/dashboard/documents",
        icon: FileText,
        disabled: false,
      },
    ],
  },
  {
    label: "Search",
    items: [
      {
        label: "Search",
        href: "/dashboard/search",
        icon: Search,
        disabled: false,
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        label: "Tenants",
        href: "/dashboard/tenants",
        icon: Building2,
        disabled: false,
      },
      {
        label: "Users",
        href: "/dashboard/users",
        icon: Users,
        disabled: false,
      },
      {
        label: "Settings",
        href: "/dashboard/settings",
        icon: Settings,
        disabled: false,
      },
    ],
  },
];

interface AdminSidebarProps {
  user: {
    email: string;
    name?: string | null;
  };
}

export function AdminSidebar({ user }: AdminSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden bg-background/80 border-r md:flex md:w-64 md:flex-col md:h-screen md:fixed md:left-0 md:top-0">
      {/* Brand */}
      <div className="flex h-14 items-center border-b px-4 shrink-0">
        <div className="flex flex-col">
          <span className="text-sm font-semibold tracking-tight">DocSearch</span>
          <span className="text-xs text-muted-foreground">Document Search Service</span>
        </div>
      </div>

      <ScrollArea className="flex-1 px-2 py-4 min-h-0">
        <nav className="space-y-5">
          {navSections.map((section) => (
            <div key={section.label} className="space-y-1">
              <div
                className={cn(
                  "px-2 text-[11px] font-semibold uppercase tracking-[0.08em]",
                  sectionColors[section.label]
                )}
              >
                {section.label}
              </div>
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  !item.disabled &&
                  item.href &&
                  (pathname === item.href || pathname.startsWith(item.href + "/"));

                const sectionBulletColor = bulletColors[section.label];

                if (item.disabled || !item.href) {
                  return (
                    <Button
                      key={item.label}
                      variant="ghost"
                      size="sm"
                      disabled
                      className={cn(
                        "w-full justify-start gap-2 px-2 text-sm cursor-not-allowed opacity-50"
                      )}
                    >
                      {Icon && <Icon className="h-4 w-4" />}
                      <span>{item.label}</span>
                    </Button>
                  );
                }

                return (
                  <Button
                    key={item.href}
                    asChild
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "w-full justify-start gap-2 px-2 text-sm relative overflow-visible",
                      isActive && "font-semibold"
                    )}
                  >
                    <Link href={item.href}>
                      {isActive && (
                        <span
                          className={cn(
                            "absolute left-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full",
                            sectionBulletColor
                          )}
                        />
                      )}
                      {Icon && <Icon className="h-4 w-4" />}
                      <span>{item.label}</span>
                    </Link>
                  </Button>
                );
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t px-3 py-3 text-xs text-muted-foreground shrink-0">
        <div>Logged in as</div>
        <div className="font-medium">{user.name || user.email}</div>
      </div>
    </aside>
  );
}

