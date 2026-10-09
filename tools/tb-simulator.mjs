#!/usr/bin/env node
// Provisions the yard's devices in ThingsBoard and streams simulated telemetry
// to them over the device HTTP API, using the same simulator as the demo mode.
//
//   TB_HOST=http://localhost:8080 TB_USER=tenant@thingsboard.org TB_PASS=tenant \
//     node tools/tb-simulator.mjs
//
// Options (env): TB_INTERVAL_MS (default 1000), TB_SEED (default 4).
import { YardSimulation } from '../src/model/simulation.js';
import { SITE } from '../src/model/layout.js';

const HOST = (process.env.TB_HOST || 'http://localhost:8080').replace(/\/+$/, '');
const USER = process.env.TB_USER || 'tenant@thingsboard.org';
const PASS = process.env.TB_PASS || 'tenant';
const INTERVAL = Number(process.env.TB_INTERVAL_MS || 1000);

let jwt;
async function api(path, opts = {}) {
  const res = await fetch(HOST + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(jwt ? { 'X-Authorization': `Bearer ${jwt}` } : {}) },
  });
  if (res.status === 404 && opts.allow404) return null;
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function ensureDevice(name, type, label) {
  let dev = await api(`/api/tenant/devices?deviceName=${encodeURIComponent(name)}`, { allow404: true });
  if (!dev) {
    dev = await api('/api/device', { method: 'POST', body: JSON.stringify({ name, type, label }) });
    console.log(`  created ${type.padEnd(8)} ${name}`);
  }
  const cred = await api(`/api/device/${dev.id.id}/credentials`);
  return { name, type, token: cred.credentialsId };
}

const post = (token, kind, body) => fetch(`${HOST}/api/v1/${token}/${kind}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => { if (!r.ok) throw new Error(`${kind} ${r.status}`); });

// Split each snapshot entity into static attributes and changing telemetry.
const STATIC = {
  forklift: ['operator', 'model'],
  truck: ['carrier'],
  dock: ['code', 'name', 'kind', 'index'],
  charger: ['code', 'index'],
  site: ['code', 'name', 'capacity'],
};
const SKIP = new Set(['id', 'type']);

function split(type, entity) {
  const attrs = {}; const ts = {};
  for (const [k, v] of Object.entries(entity)) {
    if (SKIP.has(k)) continue;
    (STATIC[type].includes(k) ? attrs : ts)[k] = v;
  }
  return { attrs, ts };
}

function entities(snap) {
  return [
    { name: SITE.code, type: 'site', label: SITE.name, data: snap.site },
    ...snap.forklifts.map((f) => ({ name: f.id, type: 'forklift', label: `${f.model} · ${f.operator}`, data: f })),
    ...snap.trucks.map((t) => ({ name: t.id, type: 'truck', label: t.carrier, data: t })),
    ...snap.docks.map((d) => ({ name: `${SITE.code}-${d.id}`, type: 'dock', label: d.name, data: { ...d, code: d.id } })),
    ...snap.chargers.map((c) => ({ name: `${SITE.code}-${c.id}`, type: 'charger', label: `Charger ${c.id}`, data: { ...c, code: c.id } })),
  ];
}

async function main() {
  console.log(`ThingsBoard: ${HOST}`);
  const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: USER, password: PASS }) });
  jwt = login.token;

  const sim = new YardSimulation({ seed: Number(process.env.TB_SEED || 4) });
  const devices = new Map();
  console.log('Provisioning devices…');
  for (const e of entities(sim.snapshot())) {
    const dev = await ensureDevice(e.name, e.type, e.label);
    devices.set(e.name, dev);
    await post(dev.token, 'attributes', split(e.type, e.data).attrs);
  }
  console.log(`Streaming telemetry for ${devices.size} devices every ${INTERVAL} ms. Ctrl+C to stop.`);

  let last = Date.now();
  let ticks = 0;
  setInterval(async () => {
    const now = Date.now();
    let dt = (now - last) / 1000; last = now;
    while (dt > 0) { const s = Math.min(dt, 0.1); sim.step(s); dt -= s; }
    const snap = sim.snapshot();
    const jobs = entities(snap).map((e) => {
      const { ts } = split(e.type, e.data);
      return post(devices.get(e.name).token, 'telemetry', { ts: snap.ts, values: ts });
    });
    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (++ticks % 30 === 0 || failed) {
      console.log(`${new Date().toLocaleTimeString()}  stock ${snap.site.stockOnHand}  docked ${snap.site.docksOccupied}/6  ${failed ? `${failed} posts failed` : 'ok'}`);
    }
  }, INTERVAL);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
