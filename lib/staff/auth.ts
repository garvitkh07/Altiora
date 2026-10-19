import "server-only";

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { SupabaseConfigurationError } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { getStaffLoginPath, type StaffAuthErrorCode } from "./redirect";

export const STAFF_ROLES = ["OWNER", "MANAGER", "STAFF"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export interface StaffAccess {
  user: User;
  membership: {
    restaurantId: string;
    role: StaffRole;
  };
  restaurant: {
    id: string;
    name: string;
    currency: string;
  };
}

export type StaffAccessResult =
  | { ok: true; access: StaffAccess }
  | { ok: false; errorCode: StaffAuthErrorCode };

type MembershipRow = {
  restaurant_id?: unknown;
  role?: unknown;
};

type RestaurantRow = {
  id?: unknown;
  name?: unknown;
  currency?: unknown;
  is_active?: unknown;
};

export function isStaffRole(value: unknown): value is StaffRole {
  return (
    typeof value === "string" &&
    (STAFF_ROLES as readonly string[]).includes(value)
  );
}

function failure(errorCode: StaffAuthErrorCode): StaffAccessResult {
  return { ok: false, errorCode };
}

function isSupabaseConfigurationError(error: unknown) {
  return error instanceof SupabaseConfigurationError;
}

function isRestaurantRow(value: RestaurantRow): value is {
  id: string;
  name: string;
  currency: string;
  is_active: true;
} {
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.currency === "string" &&
    value.is_active === true
  );
}

/**
 * Resolves the signed-in user's staff membership without granting access for
 * authentication alone. This non-redirecting form is also useful to API
 * routes that need to return JSON rather than a navigation response.
 */
export async function getStaffAccess(): Promise<StaffAccessResult> {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;

  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    return failure(
      isSupabaseConfigurationError(error) ? "configuration" : "verification",
    );
  }

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return failure("unauthenticated");
    }

    const { data: membershipRows, error: membershipError } = await supabase
      .from("restaurant_members")
      .select("restaurant_id, role")
      .eq("user_id", user.id)
      .in("role", [...STAFF_ROLES]);

    if (membershipError) {
      return failure("verification");
    }

    const memberships = (membershipRows ?? []) as MembershipRow[];
    const validMemberships = memberships.filter(
      (membership): membership is { restaurant_id: string; role: StaffRole } =>
        typeof membership.restaurant_id === "string" &&
        isStaffRole(membership.role),
    );

    if (validMemberships.length === 0) {
      return failure("unassigned");
    }

    const restaurantIds = validMemberships.map(
      (membership) => membership.restaurant_id,
    );
    const { data: restaurantRows, error: restaurantError } = await supabase
      .from("restaurants")
      .select("id, name, currency, is_active")
      .in("id", restaurantIds);

    if (restaurantError) {
      return failure("verification");
    }

    const restaurant = ((restaurantRows ?? []) as RestaurantRow[]).find(
      isRestaurantRow,
    );

    if (!restaurant) {
      return failure("inactive");
    }

    const membership = validMemberships.find(
      (candidate) => candidate.restaurant_id === restaurant.id,
    );

    if (!membership) {
      return failure("verification");
    }

    return {
      ok: true,
      access: {
        user,
        membership: {
          restaurantId: membership.restaurant_id,
          role: membership.role,
        },
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          currency: restaurant.currency,
        },
      },
    };
  } catch (error) {
    return failure(
      isSupabaseConfigurationError(error) ? "configuration" : "verification",
    );
  }
}

/**
 * Server-component guard for staff pages. `redirect` throws a framework
 * navigation response, so callers must invoke this before rendering.
 */
export async function requireStaffAccess(options?: {
  nextPath?: string | null;
}): Promise<StaffAccess> {
  const result = await getStaffAccess();

  if (!result.ok) {
    redirect(getStaffLoginPath(result.errorCode, options?.nextPath));
  }

  return result.access;
}
