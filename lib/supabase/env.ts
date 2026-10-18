export class SupabaseConfigurationError extends Error {
  readonly variableName: string;

  constructor(variableName: string) {
    super(`Supabase configuration is missing or invalid: ${variableName}`);
    this.name = "SupabaseConfigurationError";
    this.variableName = variableName;
  }
}

export interface SupabasePublicEnv {
  url: string;
  anonKey: string;
}

function requiredEnvironmentValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new SupabaseConfigurationError(name);
  }

  return value;
}

function validateSupabaseUrl(value: string) {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }
  } catch {
    throw new SupabaseConfigurationError("NEXT_PUBLIC_SUPABASE_URL");
  }
}

/**
 * Returns only the two public Supabase values needed by both clients.
 * A service-role key is intentionally not read anywhere in the application.
 */
export function getSupabasePublicEnv(): SupabasePublicEnv {
  const url = requiredEnvironmentValue("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requiredEnvironmentValue("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  validateSupabaseUrl(url);

  return { url, anonKey };
}
