import { loadConfig } from '../src/config.js';
const config = loadConfig(); const base = 'https://www.strava.com/api/v3/push_subscriptions'; const credentials = { client_id: config.clientId, client_secret: config.clientSecret };
/** @param {string} method @param {string} path @param {Record<string,string>} [body] */
async function call(method, path, body) { const response = await fetch(`${base}${path}`, { method, headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}, body: body ? new URLSearchParams(body).toString() : undefined }); const text = await response.text(); if (!response.ok) throw new Error(`${method} ${response.status}: ${text}`); return text ? JSON.parse(text) : {}; }
for (const subscription of await call('GET', `?${new URLSearchParams(credentials)}`)) await call('DELETE', `/${subscription.id}?${new URLSearchParams(credentials)}`);
const created = await call('POST', '', { ...credentials, callback_url: `${config.baseUrl}/webhook`, verify_token: config.webhookVerifyToken });
console.log(`Created subscription ${created.id} for ${config.baseUrl}/webhook`); console.log(`Set STRAVA_SUBSCRIPTION_ID=${created.id} and restart the service.`);
