// ThingsBoard live data source.
//  1. REST login (/api/auth/login) or a pasted JWT.
//  2. Device discovery by device type: forklift, truck, drone, dock, charger, site.
//  3. WebSocket subscription to LATEST_TELEMETRY + CLIENT_SCOPE attributes.
//  4. Each device's latest values are merged into the same snapshot shape the
//     simulator produces, so the 3D scene and UI don't care where data comes from.

export const DEVICE_TYPES = ['forklift', 'truck', 'drone', 'dock', 'charger', 'site'];

export class ThingsBoardSource {
  constructor({ host, username, password, token, wsApi = 'auto' }) {
    this.kind = 'thingsboard';
    this.host = host.replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.token = token || null;
    this.refreshToken = null;
    this.wsApi = wsApi;
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.devices = new Map(); // id -> { id, name, type, values: {} }
    this.cmdMap = new Map(); // cmdId -> deviceId
    this.user = null;
    this.closed = false;
    this.emitTimer = null;
    this.retry = 0;
  }

  onSnapshot(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  onStatus(cb) { this.statusListeners.add(cb); return () => this.statusListeners.delete(cb); }
  #status(state, detail = '') { for (const cb of this.statusListeners) cb({ state, detail }); }

  async #api(path, opts = {}) {
    const res = await fetch(this.host + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { 'X-Authorization': `Bearer ${this.token}` } : {}),
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401 && this.refreshToken && !opts._retried) {
      await this.#refresh();
      return this.#api(path, { ...opts, _retried: true });
    }
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try { const j = await res.json(); if (j.message) msg = j.message; } catch { /* not json */ }
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  }

  async #login() {
    if (this.token) return;
    const r = await this.#api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: this.username, password: this.password }) });
    this.token = r.token;
    this.refreshToken = r.refreshToken;
    this.password = null; // keep it no longer than needed
  }

  async #refresh() {
    const r = await fetch(`${this.host}/api/auth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: this.refreshToken }),
    });
    if (!r.ok) throw new Error('Session expired. Sign in again.');
    const j = await r.json();
    this.token = j.token; this.refreshToken = j.refreshToken;
  }

  async #listDevices(type) {
    const customer = this.user?.customerId?.id;
    const isCustomer = this.user?.authority === 'CUSTOMER_USER' && customer;
    const base = isCustomer ? `/api/customer/${customer}/devices` : '/api/tenant/devices';
    const out = [];
    for (let page = 0; page < 20; page++) {
      const r = await this.#api(`${base}?pageSize=100&page=${page}&type=${encodeURIComponent(type)}`);
      out.push(...r.data);
      if (!r.hasNext) break;
    }
    return out;
  }

  async start() {
    this.#status('connecting', 'Signing in');
    await this.#login();
    this.user = await this.#api('/api/auth/user');
    this.#status('connecting', 'Loading devices');
    for (const type of DEVICE_TYPES) {
      for (const d of await this.#listDevices(type)) {
        this.devices.set(d.id.id, { id: d.id.id, name: d.name, label: d.label, type, values: {} });
      }
    }
    if (!this.devices.size) {
      throw new Error('No devices of type forklift, truck, drone, dock, charger or site were found. Run tools/tb-simulator.mjs to create them.');
    }
    if (this.refreshToken) this.refreshTimer = setInterval(() => this.#refresh().catch(() => {}), 45 * 60 * 1000);
    await this.#openSocket();
  }

  #wsUrl(mode) {
    const u = new URL(this.host);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = mode === 'legacy' ? '/api/ws/plugins/telemetry' : '/api/ws';
    if (mode === 'legacy') u.search = `?token=${encodeURIComponent(this.token)}`;
    return u.toString();
  }

  #subscribeMessage(mode) {
    this.cmdMap.clear();
    let id = 1;
    const ts = []; const attrs = [];
    for (const d of this.devices.values()) {
      const t = { entityType: 'DEVICE', entityId: d.id, scope: 'LATEST_TELEMETRY', cmdId: id };
      this.cmdMap.set(id++, d.id);
      const a = { entityType: 'DEVICE', entityId: d.id, scope: 'CLIENT_SCOPE', cmdId: id };
      this.cmdMap.set(id++, d.id);
      ts.push(t); attrs.push(a);
    }
    if (mode === 'legacy') return { tsSubCmds: ts, attrSubCmds: attrs, historyCmds: [] };
    return {
      authCmd: { cmdId: 0, token: this.token },
      cmds: [...ts.map((c) => ({ ...c, type: 'TIMESERIES' })), ...attrs.map((c) => ({ ...c, type: 'ATTRIBUTES' }))],
    };
  }

  #openSocket(mode = this.wsApi === 'legacy' ? 'legacy' : 'v2') {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.#wsUrl(mode));
      this.ws = ws;
      let gotData = false;
      ws.onopen = () => ws.send(JSON.stringify(this.#subscribeMessage(mode)));
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.errorCode) { this.#status('error', msg.errorMsg || `ThingsBoard error ${msg.errorCode}`); return; }
        const devId = this.cmdMap.get(msg.subscriptionId ?? msg.cmdId);
        if (!devId || !msg.data) return;
        if (!gotData) { gotData = true; this.retry = 0; this.#status('live', this.host); resolve(); }
        const values = this.devices.get(devId).values;
        for (const [key, series] of Object.entries(msg.data)) {
          if (Array.isArray(series) && series.length) values[key] = parse(series[0][1]);
        }
        this.#scheduleEmit();
      };
      ws.onclose = () => {
        if (this.closed) return;
        if (!gotData && mode === 'v2' && this.wsApi === 'auto') {
          // Older ThingsBoard releases only expose the legacy endpoint.
          this.#openSocket('legacy').then(resolve, reject);
          return;
        }
        if (!gotData && this.retry === 0) { reject(new Error('The telemetry WebSocket closed before any data arrived.')); return; }
        this.#status('connecting', 'Reconnecting');
        const delay = Math.min(30000, 1000 * 2 ** this.retry++);
        setTimeout(() => !this.closed && this.#openSocket(mode).catch(() => {}), delay);
      };
    });
  }

  #scheduleEmit() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      const snap = this.snapshot();
      for (const cb of this.listeners) cb(snap);
    }, 80);
  }

  snapshot() {
    const by = (type) => [...this.devices.values()].filter((d) => d.type === type);
    const site = by('site')[0];
    const sv = site?.values || {};
    const forklifts = by('forklift').map((d) => ({ id: d.name, type: 'forklift', name: d.name, tbId: d.id, ...d.values }));
    const trucks = by('truck').map((d) => ({ id: d.name, type: 'truck', name: d.name, tbId: d.id, ...d.values, onSite: !!d.values.onSite }));
    const drones = by('drone').map((d) => ({ id: d.name, type: 'drone', name: d.name, tbId: d.id, ...d.values, airborne: !!d.values.airborne, scanning: !!d.values.scanning }));
    const docks = by('dock').map((d) => {
      const code = d.values.code || d.name.split('-').pop();
      return { ...d.values, id: code, type: 'dock', tbId: d.id, name: d.values.name || d.label || code, index: num(d.values.index, Number(code.slice(1)) - 1) };
    }).sort((a, b) => a.index - b.index);
    const chargers = by('charger').map((d) => {
      const code = d.values.code || d.name.split('-').pop();
      return { ...d.values, id: code, type: 'charger', tbId: d.id, name: code, busy: !!d.values.busy };
    });
    return {
      ts: Date.now(),
      site: {
        code: sv.code || site?.name || 'Site', name: sv.name || site?.label || 'ThingsBoard site', tbId: site?.id,
        capacity: num(sv.capacity, 0), stockOnHand: num(sv.stockOnHand, 0), stockDelta: num(sv.stockDelta, 0),
        trucksOnSite: num(sv.trucksOnSite, trucks.filter((t) => t.onSite).length), trucksInbound: num(sv.trucksInbound, 0),
        onTimeDelivery: num(sv.onTimeDelivery, 0), onTimeDelta: num(sv.onTimeDelta, 0), utilisation: num(sv.utilisation, 0),
        docksOccupied: num(sv.docksOccupied, docks.filter((d) => d.truck).length), docksTotal: docks.length,
      },
      forklifts, trucks, drones, docks, chargers,
    };
  }

  deviceUrl(tbId) { return tbId ? `${this.host}/entities/devices/${tbId}` : null; }

  stop() {
    this.closed = true;
    clearInterval(this.refreshTimer);
    this.ws?.close();
  }
}

function parse(v) {
  if (typeof v !== 'string') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (v[0] === '{' || v[0] === '[') { try { return JSON.parse(v); } catch { /* plain string */ } }
  return v;
}
function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
