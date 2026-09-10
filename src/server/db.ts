import { Pool, type PoolClient } from 'pg';
import { databaseUrl } from './env';

/**
 * Postgres access.
 *
 * One pool per serverless instance, kept small because managed platforms front the
 * database with their own pooler. The schema is created on first use so that deploying
 * needs nothing beyond the two environment variables.
 */

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function getPool(): Pool {
  const url = databaseUrl();
  if (!url) throw new Error('DATABASE_URL is not configured');
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      // Managed Postgres (Neon, Supabase, Vercel) terminates TLS with its own chain.
      ssl: url.includes('sslmode=disable') || url.includes('localhost') ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

const SCHEMA = `
create table if not exists accounts (
  id            text primary key,
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table if not exists sessions (
  id         text primary key,
  owner_id   text not null references accounts(id) on delete cascade,
  device_id  text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists sessions_owner on sessions (owner_id);

create sequence if not exists entity_seq;

create table if not exists entities (
  owner_id    text not null,
  table_name  text not null,
  entity_id   text not null,
  data        jsonb not null,
  rev         integer not null default 1,
  seq         bigint not null,
  removed     boolean not null default false,
  last_device text,
  updated_at  timestamptz not null default now(),
  primary key (owner_id, table_name, entity_id)
);
create index if not exists entities_owner_seq on entities (owner_id, seq);

create table if not exists applied_ops (
  op_id      text primary key,
  owner_id   text not null,
  applied_at timestamptz not null default now()
);
create index if not exists applied_ops_time on applied_ops (applied_at);

create table if not exists conflicts (
  id              text primary key,
  owner_id        text not null,
  table_name      text not null,
  entity_id       text not null,
  field           text not null,
  displaced_value jsonb,
  winning_value   jsonb,
  detected_at     timestamptz not null default now(),
  expires_at      timestamptz not null
);
create index if not exists conflicts_owner on conflicts (owner_id, detected_at desc);

create table if not exists automation_tokens (
  id         text primary key,
  owner_id   text not null references accounts(id) on delete cascade,
  name       text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used  timestamptz,
  revoked_at timestamptz
);

create table if not exists idempotency_keys (
  key        text not null,
  owner_id   text not null,
  response   jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, key)
);

create table if not exists email_inboxes (
  address    text primary key,
  owner_id   text not null references accounts(id) on delete cascade,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists email_ingested (
  message_id text not null,
  owner_id   text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, message_id)
);
`;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getPool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((error: unknown) => {
        // Let the next request retry rather than caching a failed bootstrap forever.
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function query<T extends Record<string, unknown>>(
  text: string, values: unknown[] = [],
): Promise<T[]> {
  await ensureSchema();
  const result = await getPool().query(text, values);
  return result.rows as T[];
}
