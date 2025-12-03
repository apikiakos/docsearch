import { redirect } from "next/navigation";

type Context = {
  params: Promise<{ id: string }>;
};

export default async function DashboardUserDetailRedirect(context: Context) {
  const { id } = await context.params;
  redirect(`/users/${id}`);
}
