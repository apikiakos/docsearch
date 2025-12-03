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
  metrics?: {
    documents?: number;
    messages?: number;
    manifest_entries?: number;
    cache_entries?: number;
  };
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

  // Check PostgreSQL and get file_manifest count
  try {
    await prisma.$queryRaw`SELECT 1`;
    
    // Get file_manifest table count
    let manifestCount = 0;
    try {
      const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM file_manifest
      `;
      manifestCount = Number(result[0]?.count || 0);
    } catch {
      manifestCount = 0;
    }
    
    services.push({
      name: "PostgreSQL",
      status: "running",
      url: process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@") || "Not configured",
      lastChecked: now,
      metrics: {
        manifest_entries: manifestCount,
      },
    });
  } catch (error) {
    services.push({
      name: "PostgreSQL",
      status: "stopped",
      url: process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@") || "Not configured",
      error: error instanceof Error ? error.message : "Connection failed",
      lastChecked: now,
      metrics: {
        manifest_entries: 0,
      },
    });
  }

  // Check Elasticsearch and get document count
  try {
    await elasticsearch.ping();
    
    // Get total document count across all tenant indexes
    let totalDocs = 0;
    try {
      const countResult = await elasticsearch.count({
        index: "docs_*",
      });
      totalDocs = typeof countResult.count === "number" 
        ? countResult.count 
        : 0;
    } catch {
      // If we can't get counts, just set to 0
      totalDocs = 0;
    }
    
    services.push({
      name: "Elasticsearch",
      status: "running",
      url: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
      lastChecked: now,
      metrics: {
        documents: totalDocs,
      },
    });
  } catch (error) {
    services.push({
      name: "Elasticsearch",
      status: "stopped",
      url: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
      error: error instanceof Error ? error.message : "Connection failed",
      lastChecked: now,
      metrics: {
        documents: 0,
      },
    });
  }

  // Check Redis and get cache entry count
  try {
    await redis.ping();
    
    // Count cache entries (keys matching search:* pattern)
    let cacheCount = 0;
    try {
      const keys = await redis.keys("search:*");
      cacheCount = keys.length;
    } catch {
      cacheCount = 0;
    }
    
    services.push({
      name: "Redis",
      status: "running",
      url: process.env.REDIS_URL?.replace(/:[^:@]+@/, ":****@") || "redis://localhost:6379",
      lastChecked: now,
      metrics: {
        cache_entries: cacheCount,
      },
    });
  } catch (error) {
    services.push({
      name: "Redis",
      status: "stopped",
      url: process.env.REDIS_URL?.replace(/:[^:@]+@/, ":****@") || "redis://localhost:6379",
      error: error instanceof Error ? error.message : "Connection failed",
      lastChecked: now,
      metrics: {
        cache_entries: 0,
      },
    });
  }

  // Check FastAPI service
  try {
    const fastapiUrl = process.env.FASTAPI_URL || "http://localhost:8000";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const healthResponse = await fetch(`${fastapiUrl}/health`, {
        signal: controller.signal,
      });

      if (!healthResponse.ok) {
        throw new Error(`HTTP ${healthResponse.status}`);
      }

      clearTimeout(timeoutId);
      services.push({
        name: "FastAPI",
        status: "running",
        url: fastapiUrl,
        lastChecked: now,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      // Provide better error messages
      if (fetchError instanceof Error) {
        if (fetchError.name === "AbortError" || fetchError.message.includes("aborted")) {
          throw new Error("Connection timeout - service not responding");
        }
        if (fetchError.message.includes("ECONNREFUSED") || fetchError.message.includes("fetch failed")) {
          throw new Error("Connection refused - service may not be running");
        }
      }
      throw fetchError;
    }
  } catch (error) {
    const fastapiUrl = process.env.FASTAPI_URL || "http://localhost:8000";
    const errorMessage = error instanceof Error 
      ? (error.message.includes("timeout") ? "Service not responding (timeout)" : error.message)
      : "Connection failed";
    services.push({
      name: "FastAPI",
      status: "stopped",
      url: fastapiUrl,
      error: errorMessage,
      lastChecked: now,
    });
  }

  // Check RabbitMQ and get queue message count
  try {
    const rabbitmqUrl = process.env.RABBITMQ_URL || "http://localhost:15672";
    const rabbitmqUser = process.env.RABBITMQ_USER || "guest";
    const rabbitmqPass = process.env.RABBITMQ_PASS || "guest";
    const queueName = "doc_ingest";
    
    // Check RabbitMQ management API and get queue info
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      // First check overview
      const overviewResponse = await fetch(`${rabbitmqUrl}/api/overview`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${rabbitmqUser}:${rabbitmqPass}`).toString("base64")}`,
        },
        signal: controller.signal,
      });

      if (!overviewResponse.ok) {
        throw new Error(`HTTP ${overviewResponse.status}`);
      }

      // Get queue message count
      let messageCount = 0;
      try {
        const queueResponse = await fetch(`${rabbitmqUrl}/api/queues/%2F/${queueName}`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${rabbitmqUser}:${rabbitmqPass}`).toString("base64")}`,
          },
          signal: controller.signal,
        });

        if (queueResponse.ok) {
          const queueInfo = await queueResponse.json();
          messageCount = queueInfo.messages || 0;
        }
      } catch {
        // Queue might not exist yet, that's okay
        messageCount = 0;
      }

      clearTimeout(timeoutId);

      const displayUrl = rabbitmqUrl.includes("@")
        ? rabbitmqUrl.replace(/:[^:@]+@/, ":****@")
        : rabbitmqUrl;
      services.push({
        name: "RabbitMQ",
        status: "running",
        url: displayUrl,
        lastChecked: now,
        metrics: {
          messages: messageCount,
        },
      });
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
      metrics: {
        messages: 0,
      },
    });
  }

  return NextResponse.json({ services });
}

