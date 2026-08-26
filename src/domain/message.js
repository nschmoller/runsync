/** @typedef {import('../ports/index.js').ValidationResult} ValidationResult */

export const MAX_MESSAGE_LENGTH = 200;
export const GOAL_DIVIDER = '- - - 🎯 Goal - - -';

// Every C0 control character plus DEL, except newline (0x0A).
const CONTROL_CHARS = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g;

/**
 * Cleans and checks athlete-supplied message text.
 *
 * A blank result is `null`, not `''`: null means "track APPEND_MESSAGE", which
 * is what an empty input on either form is meant to express.
 *
 * @param {string|null|undefined} raw
 * @returns {ValidationResult}
 */
export function validateMessage(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };

  const cleaned = String(raw)
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleaned === '') return { ok: true, value: null };

  // Measured after cleaning, so trailing whitespace cannot fail a valid message.
  if (cleaned.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `Your message is ${cleaned.length} characters. The maximum is ${MAX_MESSAGE_LENGTH}.`,
    };
  }

  return { ok: true, value: cleaned };
}

/**
 * The effective message for an athlete.
 * @param {{ message: string|null }} athlete
 * @param {{ appendMessage: string }} config
 * @returns {string}
 */
export function resolveMessage(athlete, config) {
  return `${GOAL_DIVIDER}\n${athlete.message ?? config.appendMessage}`;
}

/**
 * Secondary back-fill guard. `includes`, never `endsWith`: an athlete who types
 * anything after the appended message would otherwise get a second copy.
 * @param {string|null|undefined} description
 * @param {string} message
 * @returns {boolean}
 */
export function hasMessage(description, message) {
  if (!description) return false;
  return description.includes(message);
}

/**
 * @param {string|null|undefined} description
 * @param {string} message
 * @returns {string}
 */
export function appendMessage(description, message) {
  const existing = (description ?? '').replace(/\s+$/, '');
  return existing === '' ? message : `${existing}\n\n${message}`;
}
