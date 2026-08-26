export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @param {string} value @returns {boolean} */
export function isValidEmail(value) {
  return EMAIL_PATTERN.test(value);
}
