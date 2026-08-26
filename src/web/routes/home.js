import express from 'express';
import { renderHomePage } from '../views/home.js';
import { headerContext } from '../viewHelpers.js';
import { validateInviteRequest } from '../../domain/inviteRequest.js';

/** @param {{config:any,sessions:any,mailer:import('../../ports/index.js').Mailer,clock:import('../../ports/index.js').Clock,logger:any}} deps */
export function homeRouter({ config, sessions, mailer, clock, logger }) {
  const router = express.Router();

  router.get('/', (req, res) => res.type('html').send(renderHomePage(headerContext(req, { config, sessions, clock }))));

  router.post('/request-invite', async (req, res) => {
    const nav = headerContext(req, { config, sessions, clock });
    const name = String(req.body?.name ?? '');
    const email = String(req.body?.email ?? '');

    // Honeypot: a real visitor never fills this hidden field. Report success
    // without sending mail, so a bot learns nothing from the response.
    if (String(req.body?.company ?? '') !== '') {
      return res.type('html').send(renderHomePage({ ...nav, success: true }));
    }

    const valid = validateInviteRequest({ name, email });
    if (!valid.ok) {
      return res.status(400).type('html').send(renderHomePage({ ...nav, name, email, error: valid.error }));
    }

    try {
      await mailer.send({
        to: config.supportEmail,
        subject: 'racegoal invite request',
        text: `${valid.value.name} <${valid.value.email}> requested an invite to racegoal.`,
      });
    } catch (error) {
      logger.error('invite-request.mail-failed', { message: /** @type {Error} */ (error).message });
      return res.status(502).type('html').send(renderHomePage({
        ...nav, name, email,
        error: `Something went wrong sending your request. Please email ${config.supportEmail} directly instead.`,
      }));
    }

    return res.type('html').send(renderHomePage({ ...nav, success: true }));
  });

  return router;
}
