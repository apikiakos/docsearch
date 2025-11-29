import { NextResponse } from "next/server";
import { requireAuth, getUserAccessibleTenants } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireAuth();
    const accessibleSlugs = await getUserAccessibleTenants(user);

    // Fetch tenant details
    const tenants = await prisma.tenant.findMany({
      where: {
        slug: {
          in: accessibleSlugs,
        },
      },
      select: {
        id: true,
        slug: true,
        name: true,
      },
    });

    return NextResponse.json({ tenants });
  } catch (error) {
    console.error("Error fetching accessible tenants:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to fetch tenants" },
      { status: 500 }
    );
  }
}

