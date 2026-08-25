import { html, raw } from '../html.js';
import { MAX_MESSAGE_LENGTH } from '../../domain/message.js';
/** @param {string} title @param {string} body */
export const page = (title, body) => html`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body>${raw(body)}</body></html>`;
/** @param {{config:{appendMessage:string},value?:string|null,error?:string|null}} input */
export function messageField({ config, value = null, error = null }) { return html`${raw(error ? html`<p class="error">${error}</p>` : '')}<label for="message">Your message</label><textarea id="message" name="message" rows="3">${value ?? ''}</textarea><p class="hint">Leave blank to use the default message: <code>${config.appendMessage}</code><br>Up to ${MAX_MESSAGE_LENGTH} characters.</p>`; }
/** @param {string} title @param {string} detail */
export const renderProblem = (title, detail) => page(title, html`<h1>${title}</h1><p>${detail}</p>`);
