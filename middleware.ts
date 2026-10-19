import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  getSupabasePublicEnv,
  SupabaseConfigurationError,
} from "@/lib/supabase/env";
import {
  getStaffLoginPath,
  sanitizeStaffNextPath,
} from "@/lib/staff/redirect";

function redirectToStaffLogin(
  request: NextRequest,
  errorCode: Parameters<typeof getStaffLoginPath>[0],
  response: ReturnType<typeof NextResponse.next>,
) {
  const nextPath = sanitizeStaffNextPath(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  const loginUrl = new URL(
    getStaffLoginPath(errorCode, nextPath),
    request.url,
  );
  const redirectResponse = NextResponse.redirect(loginUrl);

  // Auth refresh can happen immediately before an unauthenticated redirect.
  // Carry those refreshed cookies onto the redirect response as well.
  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });

  return redirectResponse;
}

function isProtectedStaffPath(pathname: string) {
  return (
    pathname === "/kitchen" ||
    pathname.startsWith("/kitchen/") ||
    pathname === "/reception" ||
    pathname.startsWith("/reception/")
  );
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const isProtectedPath = isProtectedStaffPath(request.nextUrl.pathname);

  if (!isProtectedPath) {
    return response;
  }

  let publicEnv: ReturnType<typeof getSupabasePublicEnv>;
  try {
    publicEnv = getSupabasePublicEnv();
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      // Keep the app's public surface available when local env values have not
      // been configured yet. The page-level guard handles staff routes too.
      return response;
    }

    return response;
  }

  try {
    const supabase = createServerClient(
      publicEnv.url,
      publicEnv.anonKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => {
              request.cookies.set(name, value);
            });

            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      },
    );

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return redirectToStaffLogin(request, "unauthenticated", response);
    }

    return response;
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return response;
    }

    return redirectToStaffLogin(request, "verification", response);
  }
}

export const config = {
  matcher: ["/kitchen/:path*", "/reception/:path*"],
};
