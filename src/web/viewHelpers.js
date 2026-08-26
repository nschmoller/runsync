import { loginHref } from '../domain/localDev.js';
import { isLoggedIn } from './middleware/auth.js';

/** Shared header/nav context (login link vs. dashboard link) for every page
 * built on the site layout, so header state stays consistent everywhere.
 * @param {any} req @param {{config:any,sessions:any,clock:import('../ports/index.js').Clock}} deps
 */
export function headerContext(req, { config, sessions, clock }) {
  return { loginUrl: loginHref(config), loggedIn: isLoggedIn(req, { sessions, clock }) };
}
