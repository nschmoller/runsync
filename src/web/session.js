import crypto from 'node:crypto';
export const COOKIE_NAME = 'racegoal_session';
export const MAX_AGE_SECONDS = 30 * 24 * 3600;
/** @param {string} secret @param {string} value */
const hmac = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
/** @param {unknown} a @param {unknown} b */
const equal = (a, b) => { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && crypto.timingSafeEqual(left, right); };
/** @param {string} secret */
export function createSessions(/** @type {string} */ secret) { return {
  COOKIE_NAME, MAX_AGE_SECONDS,
  sign(/** @type {number} */ athleteId, /** @type {number} */ expiresAt) { const value = `${athleteId}.${expiresAt}`; return `${value}.${hmac(secret, value)}`; },
  verify(/** @type {unknown} */ value, /** @type {number} */ now) { if (typeof value !== 'string') return null; const parts = value.split('.'); if (parts.length !== 3) return null; const [id = '', expiry = '', signature = ''] = parts; if (!equal(signature, hmac(secret, `${id}.${expiry}`)) || !/^\d+$/.test(id) || !/^\d+$/.test(expiry) || Number(expiry) <= now) return null; return Number(id); },
  cookieOptions() { return { httpOnly: true, secure: true, sameSite: /** @type {const} */ ('lax'), path: '/', maxAge: MAX_AGE_SECONDS }; },
  csrfToken(/** @type {string} */ value) { return hmac(secret, `csrf:${value}`); },
  verifyCsrf(/** @type {string} */ value, /** @type {unknown} */ token) { return typeof token === 'string' && token !== '' && equal(token, hmac(secret, `csrf:${value}`)); },
}; }
