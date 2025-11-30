import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from project root (three levels up from apps/web/prisma/seed.ts)
config({ path: resolve(__dirname, "../../../.env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database...");

  // Create tenants
  const tenants = [
    { slug: "gutenberg", name: "Project Gutenberg" },
    { slug: "govdocs", name: "Government Documents" },
    { slug: "alex-local", name: "Alex Local" },
    { slug: "s3-tenant-1", name: "S3 Tenant 1" },
    { slug: "s3-tenant-2", name: "S3 Tenant 2" },
  ];

  const createdTenants = [];
  for (const tenant of tenants) {
    const created = await prisma.tenant.upsert({
      where: { slug: tenant.slug },
      update: {},
      create: tenant,
    });
    createdTenants.push(created);
    console.log(`✅ Created tenant: ${tenant.slug}`);
  }

  // Create admin user
  const adminPasswordHash = await bcrypt.hash("admin123", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      name: "Platform Admin",
      passwordHash: adminPasswordHash,
    },
  });

  // Create admin memberships for all tenants (platform_admin role)
  for (const tenant of createdTenants) {
    await prisma.membership.upsert({
      where: {
        userId_tenantId: {
          userId: admin.id,
          tenantId: tenant.id,
        },
      },
      update: { role: "platform_admin" },
      create: {
        userId: admin.id,
        tenantId: tenant.id,
        role: "platform_admin",
      },
    });
  }
  console.log("✅ Created admin user: admin@example.com (password: admin123) with access to all tenants");

  // Create tenant users (one for each tenant)
  const tenantUsers = [
    { email: "gutenberg@example.com", name: "Gutenberg User", tenantSlug: "gutenberg" },
    { email: "govdocs@example.com", name: "GovDocs User", tenantSlug: "govdocs" },
    { email: "alex@example.com", name: "Alex User", tenantSlug: "alex-local" },
    { email: "s3-tenant-1@example.com", name: "S3 Tenant 1 User", tenantSlug: "s3-tenant-1" },
    { email: "s3-tenant-2@example.com", name: "S3 Tenant 2 User", tenantSlug: "s3-tenant-2" },
  ];

  const userPasswordHash = await bcrypt.hash("user123", 10);

  for (const userData of tenantUsers) {
    const tenant = createdTenants.find((t) => t.slug === userData.tenantSlug);
    if (!tenant) continue;

    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {},
      create: {
        email: userData.email,
        name: userData.name,
        passwordHash: userPasswordHash,
      },
    });

    await prisma.membership.upsert({
      where: {
        userId_tenantId: {
          userId: user.id,
          tenantId: tenant.id,
        },
      },
      update: { role: "tenant_user" },
      create: {
        userId: user.id,
        tenantId: tenant.id,
        role: "tenant_user",
      },
    });

    console.log(`✅ Created user: ${userData.email} (password: user123) for tenant: ${userData.tenantSlug}`);
  }

  console.log("🎉 Seeding completed!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

