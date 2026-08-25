/** @typedef {{ __raw: string }} RawFragment */

const ENTITIES = /** @type {Record<string,string>} */ ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
});

/** @param {unknown} value @returns {string} */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

/** @param {string} string @returns {RawFragment} */
export function raw(string) {
  return { __raw: String(string) };
}

/** @param {unknown} value @returns {string} */
function render(value) {
  if (Array.isArray(value)) return value.map(render).join('');
  if (value && typeof value === 'object' && '__raw' in value) {
    return /** @type {RawFragment} */ (value).__raw;
  }
  return escapeHtml(value);
}

/**
 * Tagged template that escapes every interpolated value.
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {string}
 */
export function html(strings, ...values) {
  return strings.reduce(
    (out, chunk, i) => out + chunk + (i < values.length ? render(values[i]) : ''),
    '',
  );
}
