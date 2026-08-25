/** @param {import('express').Application} app @param {string} path @param {RequestInit} [init] */
export async function request(app, path, init) { const server = app.listen(0); try { await new Promise((resolve) => server.once('listening', resolve)); const address = /** @type {any} */ (server.address()); return await fetch(`http://127.0.0.1:${address.port}${path}`, { redirect: 'manual', ...init }); } finally { server.close(); } }
/** @param {Record<string,string>} fields */
export const form = (fields) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
/** @param {unknown} body */
export const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
