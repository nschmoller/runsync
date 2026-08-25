import { html, raw } from '../html.js'; import { page, messageField } from './layout.js';
/** @param {{config:any,inviteToken:string,message?:string|null,error?:string|null}} input */
export function renderConnectPage({ config, inviteToken, message = null, error = null }) { return page('Connect to runsync', html`<h1>Connect your Strava account</h1><p>runsync adds your message to new ${[...config.sportTypes].join(' and ')} activities.</p><form method="post" action="/connect"><input type="hidden" name="invite" value="${inviteToken}">${raw(messageField({ config, value: message, error }))}<button>Connect with Strava</button></form>`); }
export const renderInvalidInvite = () => page('Invite not valid', html`<h1>This invite link is no longer valid</h1><p>Ask for a fresh one.</p>`);
