// A simulated electric suitcase: state, control rules and simple physics.
//
// This is the reference for how the real firmware should behave. It has no I/O:
// the server calls tick(dt) and handle(cmd, args), and reads snapshot().
// Time is injected through tick(), so tests are deterministic.

import {
  MODES,
  FOLLOW_DISTANCES,
  ASSIST_LEVELS,
  SPEED_LIMITS_KMH,
  LEAVE_DISTANCES,
  SETTING_KEYS,
  LINK_RANGE_M,
} from '../shared/constants.js';

const BASE = { lat: 41.9742, lon: -87.9073 }; // where (0, 0) sits on the map
const M_PER_DEG = 111_320;
const KMH = 1 / 3.6; // km/h -> m/s

const ASSIST_TETHER_M = 1; // in Power assist the case rides about 1 m from you
const ASSIST_RELIEF = [0.3, 0.6, 0.9]; // share of the load the motor carries per level
const OWNER_SPEED = 1.3; // m/s, a brisk walk
const WALK_ROUTE = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 30 },
  { x: 0, y: 30 },
];

const GPS_PERIOD_S = 5;
const GPS_PERIOD_LOST_S = 2;
const RING_MAX_S = 20;
const LOW_BATTERY = 10;
const CUTOFF_BATTERY = 5; // below this the motor modes are off
const RANGE_KM_PER_PERCENT = 0.12;

const WIFI_NETWORKS = [
  { ssid: 'Home 5G', signal: 3, secured: true },
  { ssid: 'Airport Guest', signal: 2, secured: false },
  { ssid: 'Phone hotspot', signal: 1, secured: true },
];

const ok = () => ({ ok: true });
const fail = (error, message) => ({ ok: false, error, message });
const isBool = (v) => typeof v === 'boolean';
const round = (v, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;

const toGeo = ({ x, y }) => ({
  lat: BASE.lat + y / M_PER_DEG,
  lon: BASE.lon + x / (M_PER_DEG * Math.cos((BASE.lat * Math.PI) / 180)),
});

// Every command the suitcase understands. Each returns { ok } or { ok:false, error, message }.
const COMMANDS = {
  setMode(s, a) {
    if (!MODES.includes(a.mode)) return fail('invalid_args', 'Unknown mode.');
    if (a.mode === 'manual') {
      s.mode = 'manual';
      return ok();
    }
    if (s.locked) return fail('motor_locked', 'Release the motor lock first.');
    if (s.tipped) return fail('tipped', 'Stand the suitcase upright first.');
    if (s.battery <= CUTOFF_BATTERY) return fail('battery_low', 'Battery is too low for motor modes.');
    if (s.stairsAhead && s.settings.stairDetect) {
      return fail('stairs_ahead', 'Stairs ahead. Carry the suitcase, or turn off stair detection.');
    }
    if (a.mode === 'follow' && s.distance() > LINK_RANGE_M) {
      return fail('out_of_range', `Move within ${LINK_RANGE_M} m of the suitcase to use Follow me.`);
    }
    s.mode = a.mode;
    return ok();
  },

  setFollowDistance(s, a) {
    if (!FOLLOW_DISTANCES.includes(a.meters)) return fail('invalid_args', 'Unsupported follow distance.');
    s.followDistance = a.meters;
    return ok();
  },

  setAssistLevel(s, a) {
    if (!ASSIST_LEVELS.includes(a.level)) return fail('invalid_args', 'Unsupported assist level.');
    s.assistLevel = a.level;
    return ok();
  },

  setHillHold(s, a) {
    if (!isBool(a.on)) return fail('invalid_args', 'Expected on: true or false.');
    s.hillHold = a.on;
    return ok();
  },

  // Emergency stop. Always allowed, instant, safe to repeat.
  lockMotor(s) {
    s.locked = true;
    s.mode = 'manual';
    s.speed = 0;
    return ok();
  },

  releaseLock(s) {
    if (!s.locked) return ok();
    if (s.tipped) return fail('tipped', 'Stand the suitcase upright before releasing the lock.');
    s.locked = false;
    return ok();
  },

  ring(s, a) {
    if (!isBool(a.on)) return fail('invalid_args', 'Expected on: true or false.');
    s.ringing = a.on;
    s._ringT = 0;
    return ok();
  },

  setLostMode(s, a) {
    if (!isBool(a.on)) return fail('invalid_args', 'Expected on: true or false.');
    s.lostMode = a.on;
    return ok();
  },

  setLeaveAlert(s, a) {
    const hasEnabled = a.enabled !== undefined;
    const hasDistance = a.distance !== undefined;
    if (!hasEnabled && !hasDistance) return fail('invalid_args', 'Nothing to change.');
    if (hasEnabled && !isBool(a.enabled)) return fail('invalid_args', 'enabled must be true or false.');
    if (hasDistance && !LEAVE_DISTANCES.includes(a.distance)) {
      return fail('invalid_args', 'Unsupported alert distance.');
    }
    if (hasEnabled) s.leaveAlert.enabled = a.enabled;
    if (hasDistance) s.leaveAlert.distance = a.distance;
    s._leftBehind = false;
    return ok();
  },

  setWifi(s, a) {
    if (!isBool(a.enabled)) return fail('invalid_args', 'enabled must be true or false.');
    if (a.enabled && !s.wifi.enabled) {
      s.wifi.enabled = true;
      s.wifi.ssid = s.wifi.lastSsid;
    } else if (!a.enabled) {
      s.wifi.enabled = false;
      s.wifi.ssid = null;
    }
    return ok();
  },

  // The simulator accepts any non-empty password; real firmware must verify it.
  joinWifi(s, a) {
    if (!s.wifi.enabled) return fail('wifi_off', 'Turn Wi-Fi on first.');
    const net = WIFI_NETWORKS.find((n) => n.ssid === a.ssid);
    if (!net) return fail('not_found', 'That network is not in range.');
    if (net.secured) {
      const pw = a.password;
      if (typeof pw !== 'string' || pw.length < 1 || pw.length > 63) {
        return fail('bad_password', 'Enter the network password.');
      }
    }
    s.wifi.ssid = net.ssid;
    s.wifi.lastSsid = net.ssid;
    return ok();
  },

  setRemoteControl(s, a) {
    if (!isBool(a.on)) return fail('invalid_args', 'Expected on: true or false.');
    s.remoteControl = a.on;
    return ok();
  },

  setSpeedLimit(s, a) {
    if (!SPEED_LIMITS_KMH.includes(a.kmh)) return fail('invalid_args', 'Unsupported speed limit.');
    s.speedLimitKmh = a.kmh;
    return ok();
  },

  setSetting(s, a) {
    if (!SETTING_KEYS.includes(a.key)) return fail('invalid_args', 'Unknown setting.');
    if (!isBool(a.on)) return fail('invalid_args', 'Expected on: true or false.');
    s.settings[a.key] = a.on;
    return ok();
  },

  // ---- simulator-only: move the pretend owner or poke the pretend world ----

  simWalk(s, a) {
    if (!isBool(a.on)) return fail('invalid_args', 'Expected on: true or false.');
    s.ownerWalking = a.on;
    return ok();
  },

  simOwnerAway(s, a) {
    const meters = a.meters ?? 60;
    if (typeof meters !== 'number' || !(meters >= 1 && meters <= 1000)) {
      return fail('invalid_args', 'meters must be between 1 and 1000.');
    }
    s.ownerWalking = false;
    s.owner = { x: s.pos.x + meters, y: s.pos.y };
    return ok();
  },

  simOwnerNear(s) {
    s.ownerWalking = false;
    s.owner = { x: s.pos.x - 3, y: s.pos.y };
    return ok();
  },

  simTip(s, a) {
    if (!isBool(a.on)) return fail('invalid_args', 'Expected on: true or false.');
    if (a.on && !s.tipped) {
      s.tipped = true;
      s.mode = 'manual';
      s.speed = 0;
      if (s.settings.tipLock && !s.locked) {
        s.locked = true;
        s._emit('tipped', 'Suitcase tipped over. Motor locked.', 'danger');
      } else {
        s._emit('tipped', 'Suitcase tipped over.', 'warning');
      }
    } else if (!a.on) {
      s.tipped = false; // the lock, if engaged, stays until released
    }
    return ok();
  },

  simStairs(s, a) {
    if (!isBool(a.on)) return fail('invalid_args', 'Expected on: true or false.');
    s.stairsAhead = a.on;
    if (a.on && s.settings.stairDetect && s.mode !== 'manual') {
      s.mode = 'manual';
      s.speed = 0;
      s._emit('stairs', 'Stairs ahead. The motor has paused.', 'warning');
    }
    return ok();
  },
};

export class Suitcase {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.t = 0; // simulated seconds

    this.name = 'Aero Carry-on';
    this.firmware = '2.4.1';
    this.battery = 78; // percent
    this.loadKg = 14.2;

    this.mode = 'manual';
    this.followDistance = 1.5;
    this.assistLevel = 1;
    this.hillHold = true;
    this.locked = false;
    this.tipped = false;
    this.stairsAhead = false;
    this.speed = 0; // m/s
    this.speedLimitKmh = 5;

    this.pos = { x: 3, y: 1.2 };
    this.owner = { x: 0, y: 0 };
    this.ownerWalking = false;
    this._routeIdx = 1;

    this.lostMode = false;
    this.leaveAlert = { enabled: true, distance: 25 };
    this._leftBehind = false;
    this.ringing = false;
    this._ringT = 0;

    this.wifi = { enabled: true, ssid: 'Home 5G', lastSsid: 'Home 5G' };
    this.remoteControl = true;
    this.settings = { tipLock: true, stairDetect: true, sounds: true, autoSleep: false };

    this._lowBatteryAlerted = false;
    this._events = [];
    this._gps = null;
    this._gpsT = -Infinity;
    this._fixId = 0;
    this._updateGps();
  }

  distance() {
    return Math.hypot(this.owner.x - this.pos.x, this.owner.y - this.pos.y);
  }

  /** Run one command. Never throws; bad input comes back as { ok:false }. */
  handle(cmd, args) {
    if (typeof cmd !== 'string' || !Object.hasOwn(COMMANDS, cmd)) {
      return fail('unknown_command', 'Unknown command.');
    }
    const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    return COMMANDS[cmd](this, a);
  }

  /** Advance the simulation by dt seconds. */
  tick(dt) {
    this.t += dt;
    this._moveOwner(dt);
    this._drive(dt);
    this._drainBattery(dt);
    this._checkAlerts();
    if (this.ringing && (this._ringT += dt) >= RING_MAX_S) this.ringing = false;
    if (this.t - this._gpsT >= (this.lostMode ? GPS_PERIOD_LOST_S : GPS_PERIOD_S)) this._updateGps();
  }

  /** Alerts raised since the last call. */
  drainEvents() {
    const events = this._events;
    this._events = [];
    return events;
  }

  snapshot() {
    const felt = this.loadKg * (this.mode === 'assist' ? 1 - ASSIST_RELIEF[this.assistLevel] : 1);
    const wifiOn = this.wifi.enabled;
    return {
      type: 'state',
      simulated: true,
      name: this.name,
      firmware: this.firmware,
      battery: round(this.battery),
      rangeKm: round(this.battery * RANGE_KM_PER_PERCENT),
      loadKg: this.loadKg,
      feltLoadKg: round(felt),
      mode: this.mode,
      followDistance: this.followDistance,
      assistLevel: this.assistLevel,
      hillHold: this.hillHold,
      locked: this.locked,
      tipped: this.tipped,
      stairsAhead: this.stairsAhead,
      speedMs: round(this.speed, 2),
      speedLimitKmh: this.speedLimitKmh,
      distance: round(this.distance()),
      linkInRange: this.distance() <= LINK_RANGE_M,
      ownerWalking: this.ownerWalking,
      gps: {
        ...toGeo(this._gps),
        accuracyM: this._gps.accuracy,
        ageS: round(this.t - this._gpsT),
        fixId: this._fixId,
      },
      ownerGps: toGeo(this.owner),
      lostMode: this.lostMode,
      leaveAlert: { ...this.leaveAlert },
      ringing: this.ringing,
      wifi: {
        enabled: wifiOn,
        ssid: wifiOn ? this.wifi.ssid : null,
        networks: wifiOn ? WIFI_NETWORKS.map((n) => ({ ...n })) : [],
      },
      remoteControl: this.remoteControl,
      remoteActive: wifiOn && Boolean(this.wifi.ssid) && this.remoteControl,
      settings: { ...this.settings },
    };
  }

  // ---- internals ----

  _emit(kind, message, severity = 'info') {
    this._events.push({ kind, message, severity });
  }

  _moveOwner(dt) {
    if (!this.ownerWalking) return;
    const target = WALK_ROUTE[this._routeIdx];
    const dx = target.x - this.owner.x;
    const dy = target.y - this.owner.y;
    const d = Math.hypot(dx, dy);
    const step = OWNER_SPEED * dt;
    if (d <= step) {
      this.owner = { ...target };
      this._routeIdx = (this._routeIdx + 1) % WALK_ROUTE.length;
    } else {
      this.owner.x += (dx / d) * step;
      this.owner.y += (dy / d) * step;
    }
  }

  _drive(dt) {
    let speed = 0;
    const canMove = !this.locked && !this.tipped && this.battery > CUTOFF_BATTERY;
    if (this.mode !== 'manual' && !canMove) {
      this.mode = 'manual';
    } else if (this.mode !== 'manual') {
      const d = this.distance();
      if (this.mode === 'follow' && d > LINK_RANGE_M) {
        this.mode = 'manual';
        this._emit('link-lost', 'Lost track of you. Follow me has stopped.', 'warning');
      } else if (this.mode === 'follow' || this.ownerWalking) {
        // Follow me closes the gap to the chosen distance; Power assist rides
        // alongside you, but only while you are actually walking.
        const target = this.mode === 'follow' ? this.followDistance : ASSIST_TETHER_M;
        const gap = d - target;
        if (gap > 0.1) {
          const want = Math.min(this.speedLimitKmh * KMH, Math.max(0.3, gap * 1.2));
          const step = Math.min(want * dt, gap);
          this.pos.x += ((this.owner.x - this.pos.x) / d) * step;
          this.pos.y += ((this.owner.y - this.pos.y) / d) * step;
          speed = step / dt;
        }
      }
    }
    this.speed = speed;
  }

  _drainBattery(dt) {
    let rate = 0.002; // percent per second, idle
    if (this.speed > 0) rate += 0.02;
    if (this.mode === 'assist' && this.ownerWalking) rate += 0.01 * (1 + this.assistLevel);
    if (this.ringing) rate += 0.005;
    if (this.lostMode) rate += 0.002;
    this.battery = Math.max(0, this.battery - rate * dt);
  }

  _checkAlerts() {
    if (this.battery <= LOW_BATTERY && !this._lowBatteryAlerted) {
      this._lowBatteryAlerted = true;
      this._emit('low-battery', `Battery at ${Math.round(this.battery)}%. Charge soon.`, 'warning');
    } else if (this.battery > LOW_BATTERY + 5) {
      this._lowBatteryAlerted = false;
    }

    const d = this.distance();
    const { enabled, distance } = this.leaveAlert;
    if (enabled && d > distance && !this._leftBehind) {
      this._leftBehind = true;
      this._emit('left-behind', `You left your suitcase behind (${Math.round(d)} m away).`, 'danger');
    } else if (this._leftBehind && d <= distance * 0.9) {
      this._leftBehind = false; // re-arm once you are clearly back
    }
  }

  _updateGps() {
    const accuracy = round(4 + this.random() * 4);
    const jitter = () => (this.random() - 0.5) * accuracy * 0.5;
    this._gps = { x: this.pos.x + jitter(), y: this.pos.y + jitter(), accuracy };
    this._gpsT = this.t;
    this._fixId += 1;
  }
}
