import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { createServer } from '../simulator/server.js';

let app;
before(async () => {
  app = await createServer({ port: 0, tickMs: 25 });
});
after(() => app.close());

const rawGet = (pathname) =>
  new Promise((resolve, reject) => {
    // http.get with a raw path, so ".." is not normalised away by a URL parser.
    http
      .get({ host: '127.0.0.1', port: app.port, path: pathname }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on('error', reject);
  });

// A tiny client that remembers every message and lets a test wait for one.
async function connect(headers = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`, { headers });
  const inbox = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    inbox.push(msg);
    for (const w of [...waiters]) if (w.test(msg)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(msg));
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error('rejected'), { status: res.statusCode })));
  });
  const next = (test) =>
    new Promise((resolve, reject) => {
      const hit = inbox.find(test);
      if (hit) return resolve(hit);
      const timer = setTimeout(() => reject(new Error('timed out waiting for message')), 2000);
      waiters.push({ test, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  const call = async (cmd, args, id = Math.random()) => {
    ws.send(JSON.stringify({ type: 'cmd', id, cmd, args }));
    return next((m) => m.type === 'ack' && m.id === id);
  };
  return { ws, inbox, next, call };
}

test('serves the web app with security headers', async () => {
  const res = await rawGet('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.match(res.body, /<title>/);
  assert.equal((await rawGet('/shared/constants.js')).status, 200);
  assert.equal((await rawGet('/src/main.js')).status, 200);
});

test('does not serve files outside the web and shared folders', async () => {
  for (const p of ['/..%2fpackage.json', '/%2e%2e/package.json', '/shared/..%2f..%2fpackage.json', '/src/%00.js']) {
    const res = await rawGet(p);
    assert.ok([400, 403, 404].includes(res.status), `${p} -> ${res.status}`);
    assert.doesNotMatch(res.body, /"name": "electric-suitcase-controller"/);
  }
  assert.equal((await rawGet('/package.json')).status, 404);
  assert.equal((await rawGet('/nope.js')).status, 404);
});

test('a new connection gets hello then the full state', async () => {
  const c = await connect();
  const hello = await c.next((m) => m.type === 'hello');
  assert.equal(hello.protocol, 1);
  const state = await c.next((m) => m.type === 'state');
  assert.equal(state.mode, 'manual');
  assert.equal(state.locked, false);
  c.ws.close();
});

test('commands are acknowledged and every client sees the new state', async () => {
  const a = await connect();
  const b = await connect();
  await b.next((m) => m.type === 'state');

  const ack = await a.call('setMode', { mode: 'follow' }, 'a1');
  assert.deepEqual({ ok: ack.ok, id: ack.id }, { ok: true, id: 'a1' });
  const seen = await b.next((m) => m.type === 'state' && m.mode === 'follow');
  assert.equal(seen.mode, 'follow');

  const lock = await a.call('lockMotor', {});
  assert.equal(lock.ok, true);
  await b.next((m) => m.type === 'state' && m.locked === true && m.mode === 'manual');

  const refused = await a.call('setMode', { mode: 'follow' });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'motor_locked');
  assert.match(refused.message, /lock/i);

  await a.call('releaseLock', {});
  a.ws.close();
  b.ws.close();
});

test('alerts are pushed to clients', async () => {
  const c = await connect();
  await c.call('setLeaveAlert', { distance: 10, enabled: true });
  await c.call('simOwnerAway', { meters: 30 });
  const alert = await c.next((m) => m.type === 'alert' && m.kind === 'left-behind');
  assert.equal(alert.severity, 'danger');
  await c.call('simOwnerNear', {});
  c.ws.close();
});

test('malformed messages get an error and do not crash the server', async () => {
  const c = await connect();
  c.ws.send('not json');
  await c.next((m) => m.type === 'error');
  c.ws.send(JSON.stringify({ type: 'cmd' }));
  c.ws.send(JSON.stringify([1, 2, 3]));
  c.ws.send(JSON.stringify({ type: 'cmd', cmd: '__proto__', args: 5 }));
  const ack = await c.next((m) => m.type === 'ack' && m.error === 'unknown_command');
  assert.equal(ack.ok, false);
  const ok = await c.call('setHillHold', { on: false });
  assert.equal(ok.ok, true);
  await c.call('setHillHold', { on: true });
  c.ws.close();
});

test('rejects oversized messages', async () => {
  const c = await connect();
  const closed = new Promise((resolve) => c.ws.once('close', resolve));
  c.ws.send('x'.repeat(10_000));
  assert.equal(await closed, 1009);
});

test('rejects WebSocket connections from other origins and other paths', async () => {
  await assert.rejects(connect({ Origin: 'http://evil.example' }), (e) => e.status === 403);
  await assert.rejects(
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${app.port}/other`);
      ws.once('open', resolve);
      ws.once('error', reject);
      ws.once('unexpected-response', (_r, res) => reject(Object.assign(new Error('rejected'), { status: res.statusCode })));
    }),
    (e) => e.status === 403,
  );
  const same = await connect({ Origin: `http://127.0.0.1:${app.port}` });
  same.ws.close();
});

test('the simulation runs on its own between commands', async () => {
  const c = await connect();
  await c.call('simOwnerNear', {});
  await c.call('setMode', { mode: 'follow' });
  await c.call('simOwnerAway', { meters: 8 });
  const moved = await c.next((m) => m.type === 'state' && m.mode === 'follow' && m.speedMs > 0);
  assert.ok(moved.speedMs > 0);
  await c.call('lockMotor', {});
  await c.call('releaseLock', {});
  await c.call('simOwnerNear', {});
  c.ws.close();
});
