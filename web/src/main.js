import { SuitcaseLink } from './transport.js';
import { derive } from './view.js';
import { drawMap, toXY } from './map.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const TABS = ['drive', 'locate', 'connect', 'settings'];
const TRAIL_MAX = 60;

const link = new SuitcaseLink(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
let state = null;
let connected = false;
let ctx = { view: derive(null, false) };

// map trail, kept in metres from the first fix we saw
let ref = null;
let trail = [];
let lastFixId = null;

const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
const setText = (el, text) => {
  if (el.textContent !== text) el.textContent = text;
};

// ---------- element lookups (done once) ----------
const els = {
  texts: $$('[data-text]'),
  shows: $$('[data-show]'),
  states: $$('[data-bind-state]'),
  widths: $$('[data-width]'),
  actives: $$('[data-active-path]'),
  toggles: $$('[data-toggle-cmd]'),
  controls: $$('[data-cmd], [data-toggle-cmd]'),
  dims: $$('[data-dim]'),
  hrefs: $$('[data-href]'),
  panels: $$('[data-panel]'),
  tabs: $$('[data-tab]'),
  map: $('#map'),
  networks: $('#networks'),
};

function visible(expr) {
  const negate = expr.startsWith('!');
  const [path, want] = (negate ? expr.slice(1) : expr).split('==');
  const value = get(path);
  const result = want === undefined ? Boolean(value) : String(value) === want;
  return negate ? !result : result;
}

// ---------- rendering ----------
function render() {
  ctx = { ...(state ?? {}), view: derive(state, connected) };
  const locked = Boolean(state?.locked);

  for (const el of els.texts) setText(el, String(get(el.dataset.text) ?? '—'));
  for (const el of els.shows) el.hidden = !state || !visible(el.dataset.show);
  for (const el of els.states) el.dataset.state = String(get(el.dataset.bindState) ?? 'idle');
  for (const el of els.widths) el.style.width = `${Math.max(0, Math.min(100, Number(get(el.dataset.width) ?? 0)))}%`;
  for (const el of els.hrefs) {
    const url = get(el.dataset.href);
    if (typeof url === 'string' && url.startsWith('https://www.openstreetmap.org/')) el.href = url;
  }
  for (const el of els.actives) {
    el.setAttribute('aria-pressed', String(JSON.stringify(get(el.dataset.activePath)) === el.dataset.activeValue));
  }
  for (const el of els.toggles) {
    const on = Boolean(get(el.dataset.path));
    el.setAttribute(el.getAttribute('role') === 'switch' ? 'aria-checked' : 'aria-pressed', String(on));
  }
  for (const el of els.dims) el.classList.toggle('dim', Boolean(get(el.dataset.dim)));
  for (const el of els.controls) {
    el.disabled = !connected || !state || (el.hasAttribute('data-lockable') && locked);
  }

  if (state) {
    renderMap();
    renderNetworks();
  }
}

function renderMap() {
  const { gps, ownerGps } = state;
  ref ??= { lat: gps.lat, lon: gps.lon };
  if (gps.fixId !== lastFixId) {
    lastFixId = gps.fixId;
    trail.push(toXY(ref, gps));
    if (trail.length > TRAIL_MAX) trail.shift();
  }
  drawMap(els.map, {
    owner: toXY(ref, ownerGps),
    item: toXY(ref, gps),
    accuracy: gps.accuracyM,
    trail,
    ringing: state.ringing,
    label: `Map. Your suitcase is ${ctx.view.gpsDistance.replace(' away', '')} from you.`,
  });
}

let networksKey = '';
function renderNetworks() {
  const { enabled, ssid, networks } = state.wifi;
  const key = JSON.stringify([enabled, ssid, networks, connected]);
  if (key === networksKey) return;
  networksKey = key;
  els.networks.replaceChildren(
    ...networks.map((n) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'network';
      btn.type = 'button';
      btn.dataset.ssid = n.ssid;
      btn.dataset.secured = String(n.secured);
      btn.disabled = !connected;
      if (n.ssid === ssid) btn.setAttribute('aria-current', 'true');
      const info = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = n.ssid;
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = `${['', 'Weak', 'Good', 'Strong'][n.signal]} signal, ${n.secured ? 'secured' : 'open'}`;
      info.append(name, meta);
      const status = document.createElement('span');
      status.className = 'state';
      status.textContent = n.ssid === ssid ? 'Connected' : 'Join';
      btn.append(info, status);
      li.append(btn);
      return li;
    }),
  );
}

// ---------- tabs ----------
function showTab() {
  const name = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'drive';
  for (const p of els.panels) p.hidden = p.dataset.panel !== name;
  for (const t of els.tabs) {
    if (t.dataset.tab === name) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  $('main').scrollTop = 0;
}
addEventListener('hashchange', showTab);

// ---------- toasts ----------
function toast(message, severity = 'info') {
  const el = document.createElement('p');
  el.className = `toast ${severity}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), severity === 'danger' ? 10_000 : 6000);
}

// ---------- sending commands ----------
async function run(cmd, args) {
  try {
    await link.send(cmd, args);
    return null;
  } catch (err) {
    toast(err.message, 'warning');
    return err;
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-cmd], [data-toggle-cmd]');
  if (!el || el.disabled) return;
  if (el.dataset.cmd) {
    run(el.dataset.cmd, el.dataset.args ? JSON.parse(el.dataset.args) : {});
  } else {
    const extra = el.dataset.toggleExtra ? JSON.parse(el.dataset.toggleExtra) : {};
    run(el.dataset.toggleCmd, { ...extra, [el.dataset.toggleArg || 'on']: !get(el.dataset.path) });
  }
});

// ---------- joining a Wi-Fi network ----------
const dialog = $('#wifi-dialog');
const form = $('#wifi-form');
const pwInput = $('#wifi-password');
const pwError = $('#wifi-error');
let joining = null;

els.networks.addEventListener('click', async (e) => {
  const btn = e.target.closest('.network');
  if (!btn || btn.getAttribute('aria-current') === 'true') return;
  if (btn.dataset.secured === 'true') {
    joining = btn.dataset.ssid;
    $('#wifi-ssid').textContent = joining;
    pwInput.value = '';
    pwError.hidden = true;
    dialog.showModal();
    pwInput.focus();
  } else if (!(await run('joinWifi', { ssid: btn.dataset.ssid }))) {
    toast(`Joined ${btn.dataset.ssid}`);
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await link.send('joinWifi', { ssid: joining, password: pwInput.value });
    dialog.close();
    toast(`Joined ${joining}`);
  } catch (err) {
    pwError.textContent = err.message;
    pwError.hidden = false;
  }
});
$('#wifi-cancel').addEventListener('click', () => dialog.close());

// ---------- wiring ----------
link.addEventListener('status', (e) => {
  connected = e.detail.connected;
  render();
});
link.addEventListener('state', (e) => {
  state = e.detail;
  render();
});
link.addEventListener('alert', (e) => toast(e.detail.message, e.detail.severity));

showTab();
render();
link.start();
