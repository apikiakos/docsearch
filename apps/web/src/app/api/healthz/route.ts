import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { elasticsearch } from "../../../lib/elasticsearch";
import { redis } from "../../../lib/redis";

export async function GET() {
  const dependencies: Record<string, string | number> = {};
  const metrics: Record<string, number> = {};

  // Check PostgreSQL and get file_manifest count
  try {
    await prisma.$queryRaw`SELECT 1`;
    dependencies.database = "ok";
    
    // Get file_manifest table count
    try {
      const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM file_manifest
      `;
      metrics.postgres_manifest_entries = Number(result[0]?.count || 0);
    } catch {
      metrics.postgres_manifest_entries = 0;
    }
  } catch {
    dependencies.database = "error";
    metrics.postgres_manifest_entries = 0;
  }

  // Check Elasticsearch and get document count
  try {
    await elasticsearch.ping();
    dependencies.elasticsearch = "ok";
    
    // Get total document count across all tenant indexes
    try {
      const countResult = await elasticsearch.count({
        index: "docs_*",
      });
      metrics.elasticsearch_documents = typeof countResult.count === "number" 
        ? countResult.count 
        : 0;
    } catch {
      // If we can't get counts, just set to 0
      metrics.elasticsearch_documents = 0;
    }
  } catch {
    dependencies.elasticsearch = "error";
    metrics.elasticsearch_documents = 0;
  }

  // Check Redis and get cache entry count
  try {
    await redis.ping();
    dependencies.redis = "ok";
    
    // Count cache entries (keys matching search:* pattern)
    try {
      const keys = await redis.keys("search:*");
      metrics.redis_cache_entries = keys.length;
    } catch {
      metrics.redis_cache_entries = 0;
    }
  } catch {
    dependencies.redis = "error";
    metrics.redis_cache_entries = 0;
  }

  // Check RabbitMQ and get queue message count
  try {
    const rabbitmqUrl = process.env.RABBITMQ_URL || "http://localhost:15672";
    const rabbitmqUser = process.env.RABBITMQ_USER || "guest";
    const rabbitmqPass = process.env.RABBITMQ_PASS || "guest";
    const queueName = "doc_ingest";
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const response = await fetch(`${rabbitmqUrl}/api/queues/%2F/${queueName}`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${rabbitmqUser}:${rabbitmqPass}`).toString("base64")}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const queueInfo = await response.json();
        dependencies.rabbitmq = "ok";
        metrics.rabbitmq_messages = queueInfo.messages || 0;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch {
    dependencies.rabbitmq = "error";
    metrics.rabbitmq_messages = 0;
  }

  const allOk = Object.values(dependencies).every((status) => status === "ok");

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      dependencies,
      metrics,
      timestamp: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 }
  );
}
