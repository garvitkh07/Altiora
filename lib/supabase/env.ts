export class SupabaseConfigurationError extends Error {
  readonly variableName: string;

  constructor(variableName: string) {
    super(
      `Supabase configuration is missing or invalid: ${variableName}`,
    );

    this.name = "SupabaseConfigurationError";
    this.variableName = variableName;
  }
}

export interface SupabasePublicEnv {
  url: string;
  anonKey: string;
}

type PublicEnvironmentVariable =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY";

function requiredEnvironmentValue(
  value: string | undefined,
  name: PublicEnvironmentVariable,
): string {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new SupabaseConfigurationError(name);
  }

  return normalizedValue;
}

function validateSupabaseUrl(value: string): void {
  try {
    const parsed = new URL(value);

    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      !parsed.hostname
    ) {
      throw new Error("Unsupported Supabase URL");
    }
  } catch {
    throw new SupabaseConfigurationError(
      "NEXT_PUBLIC_SUPABASE_URL",
    );
  }
}

/**
 * Reads only public Supabase configuration.
 * Environment variables are referenced explicitly so Next.js
 * can inline NEXT_PUBLIC values into the browser bundle.
 *
 * Never add a service-role or secret key here.
 */
export function getSupabasePublicEnv(): SupabasePublicEnv {
  const url = requiredEnvironmentValue(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL",
  );

  const anonKey = requiredEnvironmentValue(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );

  validateSupabaseUrl(url);

  return {
    url,
    anonKey,
  };
}