import { loadConfig } from './config.js';
import { buildContainer } from './container.js';
import { createApp } from './web/app.js';
const config = loadConfig(); const container = buildContainer(config);
const server = createApp(container).listen(config.port, () => container.logger.info('server.started', { port: config.port }));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(async () => { await container.dispatcher.drain(); container.close(); process.exit(0); }));
