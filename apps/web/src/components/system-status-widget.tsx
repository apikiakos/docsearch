"use client";

import { useState, useEffect, useMemo } from "react";
import { Database, Search, Zap, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { SystemStatus } from "@/components/system-status";
import { cn } from "@/lib/utils";

type ServiceStatus = {
  name: string;
  status: "running" | "stopped" | "unknown";
  url?: string;
  error?: string;
  lastChecked: string;
};

const SERVICE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  PostgreSQL: Database, // Database icon for PostgreSQL
  Elasticsearch: Search, // Search icon for Elasticsearch (search engine)
  Redis: Zap, // Zap icon for Redis (fast cache/memory)
  RabbitMQ: Layers, // Layers icon for RabbitMQ (message queue/stack)
};

const STATUS_VARIANTS: Record<string, "default" | "destructive" | "secondary"> = {
  running: "default",
  stopped: "destructive",
  unknown: "secondary",
};

function SystemStatusContent() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch("/api/system/status", {
          cache: "no-store",
        });
        if (response.ok) {
          const data = await response.json();
          setServices(data.services || []);
        } else if (response.status === 403) {
          // Not an admin
          setServices([]);
        }
      } catch (error) {
        console.error("Failed to fetch system status:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Poll every 30 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading && services.length === 0) {
    return <SystemStatusSkeleton />;
  }

  if (services.length === 0) {
    return null; // Not an admin
  }

  return (
    <div className="flex items-center gap-2">
      {services.map((service) => {
        const Icon = SERVICE_ICONS[service.name] || Database;
        const variant = STATUS_VARIANTS[service.status] || "secondary";
        const statusText = `${service.name} ${service.status}`;

        return (
          <HoverCard key={service.name}>
            <HoverCardTrigger asChild>
              <Badge
                variant={variant}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-0.5 h-6 cursor-pointer transition-colors",
                  service.status === "running" &&
                    "bg-green-500 hover:bg-green-600 text-white border-green-600",
                  service.status === "stopped" &&
                    "bg-red-500 hover:bg-red-600 text-white border-red-600",
                  service.status === "unknown" &&
                    "bg-gray-400 hover:bg-gray-500 text-white border-gray-500"
                )}
                title={statusText}
              >
                <Icon className="h-3 w-3" />
                <div
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    service.status === "running" && "bg-white",
                    service.status === "stopped" && "bg-white",
                    service.status === "unknown" && "bg-white/70"
                  )}
                />
              </Badge>
            </HoverCardTrigger>
            <HoverCardContent className="w-[500px] p-4" side="bottom" align="start">
              <ServiceDetailCard service={service} />
            </HoverCardContent>
          </HoverCard>
        );
      })}
    </div>
  );
}

function ServiceDetailCard({ service }: { service: ServiceStatus }) {
  const Icon = SERVICE_ICONS[service.name] || Database;
  const variant = STATUS_VARIANTS[service.status] || "secondary";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold text-lg">{service.name}</h3>
        </div>
        <Badge
          variant={variant}
          className={cn(
            service.status === "running" && "bg-green-500 text-white border-green-600",
            service.status === "stopped" && "bg-red-500 text-white border-red-600",
            service.status === "unknown" && "bg-gray-400 text-white border-gray-500"
          )}
        >
          {service.status}
        </Badge>
      </div>

      {service.url && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">URL</p>
          <p className="text-sm font-mono break-all bg-muted p-2 rounded">{service.url}</p>
        </div>
      )}

      {service.error && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-destructive">Error</p>
          <p className="text-sm text-destructive bg-destructive/10 p-2 rounded break-all">
            {service.error}
          </p>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        Last checked: {new Date(service.lastChecked).toLocaleString()}
      </div>
    </div>
  );
}

function SystemStatusSkeleton() {
  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3, 4].map((i) => (
        <Badge key={i} variant="secondary" className="h-6 w-12 animate-pulse">
          <div className="h-3 w-3 rounded bg-muted" />
        </Badge>
      ))}
    </div>
  );
}

export function SystemStatusWidget({ locale }: { locale?: string }) {
  if (typeof window === "undefined") {
    return <SystemStatusSkeleton />;
  }
  return <SystemStatusContent />;
}

