import type { Metadata } from "next";
import { CustomerMenu } from "@/components/customer-menu";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Menu",
  description: "Explore the menu and order from your table.",
};

export default function RestaurantTablePage({
  params,
}: {
  params: { restaurantSlug: string; tableToken: string };
}) {
  return <CustomerMenu restaurantSlug={params.restaurantSlug} tableToken={params.tableToken} />;
}
