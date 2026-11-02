import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Suitcase } from '../simulator/suitcase.js';

// A fixed "random" keeps GPS jitter repeatable.
const make = () => new Suitcase({ random: () => 0.5 });

const run = (s, seconds, dt = 0.1) => {
  const steps = Math.round(seconds / dt);
  let maxSpeed = 0;
  for (let i = 0; i < steps; i++) {
    s.tick(dt);
    maxSpeed = Math.max(maxSpeed, s.speed);
  }
  return maxSpeed;
};

const cmd = (s, name, args) => s.handle(name, args);

test('emergency lock stops the motor and blocks motor modes until released', () => {
  const s = make();
  s.owner = { x: 10, y: 0 };
  assert.equal(cmd(s, 'setMode', { mode: 'follow' }).ok, true);
  run(s, 1);
  assert.ok(s.speed > 0, 'case is moving while following');

  assert.equal(cmd(s, 'lockMotor').ok, true);
  assert.equal(s.locked, true);
  assert.equal(s.mode, 'manual');
  assert.equal(s.speed, 0);
  run(s, 3);
  assert.equal(s.speed, 0);

  const blocked = cmd(s, 'setMode', { mode: 'assist' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'motor_locked');

  assert.equal(cmd(s, 'lockMotor').ok, true, 'locking twice is harmless');
  assert.equal(cmd(s, 'releaseLock').ok, true);
  assert.equal(cmd(s, 'setMode', { mode: 'follow' }).ok, true);
});

test('follow mode closes the gap to the chosen distance and respects the speed limit', () => {
  const s = make();
  cmd(s, 'setSpeedLimit', { kmh: 4 });
  cmd(s, 'setFollowDistance', { meters: 2.5 });
  s.owner = { x: 12, y: 0 };
  assert.equal(cmd(s, 'setMode', { mode: 'follow' }).ok, true);

  const maxSpeed = run(s, 30);
  assert.ok(maxSpeed <= 4 / 3.6 + 1e-9, `never faster than the limit (saw ${maxSpeed})`);
  assert.ok(Math.abs(s.distance() - 2.5) < 0.2, `settles near 2.5 m (was ${s.distance()})`);
  assert.equal(s.speed, 0, 'stops once in position');
});

test('follow mode keeps up with a walking owner', () => {
  const s = make();
  s.pos = { x: 1, y: 0 };
  cmd(s, 'setMode', { mode: 'follow' });
  cmd(s, 'simWalk', { on: true });
  run(s, 60);
  assert.equal(s.mode, 'follow');
  assert.ok(s.distance() < 3, `still close (was ${s.distance()})`);
});

test('follow mode refuses to start out of range and stops if you leave range', () => {
  const s = make();
  cmd(s, 'simOwnerAway', { meters: 30 });
  const refused = cmd(s, 'setMode', { mode: 'follow' });
  assert.equal(refused.error, 'out_of_range');

  cmd(s, 'simOwnerNear');
  assert.equal(cmd(s, 'setMode', { mode: 'follow' }).ok, true);
  cmd(s, 'simOwnerAway', { meters: 40 });
  s.tick(0.1);
  assert.equal(s.mode, 'manual');
  assert.equal(s.drainEvents().some((e) => e.kind === 'link-lost'), true);
});

test('power assist only moves while you walk, and higher levels lighten the felt load', () => {
  const s = make();
  s.pos = { x: 0.5, y: 0 };
  assert.equal(cmd(s, 'setMode', { mode: 'assist' }).ok, true);
  run(s, 5);
  assert.equal(s.speed, 0, 'idle owner, idle case');

  cmd(s, 'simWalk', { on: true });
  run(s, 20);
  assert.ok(s.pos.x > 5 || s.pos.y > 5, 'case travelled with the owner');

  const felt = [];
  for (const level of [0, 1, 2]) {
    cmd(s, 'setAssistLevel', { level });
    felt.push(s.snapshot().feltLoadKg);
  }
  assert.ok(felt[0] > felt[1] && felt[1] > felt[2], `felt load falls with level: ${felt}`);
  cmd(s, 'setMode', { mode: 'manual' });
  assert.equal(s.snapshot().feltLoadKg, s.loadKg);
});

test('tip-over locks the motor when tip lock is on, and cannot be released while tipped', () => {
  const s = make();
  cmd(s, 'setMode', { mode: 'assist' });
  cmd(s, 'simTip', { on: true });
  assert.equal(s.locked, true);
  assert.equal(s.mode, 'manual');
  assert.equal(s.drainEvents()[0].kind, 'tipped');

  assert.equal(cmd(s, 'releaseLock').error, 'tipped');
  cmd(s, 'simTip', { on: false });
  assert.equal(s.locked, true, 'standing it up does not unlock by itself');
  assert.equal(cmd(s, 'releaseLock').ok, true);
});

test('tip-over only warns when tip lock is off', () => {
  const s = make();
  cmd(s, 'setSetting', { key: 'tipLock', on: false });
  cmd(s, 'simTip', { on: true });
  assert.equal(s.locked, false);
  assert.equal(s.tipped, true);
  assert.equal(cmd(s, 'setMode', { mode: 'follow' }).error, 'tipped');
});

test('stair detection pauses the motor and blocks motor modes', () => {
  const s = make();
  cmd(s, 'setMode', { mode: 'follow' });
  cmd(s, 'simStairs', { on: true });
  assert.equal(s.mode, 'manual');
  assert.equal(s.drainEvents()[0].kind, 'stairs');
  assert.equal(cmd(s, 'setMode', { mode: 'follow' }).error, 'stairs_ahead');

  cmd(s, 'setSetting', { key: 'stairDetect', on: false });
  assert.equal(cmd(s, 'setMode', { mode: 'follow' }).ok, true);
});

test('left-behind alert fires once per departure and re-arms when you return', () => {
  const s = make();
  cmd(s, 'setLeaveAlert', { distance: 10 });
  cmd(s, 'simOwnerAway', { meters: 15 });
  s.tick(0.1);
  s.tick(0.1);
  assert.equal(s.drainEvents().filter((e) => e.kind === 'left-behind').length, 1);

  cmd(s, 'simOwnerNear');
  s.tick(0.1);
  cmd(s, 'simOwnerAway', { meters: 15 });
  s.tick(0.1);
  assert.equal(s.drainEvents().filter((e) => e.kind === 'left-behind').length, 1, 'fires again after returning');

  cmd(s, 'setLeaveAlert', { enabled: false });
  cmd(s, 'simOwnerNear');
  s.tick(0.1);
  cmd(s, 'simOwnerAway', { meters: 15 });
  s.tick(0.1);
  assert.equal(s.drainEvents().length, 0, 'silent when disabled');
});

test('GPS reports a fix near the suitcase, refreshes on a schedule, and refreshes faster in lost mode', () => {
  const s = make();
  const first = s.snapshot().gps;
  assert.ok(Math.abs(first.lat - 41.9742) < 0.001 && Math.abs(first.lon + 87.9073) < 0.001);
  assert.ok(first.accuracyM >= 4 && first.accuracyM <= 8);

  run(s, 4);
  assert.equal(s.snapshot().gps.fixId, first.fixId, 'no new fix before 5 s');
  run(s, 2);
  assert.equal(s.snapshot().gps.fixId, first.fixId + 1, 'new fix after 5 s');

  cmd(s, 'setLostMode', { on: true });
  const before = s.snapshot().gps.fixId;
  run(s, 6);
  assert.ok(s.snapshot().gps.fixId - before >= 3, 'lost mode updates about every 2 s');
});

test('ringing stops by itself after 20 seconds', () => {
  const s = make();
  cmd(s, 'ring', { on: true });
  run(s, 10);
  assert.equal(s.ringing, true);
  run(s, 11);
  assert.equal(s.ringing, false);
});

test('Wi-Fi: secured networks need a password, turning Wi-Fi off disables remote control', () => {
  const s = make();
  assert.equal(cmd(s, 'joinWifi', { ssid: 'Phone hotspot' }).error, 'bad_password');
  assert.equal(cmd(s, 'joinWifi', { ssid: 'Phone hotspot', password: 'hunter2' }).ok, true);
  assert.equal(s.snapshot().wifi.ssid, 'Phone hotspot');
  assert.equal(cmd(s, 'joinWifi', { ssid: 'Airport Guest' }).ok, true, 'open network needs none');
  assert.equal(cmd(s, 'joinWifi', { ssid: 'Nope' }).error, 'not_found');
  assert.equal(s.snapshot().remoteActive, true);

  cmd(s, 'setWifi', { enabled: false });
  const off = s.snapshot();
  assert.equal(off.wifi.ssid, null);
  assert.deepEqual(off.wifi.networks, []);
  assert.equal(off.remoteActive, false);
  assert.equal(cmd(s, 'joinWifi', { ssid: 'Home 5G', password: 'x' }).error, 'wifi_off');

  cmd(s, 'setWifi', { enabled: true });
  assert.equal(s.snapshot().wifi.ssid, 'Airport Guest', 'rejoins the last network');
});

test('a low battery warns once, then blocks motor modes', () => {
  const s = make();
  s.battery = 10.01;
  run(s, 20);
  assert.equal(s.drainEvents().filter((e) => e.kind === 'low-battery').length, 1);
  s.battery = 4;
  assert.equal(cmd(s, 'setMode', { mode: 'follow' }).error, 'battery_low');
  assert.equal(cmd(s, 'setMode', { mode: 'manual' }).ok, true);
});

test('bad input is rejected without changing anything or throwing', () => {
  const s = make();
  const before = JSON.stringify(s.snapshot());
  const bad = [
    ['setMode', { mode: 'warp' }],
    ['setMode', undefined],
    ['setFollowDistance', { meters: 99 }],
    ['setFollowDistance', { meters: '1.5' }],
    ['setAssistLevel', { level: 3 }],
    ['setSpeedLimit', { kmh: 50 }],
    ['setSetting', { key: 'constructor', on: true }],
    ['setSetting', { key: 'tipLock', on: 'yes' }],
    ['setLeaveAlert', {}],
    ['setLeaveAlert', { distance: 7 }],
    ['simOwnerAway', { meters: -5 }],
    ['simOwnerAway', { meters: 1e9 }],
    ['__proto__', {}],
    ['constructor', {}],
    ['hasOwnProperty', {}],
    [42, {}],
  ];
  for (const [name, args] of bad) {
    const r = s.handle(name, args);
    assert.equal(r.ok, false, `${String(name)} ${JSON.stringify(args)} should be rejected`);
  }
  assert.equal(s.handle('setHillHold', [1, 2]).ok, false, 'array args are not an object');
  const { gps: g1, ...rest1 } = JSON.parse(before);
  const { gps: g2, ...rest2 } = s.snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(rest2)), rest1);
});
