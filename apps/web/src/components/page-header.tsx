"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

type BreadcrumbItem = {
  label: string | React.ReactNode;
  href?: string;
};

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  className?: string;
};

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumbs,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-4 pb-6", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-1 text-xs text-muted-foreground">
          {breadcrumbs.map((item: BreadcrumbItem, idx: number) => {
            const isLast = idx === breadcrumbs.length - 1;
            const content =
              isLast || !item.href ? (
                <span
                  className={cn(isLast && "text-foreground font-medium")}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="hover:text-foreground hover:underline"
                >
                  {item.label}
                </Link>
              );

            return (
              <span key={idx} className="flex items-center gap-1">
                {idx > 0 && <ChevronRight className="h-3 w-3" />}
                {content}
              </span>
            );
          })}
        </nav>
      )}

      <div
        className={cn(
          "flex flex-col md:flex-row md:items-center md:justify-between gap-4"
        )}
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>

        {actions && <div className="flex-shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

