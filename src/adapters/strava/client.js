import { StravaError } from './errors.js';

/** @typedef {import('../../ports/index.js').Config} Config */
/** @typedef {import('../../ports/index.js').StravaClient} StravaClient */

const BASE = 'https://www.strava.com';
const MAX_ERROR_DETAIL = 200;

/**
 * @param {string} path
 * @param {{ method?: string, token?: string, form?: Record<string, string|number> }} [options]
 */
async function request(path, { method = 'GET', token, form } = {}) {
  /** @type {Record<string,string>} */
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form ? new URLSearchParams(/** @type {any} */ (form)).toString() : undefined,
  });

  const text = await response.text();
  if (!response.ok) throw new StravaError(response.status, text.slice(0, MAX_ERROR_DETAIL));
  return text === '' ? {} : JSON.parse(text);
}

/**
 * Dumb HTTP. Holds no state and never touches the database — the stateful
 * refresh path lives in tokens.js, which is where the lock belongs.
 *
 * @param {{ config: Config }} deps
 * @returns {StravaClient}
 */
export function createStravaClient({ config }) {
  const credentials = { client_id: config.clientId, client_secret: config.clientSecret };

  return {
    async exchangeCode(code) {
      const tokens = await request('/oauth/token', {
        method: 'POST',
        form: { ...credentials, code, grant_type: 'authorization_code' },
      });
      return {
        athleteId: tokens.athlete.id,
        name: [tokens.athlete.firstname, tokens.athlete.lastname].filter(Boolean).join(' '),
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_at,
      };
    },

    async refresh(refreshToken) {
      const tokens = await request('/oauth/token', {
        method: 'POST',
        form: { ...credentials, grant_type: 'refresh_token', refresh_token: refreshToken },
      });
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_at,
      };
    },

    getActivity: (token, activityId) => request(`/api/v3/activities/${activityId}`, { token }),

    async updateActivity(token, activityId, { description }) {
      await request(`/api/v3/activities/${activityId}`, { method: 'PUT', token, form: { description } });
    },

    listRecentActivities: (token, perPage) =>
      request(`/api/v3/athlete/activities?per_page=${perPage}`, { token }),

    async deauthorize(token) {
      await request('/oauth/deauthorize', { method: 'POST', token, form: { access_token: token } });
    },
  };
}
