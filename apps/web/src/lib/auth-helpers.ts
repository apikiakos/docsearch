import { auth } from "../auth";
import { prisma } from "./prisma";
import type { TenantRole } from "@distributed-docsearch/core/tenant";

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  memberships: Array<{
    tenantId: string;
    tenantSlug: string;
    role: TenantRole;
  }>;
}

/**
 * Get the current authenticated user with memberships
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await auth();
  if (!session?.user) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    memberships: session.user.memberships || [],
  };
}

/**
 * Check if user has access to a tenant
 */
export function hasTenantAccess(
  user: AuthUser,
  tenantSlug: string
): boolean {
  // Platform admin can access all tenants
  const isPlatformAdmin = user.memberships.some(
    (m) => m.role === "platform_admin"
  );
  if (isPlatformAdmin) {
    return true;
  }

  // Check if user has membership for this tenant
  return user.memberships.some((m) => m.tenantSlug === tenantSlug);
}

/**
 * Get user's role for a specific tenant
 */
export function getUserTenantRole(
  user: AuthUser,
  tenantSlug: string
): TenantRole | null {
  const membership = user.memberships.find((m) => m.tenantSlug === tenantSlug);
  return membership?.role || null;
}

/**
 * Get all tenant slugs the user can access
 */
export async function getUserAccessibleTenants(user: AuthUser): Promise<string[]> {
  // Platform admin can access all tenants
  if (user.memberships.some((m) => m.role === "platform_admin")) {
    // Fetch all tenants from DB
    const tenants = await prisma.tenant.findMany();
    return tenants.map((t) => t.slug);
  }

  return user.memberships.map((m) => m.tenantSlug);
}

/**
 * Require authentication and return user or throw error
 */
export async function requireAuth(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

/**
 * Require tenant access or throw error
 */
export async function requireTenantAccess(
  tenantSlug: string
): Promise<AuthUser> {
  const user = await requireAuth();
  if (!hasTenantAccess(user, tenantSlug)) {
    throw new Error("Forbidden: No access to this tenant");
  }
  return user;
}

