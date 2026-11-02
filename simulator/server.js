// Serves the web app and talks to it over a WebSocket at /ws.
// The "suitcase" on the other end is the simulator in suitcase.js.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import { Suitcase } from './suitcase.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = path.join(ROOT, 'web');
const SHARED_DIR = path.join(ROOT, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-cache',
};

function reply(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS });
  res.end(body);
}

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Method not allowed');

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return reply(res, 400, 'Bad request');
  }
  if (pathname.includes('\0')) return reply(res, 400, 'Bad request');
  if (pathname.endsWith('/')) pathname += 'index.html';

  const inShared = pathname.startsWith('/shared/');
  const dir = inShared ? SHARED_DIR : WEB_DIR;
  const file = path.resolve(dir, pathname.slice(inShared ? '/shared/'.length : 1));
  if (!file.startsWith(dir + path.sep)) return reply(res, 403, 'Forbidden');

  const type = MIME[path.extname(file)];
  if (!type) return reply(res, 404, 'Not found');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': type, ...SECURITY_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    reply(res, 404, 'Not found');
  }
}

/**
 * Start the app server.
 * @returns {Promise<{ port: number, suitcase: Suitcase, close: () => Promise<void> }>}
 */
export async function createServer({ port = 8080, host = '127.0.0.1', tickMs = 200, suitcase = new Suitcase() } = {}) {
  const server = http.createServer((req, res) => {
    serveStatic(req, res).catch(() => reply(res, 500, 'Server error'));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  // Only accept sockets opened by pages we served. Without this, any website the
  // user visits could connect to localhost and send commands to the suitcase.
  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      /* fall through */
    }
    let originOk = true;
    if (req.headers.origin) {
      try {
        originOk = new URL(req.headers.origin).host === req.headers.host;
      } catch {
        originOk = false;
      }
    }
    if (pathname !== '/ws' || !originOk) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg) => wss.clients.forEach((ws) => send(ws, msg));
  const publish = () => {
    for (const event of suitcase.drainEvents()) broadcast({ type: 'alert', ...event });
    broadcast(suitcase.snapshot());
  };

  wss.on('connection', (ws) => {
    // ws closes the socket itself on protocol errors (e.g. an oversized message,
    // close code 1009). Without a listener, that error would crash the server.
    ws.on('error', () => {});
    send(ws, { type: 'hello', protocol: PROTOCOL_VERSION, simulated: true });
    send(ws, suitcase.snapshot());

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return send(ws, { type: 'error', message: 'Messages must be JSON.' });
      }
      if (!msg || msg.type !== 'cmd' || typeof msg.cmd !== 'string') {
        return send(ws, { type: 'error', message: 'Expected { type: "cmd", cmd, args }.' });
      }
      const id = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null;
      send(ws, { type: 'ack', id, ...suitcase.handle(msg.cmd, msg.args) });
      publish();
    });
  });

  const ticker = setInterval(() => {
    suitcase.tick(tickMs / 1000);
    publish();
  }, tickMs);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  return {
    port: server.address().port,
    suitcase,
    close: () =>
      new Promise((resolve) => {
        clearInterval(ticker);
        wss.clients.forEach((ws) => ws.terminate());
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
