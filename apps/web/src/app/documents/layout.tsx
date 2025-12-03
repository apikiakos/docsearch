import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminShell } from "@/components/admin-shell";

export default async function DocumentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect("/");
  }

  return <AdminShell user={session.user}>{children}</AdminShell>;
}

