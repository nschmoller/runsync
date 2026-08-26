/**
 * Lets the connect flow skip the invite requirement when the app is running
 * against a local BASE_URL, so the signup flow can be exercised in dev
 * without minting a real invite row.
 */
export const LOCAL_DEV_INVITE_TOKEN = '__local-dev__';

/** @param {string} baseUrl */
export function isLocalBaseUrl(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * Where a "Log in" / "reconnect" link should point: the real Strava OAuth
 * flow, or the dev bypass when running against a local BASE_URL.
 * @param {{baseUrl:string}} config
 */
export function loginHref(config) {
  return isLocalBaseUrl(config.baseUrl) ? '/dev/login' : '/login';
}
