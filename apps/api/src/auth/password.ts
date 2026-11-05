import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('hex');
export const equalSecret = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'));

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [version, salt, key] = encoded.split('$');
  if (version !== 'scrypt-v1' || !salt || !key || key.length !== 128) return false;
  return timingSafeEqual(Buffer.from(key, 'hex'), await derive(password, salt));
}
