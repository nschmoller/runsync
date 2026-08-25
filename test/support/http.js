import { MockAgent, setGlobalDispatcher } from 'undici';

/**
 * Intercepts global fetch with net connect disabled, so a test that forgets to
 * stub a call fails loudly instead of reaching the real Strava API.
 */
export function mockStrava() {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return {
    pool: agent.get('https://www.strava.com'),
    async close() {
      await agent.close();
    },
  };
}
