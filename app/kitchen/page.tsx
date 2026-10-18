import type { Metadata } from "next";
import { KitchenDashboard } from "@/components/kitchen-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kitchen dashboard",
  description: "Protected staff view for live restaurant orders.",
};

export default function KitchenPage() {
  return <KitchenDashboard mode="kitchen" />;
}
