import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LoginForm from "@/components/login-form";

export default async function Home() {
  const session = await auth();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <LoginForm />
    </div>
  );
}
