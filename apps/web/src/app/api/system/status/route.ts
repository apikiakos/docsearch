import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { elasticsearch } from "@/lib/elasticsearch";
import { redis } from "@/lib/redis";

type ServiceStatus = {
  name: string;
  status: "running" | "stopped" | "unknown";
  url?: string;
  error?: string;
  lastChecked: string;
};

export async function GET() {
  // Only allow platform admins
  const user = await requireAuth();
  const isPlatformAdmin = user.memberships.some(
    (m) => m.role === "platform_admin"
  );

  if (!isPlatformAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const services: ServiceStatus[] = [];
  const now = new Date().toISOString();

  // Check PostgreSQL
  try {
    await prisma.$queryRaw`SELECT 1`;
    services.push({
      name: "PostgreSQL",
      status: "running",
      url: process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@") || "Not configured",
      lastChecked: now,
    });
  } catch (error) {
    services.push({
      name: "PostgreSQL",
      status: "stopped",
      url: process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@") || "Not configured",
      error: error instanceof Error ? error.message : "Connection failed",
      lastChecked: now,
    });
  }

  // Check Elasticsearch
  try {
    await elasticsearch.ping();
    services.push({
      name: "Elasticsearch",
      status: "running",
      url: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
      lastChecked: now,
    });
  } catch (error) {
    services.push({
      name: "Elasticsearch",
      status: "stopped",
      url: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
      error: error instanceof Error ? error.message : "Connection failed",
      lastChecked: now,
    });
  }

  // Check Redis
  try {
    await redis.ping();
    services.push({
      name: "Redis",
      status: "running",
      url: process.env.REDIS_URL?.replace(/:[^:@]+@/, ":****@") || "redis://localhost:6379",
      lastChecked: now,
    });
  } catch (error) {
    services.push({
      name: "Redis",
      status: "stopped",
      url: process.env.REDIS_URL?.replace(/:[^:@]+@/, ":****@") || "redis://localhost:6379",
      error: error instanceof Error ? error.message : "Connection failed",
      lastChecked: now,
    });
  }

  // Check RabbitMQ
  try {
    const rabbitmqUrl = process.env.RABBITMQ_URL || "http://localhost:15672";
    const rabbitmqUser = process.env.RABBITMQ_USER || "guest";
    const rabbitmqPass = process.env.RABBITMQ_PASS || "guest";
    
    // Check RabbitMQ management API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const response = await fetch(`${rabbitmqUrl}/api/overview`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${rabbitmqUser}:${rabbitmqPass}`).toString("base64")}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const displayUrl = rabbitmqUrl.includes("@")
          ? rabbitmqUrl.replace(/:[^:@]+@/, ":****@")
          : rabbitmqUrl;
        services.push({
          name: "RabbitMQ",
          status: "running",
          url: displayUrl,
          lastChecked: now,
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    const displayUrl = process.env.RABBITMQ_URL || "http://localhost:15672";
    services.push({
      name: "RabbitMQ",
      status: "stopped",
      url: displayUrl,
      error: error instanceof Error ? error.message : "Connection failed",
      lastChecked: now,
    });
  }

  return NextResponse.json({ services });
}

