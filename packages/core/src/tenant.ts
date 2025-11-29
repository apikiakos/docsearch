export type TenantSlug = "gutenberg" | "govdocs" | "alex-local" | string;

export interface Tenant {
  id: string;
  slug: TenantSlug;
  name: string;
}

export type TenantRole = "tenant_user" | "tenant_admin" | "platform_admin";
