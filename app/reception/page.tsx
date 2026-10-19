import type { Metadata } from "next";
import { KitchenDashboard } from "@/components/kitchen-dashboard";
import { requireStaffAccess } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reception dashboard",
  description: "Protected staff view for front-of-house orders.",
};

export default async function ReceptionPage() {
  await requireStaffAccess({ nextPath: "/reception" });

  return <KitchenDashboard mode="reception" />;
}
