import express from 'express';
import { activityJob } from '../../services/jobs.js';
/** @param {{config: import('../../ports/index.js').Config, athleteStore: import('../../ports/index.js').AthleteStore, activityStore: import('../../ports/index.js').ActivityStore, dataDeletionService: import('../../ports/index.js').DataDeletionService, dispatcher: import('../../ports/index.js').Dispatcher, clock: import('../../ports/index.js').Clock, logger: import('../../ports/index.js').Logger}} deps */
export function webhookRouter({ config, athleteStore, activityStore, dataDeletionService, dispatcher, clock, logger }) { const router = express.Router();
  router.get('/webhook', (req, res) => req.query['hub.verify_token'] === config.webhookVerifyToken ? res.json({ 'hub.challenge': req.query['hub.challenge'] }) : res.sendStatus(403));
  router.post('/webhook', (req, res) => {
    res.sendStatus(200);
    try { activityStore.purgeExpired(clock.now()); } catch (error) { logger.error('retention.purge-failed', { error: error instanceof Error ? error.message : String(error) }); }
    const event = req.body ?? {};
    if (config.subscriptionId !== null && event.subscription_id !== config.subscriptionId) { logger.warn('webhook.foreign-subscription', { subscriptionId: event.subscription_id }); return; }
    if (event.object_type === 'athlete') {
      if (String(event.updates?.authorized) === 'false' && athleteStore.get(event.object_id)) {
        dataDeletionService.deleteAthleteData(event.object_id, { reason: 'deauthorized' })
          .catch((error) => logger.error('athlete.deletion-failed', { athleteId: event.object_id, error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }
    if (event.object_type !== 'activity') return;
    if (event.aspect_type === 'delete') { activityStore.deleteProcessed(event.object_id); return; }
    dispatcher.dispatch(activityJob(event.owner_id, event.object_id));
  });
  return router; }
