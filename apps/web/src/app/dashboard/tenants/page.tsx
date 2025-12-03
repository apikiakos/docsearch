import { redirect } from "next/navigation";

export default function DashboardTenantsRedirect() {
  redirect("/tenants");
}
