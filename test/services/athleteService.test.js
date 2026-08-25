import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, makeAthlete, fixedClock, collectingLogger, NOW } from '../support/factories.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';
import { createAthleteService } from '../../src/services/athleteService.js';
import { MAX_MESSAGE_LENGTH } from '../../src/domain/message.js';

function setup() {
  const db = testDb(); makeAthlete(db);
  const athleteStore = createAthleteStore(db); const logger = collectingLogger();
  const service = createAthleteService({ athleteStore, clock: fixedClock(NOW), logger });
  return { athleteStore, service, logger };
}

test('updates a valid message, reverts blank text to default, and rejects an overlong message', () => {
  const { athleteStore, service } = setup();
  assert.deepEqual(service.updateMessage(987654, 'Mine'), { ok: true });
  assert.equal(athleteStore.get(987654)?.message, 'Mine');
  assert.deepEqual(service.updateMessage(987654, '  '), { ok: true });
  assert.equal(athleteStore.get(987654)?.message, null);
  const result = service.updateMessage(987654, 'x'.repeat(MAX_MESSAGE_LENGTH + 1));
  assert.ok(!result.ok);
  assert.match(result.error ?? '', /maximum is 200/);
});
