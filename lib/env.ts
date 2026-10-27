// Central, validated access to configuration. Missing values raise a
// ConfigError whose message names the variable but never contains a value.

export class ConfigError extends Error {
  constructor(name: string) {
    super(`Missing or invalid server configuration: ${name}`);
    this.name = 'ConfigError';
  }
}

// NEXT_PUBLIC_* must be referenced literally so Next.js can inline them.
export function publicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) throw new ConfigError('NEXT_PUBLIC_SUPABASE_URL');
  if (!key) throw new ConfigError('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  return { supabaseUrl: url, publishableKey: key };
}

export function serverEnv() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const signingSecret = process.env.SESSION_SIGNING_SECRET;
  if (!secretKey) throw new ConfigError('SUPABASE_SECRET_KEY');
  if (!signingSecret || signingSecret.length < 32) throw new ConfigError('SESSION_SIGNING_SECRET');
  return { ...publicEnv(), secretKey, signingSecret };
}
