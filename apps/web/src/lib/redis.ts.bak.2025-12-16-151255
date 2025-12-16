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
 * Uses Lua script for atomic increment + TTL setting to prevent race conditions
 * Returns true if allowed, false if rate limited
 */
const rateLimitScript = `
  local key = KEYS[1]
  local window = tonumber(ARGV[1])
  local current = redis.call('INCR', key)
  if current == 1 then
    redis.call('EXPIRE', key, window)
  end
  local ttl = redis.call('TTL', key)
  return {current, ttl}
`;

export async function checkRateLimit(
  key: string,
  limit: number = 100,
  windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  // Use Lua script for atomic increment + TTL setting
  const result = await redis.eval(
    rateLimitScript,
    1, // number of keys
    key, // KEYS[1]
    windowSeconds.toString() // ARGV[1]
  ) as [number, number]; // [current, ttl]

  const current = result[0];
  const ttl = result[1];

  // Calculate reset time: if TTL is valid, use it; otherwise use windowSeconds
  const resetAt = Date.now() + (ttl > 0 ? ttl * 1000 : windowSeconds * 1000);
  const remaining = Math.max(0, limit - current);

  return {
    allowed: current <= limit,
    remaining,
    resetAt,
  };
}

