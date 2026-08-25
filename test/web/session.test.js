import { test } from 'node:test'; import assert from 'node:assert/strict'; import { createSessions } from '../../src/web/session.js';
const NOW = 1_800_000_000; const sessions = createSessions('a'.repeat(32));
test('sessions sign, verify, and reject tampering or expiry', () => { const value=sessions.sign(987654,NOW+60); assert.equal(sessions.verify(value,NOW),987654); assert.equal(sessions.verify(value.replace('987654','1'),NOW),null); assert.equal(sessions.verify(sessions.sign(1,NOW),NOW),null); });
test('CSRF tokens bind to an exact session', () => { const one=sessions.sign(1,NOW+60), two=sessions.sign(2,NOW+60), token=sessions.csrfToken(one); assert.equal(sessions.verifyCsrf(one,token),true); assert.equal(sessions.verifyCsrf(two,token),false); });
