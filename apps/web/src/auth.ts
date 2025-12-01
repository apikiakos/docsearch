import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./lib/prisma";
import bcrypt from "bcryptjs";
import type { TenantRole } from "@distributed-docsearch/core/tenant";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: {
            memberships: {
              include: {
                tenant: true,
              },
            },
          },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          memberships: user.memberships.map((m: { tenantId: string; tenant: { slug: string }; role: string }) => ({
            tenantId: m.tenantId,
            tenantSlug: m.tenant.slug,
            role: m.role as TenantRole,
          })),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.memberships = (user as { memberships?: unknown[] }).memberships || [];
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.memberships = (token.memberships as Array<{
          tenantId: string;
          tenantSlug: string;
          role: TenantRole;
        }>) || [];
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
  session: {
    strategy: "jwt",
  },
});

declare module "next-auth" {
  interface User {
    id: string;
    memberships?: Array<{
      tenantId: string;
      tenantSlug: string;
      role: TenantRole;
    }>;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      memberships?: Array<{
        tenantId: string;
        tenantSlug: string;
        role: TenantRole;
      }>;
    };
  }
}

