import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv } from "./env";

let browserClient: SupabaseClient | undefined;

/** Creates the browser Supabase client using only public, RLS-protected credentials. */
export function createSupabaseBrowserClient(): SupabaseClient {
  if (!browserClient) {
    const { url, anonKey } = getSupabasePublicEnv();
    browserClient = createBrowserClient(url, anonKey);
  }

  return browserClient;
}

// This alias follows the name used by the Supabase Next.js examples.
export const createClient = createSupabaseBrowserClient;
