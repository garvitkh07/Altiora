import type { Metadata } from "next";
import { KitchenDashboard } from "@/components/kitchen-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reception dashboard",
  description: "Protected staff view for front-of-house orders.",
};

export default function ReceptionPage() {
  return <KitchenDashboard mode="reception" />;
}
