import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";

/**
 * Get current user information including admin status
 */
export async function GET() {
  try {
    const user = await requireAuth();
    
    const isPlatformAdmin = user.memberships.some(
      (m) => m.role === "platform_admin"
    );

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      isPlatformAdmin,
      memberships: user.memberships,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Error fetching current user:", error);
    return NextResponse.json(
      { error: "Failed to fetch user information" },
      { status: 500 }
    );
  }
}

