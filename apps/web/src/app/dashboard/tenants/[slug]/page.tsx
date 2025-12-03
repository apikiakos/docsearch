import { redirect } from "next/navigation";

type Context = {
  params: Promise<{ slug: string }>;
};

export default async function DashboardTenantDetailRedirect(context: Context) {
  const { slug } = await context.params;
  redirect(`/tenants/${slug}`);
}
