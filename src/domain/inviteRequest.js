import { isValidEmail } from './email.js';

export const MAX_NAME_LENGTH = 100;

// Every C0 control character plus DEL.
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

/**
 * @param {{name: string|null|undefined, email: string|null|undefined}} input
 * @returns {{ok:true, value:{name:string,email:string}} | {ok:false, error:string}}
 */
export function validateInviteRequest({ name, email }) {
  const cleanedName = String(name ?? '').replace(CONTROL_CHARS, '').trim();
  const cleanedEmail = String(email ?? '').replace(CONTROL_CHARS, '').trim();

  if (cleanedName === '') return { ok: false, error: 'Please enter your name.' };
  if (cleanedName.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `Your name is ${cleanedName.length} characters. The maximum is ${MAX_NAME_LENGTH}.`,
    };
  }

  if (!isValidEmail(cleanedEmail)) return { ok: false, error: 'Please enter a valid email address.' };

  return { ok: true, value: { name: cleanedName, email: cleanedEmail } };
}
