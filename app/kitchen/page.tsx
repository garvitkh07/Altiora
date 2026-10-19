import type { Metadata } from "next";
import { KitchenDashboard } from "@/components/kitchen-dashboard";
import { requireStaffAccess } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kitchen dashboard",
  description: "Protected staff view for live restaurant orders.",
};

export default async function KitchenPage() {
  await requireStaffAccess({ nextPath: "/kitchen" });

  return <KitchenDashboard mode="kitchen" />;
}
