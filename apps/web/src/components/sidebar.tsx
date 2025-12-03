"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { 
  Search, 
  Settings, 
  LayoutDashboard 
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Documents",
    href: "/documents",
    icon: Search,
  },
  {
    name: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-sidebar">
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center border-b px-6">
          <h2 className="text-lg font-semibold">DocSearch</h2>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {navigation.map((item: { name: string; href: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>> }) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link key={item.name} href={item.href}>
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start",
                    isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {item.name}
                </Button>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

