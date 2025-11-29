"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertCircle, Database, Search, Zap, Layers } from "lucide-react";

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

export function SystemStatus() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const response = await fetch("/api/system/status", {
        cache: "no-store",
      });
      if (!response.ok) {
        if (response.status === 403) {
          // Not an admin, don't show this component
          setServices([]);
          return;
        }
        throw new Error("Failed to fetch status");
      }
      const data = await response.json();
      setServices(data.services || []);
    } catch (error) {
      console.error("Failed to fetch system status:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (status: ServiceStatus["status"]) => {
    switch (status) {
      case "running":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "stopped":
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-yellow-500" />;
    }
  };

  const getStatusBadge = (status: ServiceStatus["status"]) => {
    switch (status) {
      case "running":
        return (
          <Badge
            variant="default"
            className="bg-green-500 text-white border-green-600 hover:bg-green-600"
          >
            Running
          </Badge>
        );
      case "stopped":
        return (
          <Badge
            variant="destructive"
            className="bg-red-500 text-white border-red-600 hover:bg-red-600"
          >
            Stopped
          </Badge>
        );
      default:
        return (
          <Badge
            variant="secondary"
            className="bg-gray-400 text-white border-gray-500 hover:bg-gray-500"
          >
            Unknown
          </Badge>
        );
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>System Status</CardTitle>
          <CardDescription>Checking service status...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (services.length === 0) {
    return null; // Not an admin or no services
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>System Status</CardTitle>
            <CardDescription>Monitor system services health</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchStatus} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {services.map((service) => {
            const Icon = SERVICE_ICONS[service.name] || Database;
            return (
              <div key={service.name} className="flex flex-col gap-3 p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(service.status)}
                    <span className="font-semibold">{service.name}</span>
                  </div>
                  {getStatusBadge(service.status)}
                </div>

                {service.url && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">URL</p>
                    <p className="text-xs font-mono break-all bg-muted p-2 rounded">
                      {service.url}
                    </p>
                  </div>
                )}

                {service.error && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-destructive">Error</p>
                    <p className="text-xs text-destructive bg-destructive/10 p-2 rounded break-all">
                      {service.error}
                    </p>
                  </div>
                )}

                <div className="mt-auto pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    Checked: {new Date(service.lastChecked).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

