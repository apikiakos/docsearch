import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

/**
 * Cache key for search results
 */
export function getSearchCacheKey(tenantId: string, query: string): string {
  return `search:${tenantId}:${Buffer.from(query).toString("base64")}`;
}

/**
 * Rate limit key for a tenant
 */
export function getRateLimitKey(tenantId: string, userId?: string): string {
  if (userId) {
    return `ratelimit:${tenantId}:user:${userId}`;
  }
  return `ratelimit:${tenantId}:ip`;
}

/**
 * Check rate limit (simple fixed window)
 * Returns true if allowed, false if rate limited
 */
export async function checkRateLimit(
  key: string,
  limit: number = 100,
  windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const current = await redis.incr(key);
  const ttl = await redis.ttl(key);

  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }

  const resetAt = Date.now() + (ttl > 0 ? ttl * 1000 : windowSeconds * 1000);
  const remaining = Math.max(0, limit - current);

  return {
    allowed: current <= limit,
    remaining,
    resetAt,
  };
}

