// WebSocket link to the suitcase. Reconnects on its own and turns each command
// into a promise that settles when the suitcase acknowledges it.
//
// Events (CustomEvent, data in .detail): status {connected}, state, alert.
// Swap this class for a Bluetooth one later; main.js only uses this surface.

const ACK_TIMEOUT_MS = 4000;

export class SuitcaseLink extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.attempt = 0;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  start() {
    this.#open();
  }

  /** Send a command. Resolves on ok, rejects with Error(message) and .code otherwise. */
  send(cmd, args = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected) return reject(new Error('Not connected to the suitcase.'));
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The suitcase did not answer. Try again.'));
      }, ACK_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: 'cmd', id, cmd, args }));
    });
  }

  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  #open() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.attempt = 0;
      this.#emit('status', { connected: true });
    });
    ws.addEventListener('message', (e) => this.#onMessage(e.data));
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('Connection to the suitcase was lost.'));
        this.pending.delete(id);
      }
      this.#emit('status', { connected: false });
      const delay = Math.min(5000, 500 * 2 ** this.attempt++);
      setTimeout(() => this.#open(), delay);
    });
  }

  #onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'state') this.#emit('state', msg);
    else if (msg.type === 'alert') this.#emit('alert', msg);
    else if (msg.type === 'ack') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg);
      else p.reject(Object.assign(new Error(msg.message || 'The suitcase refused that.'), { code: msg.error }));
    }
  }
}
