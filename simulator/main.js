import { createServer } from './server.js';

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

const app = await createServer({ port, host });
console.log(`Simulated suitcase ready: http://${host === '0.0.0.0' ? 'localhost' : host}:${app.port}`);
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.warn('Listening beyond this computer. The simulator has no login, so only do this on a network you trust.');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => app.close().then(() => process.exit(0)));
}
