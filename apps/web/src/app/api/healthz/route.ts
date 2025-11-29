import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { elasticsearch } from "../../../lib/elasticsearch";
import { redis } from "../../../lib/redis";

export async function GET() {
  const dependencies: Record<string, string> = {};

  // Check PostgreSQL
  try {
    await prisma.$queryRaw`SELECT 1`;
    dependencies.database = "ok";
  } catch {
    dependencies.database = "error";
  }

  // Check Elasticsearch
  try {
    await elasticsearch.ping();
    dependencies.elasticsearch = "ok";
  } catch {
    dependencies.elasticsearch = "error";
  }

  // Check Redis
  try {
    await redis.ping();
    dependencies.redis = "ok";
  } catch {
    dependencies.redis = "error";
  }

  const allOk = Object.values(dependencies).every((status) => status === "ok");

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      dependencies,
      timestamp: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 }
  );
}
