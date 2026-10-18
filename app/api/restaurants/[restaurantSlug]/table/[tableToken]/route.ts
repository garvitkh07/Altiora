import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    restaurantSlug: string;
    tableToken: string;
  };
};

type PublicMenuPayload = {
  currency: string;
  restaurant: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logo_url: string | null;
    address: string | null;
    phone: string | null;
  };
  table: {
    id: string;
    label: string;
  };
  categories: Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    category_id: string;
    price: number | string;
    original_price: number | string | null;
    is_veg: boolean;
    is_available: boolean;
    image_url: string | null;
    allergens: string[];
  }>;
};

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error, message: error }, { status });
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_public_menu", {
      p_restaurant_slug: params.restaurantSlug,
      p_table_token: params.tableToken,
    });

    if (error) {
      if (error.code === "P0001") {
        return errorResponse("This menu or table is not available", 404);
      }

      throw error;
    }

    const menu = (Array.isArray(data) ? data[0] : data) as PublicMenuPayload | null;

    if (!menu?.restaurant || !menu.table) {
      return errorResponse("This menu or table is not available", 404);
    }

    const categoryNames = new Map(
      menu.categories.map((category) => [category.id, category.name]),
    );

    return NextResponse.json({
      restaurant: {
        id: menu.restaurant.id,
        name: menu.restaurant.name,
        slug: menu.restaurant.slug,
        description: menu.restaurant.description,
        tagline: menu.restaurant.description,
        logoUrl: menu.restaurant.logo_url,
        address: menu.restaurant.address,
        phone: menu.restaurant.phone,
      },
      // The RPC intentionally omits qr_token; the caller already supplied it.
      table: {
        id: menu.table.id,
        label: menu.table.label,
      },
      currency: menu.currency,
      categories: menu.categories,
      items: menu.items.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        categoryId: item.category_id,
        categoryName: categoryNames.get(item.category_id) ?? null,
        price: Number(item.price),
        originalPrice: item.original_price === null ? null : Number(item.original_price),
        isVegetarian: item.is_veg,
        isAvailable: item.is_available,
        imageUrl: item.image_url,
        allergens: item.allergens ?? [],
      })),
    });
  } catch {
    return errorResponse("The menu could not be loaded right now", 500);
  }
}
