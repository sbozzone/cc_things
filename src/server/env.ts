/**
 * Deployment configuration.
 *
 * The app is fully usable with none of this set: it runs local-first and says so in
 * Settings. Sync and accounts switch on only when both a database and a signing secret
 * are present, so a half-configured deployment never pretends to be syncing.
 */
export function databaseUrl(): string | null {
  return (
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    null
  );
}

export function authSecret(): string | null {
  const secret = process.env.AUTH_SECRET ?? null;
  if (!secret || secret.length < 32) return null;
  return secret;
}

export function syncConfigured(): boolean {
  return databaseUrl() !== null && authSecret() !== null;
}

/** Why sync is unavailable, so the deployment owner sees the actual gap. */
export function configurationProblem(): string | null {
  if (databaseUrl() === null && authSecret() === null) return 'DATABASE_URL and AUTH_SECRET are not set.';
  if (databaseUrl() === null) return 'DATABASE_URL is not set.';
  if (authSecret() === null) return 'AUTH_SECRET is missing or shorter than 32 characters.';
  return null;
}
