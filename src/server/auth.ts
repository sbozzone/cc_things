import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { authSecret } from './env';
import { query } from './db';

/**
 * Account access and session handling (R32).
 *
 * Passwords are stored as scrypt hashes, never in plain text. The session cookie is
 * httpOnly and carries a signed session id, so it cannot be forged or read by scripts,
 * and revoking a session ends its remote access immediately.
 */

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
export const SESSION_COOKIE = 'clearing_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 90;

export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const options = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) };
  const salt = Buffer.from(parts[4] as string, 'base64');
  const expected = Buffer.from(parts[5] as string, 'base64');
  const derived = await scryptAsync(password, salt, expected.length, options);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function sign(value: string): string {
  const secret = authSecret();
  if (!secret) throw new Error('AUTH_SECRET is not configured');
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueSessionCookieValue(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

function readSessionId(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return null;
  const sessionId = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  let expected: string;
  try {
    expected = sign(sessionId);
  } catch {
    return null;
  }
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return sessionId;
}

export interface Session {
  sessionId: string;
  ownerId: string;
  email: string;
}

/** Resolves the caller, or null. Every read and write must run through this (R32). */
export async function currentSession(): Promise<Session | null> {
  const store = await cookies();
  const sessionId = readSessionId(store.get(SESSION_COOKIE)?.value);
  if (!sessionId) return null;

  const rows = await query<{ owner_id: string; email: string }>(
    `select s.owner_id, a.email
       from sessions s
       join accounts a on a.id = s.owner_id
      where s.id = $1 and s.revoked_at is null and a.deleted_at is null`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) return null;
  return { sessionId, ownerId: row.owner_id, email: row.email };
}

export async function setSessionCookie(sessionId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, issueSessionCookieValue(sessionId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length < 10 || value.length > 512) return null;
  return value;
}
