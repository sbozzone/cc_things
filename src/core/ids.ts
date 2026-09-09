/**
 * Stable client-generated ids (spec §12). Ids are minted offline and never reassigned,
 * which is what lets an offline device queue work that converges on the server (R33, R34).
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** Time-ordered id: a base-36 timestamp prefix plus 12 random characters. */
export function newId(prefix = ''): string {
  const time = Date.now().toString(36).padStart(9, '0');
  const bytes = randomBytes(12);
  let tail = '';
  for (let i = 0; i < bytes.length; i++) tail += ALPHABET[(bytes[i] as number) % ALPHABET.length];
  return `${prefix}${time}${tail}`;
}

export function newDeviceId(): string {
  return newId('dev_');
}
