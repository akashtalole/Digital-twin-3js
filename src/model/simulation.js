// Cross-dock yard simulator. Pure JS (no DOM, no three.js) so it runs both in
// the browser (demo mode) and in Node (tools/tb-simulator.mjs, which pushes the
// same state to ThingsBoard as device telemetry).
import {
  SITE, DOCK_COUNT, dockZ, dockLabel, dockKind, ROAD_X, LANE_X, TRUCK_PARK_X,
  PICK_TRAILER_X, PICK_DOOR_X, CHARGER_COUNT, chargerX, CHARGER_SPOT_Z,
  CHARGER_APPROACH_Z, IDLE_Z, idleX, headingFrom,
} from './layout.js';

const FORKLIFTS = [
  { id: 'FL-10', operator: 'Maya Ortiz', model: 'Toyota 8FBE18' },
  { id: 'FL-11', operator: 'Dev Patel', model: 'Toyota 8FBE18' },
  { id: 'FL-12', operator: 'Zoe Larsen', model: 'Toyota 8FBE18' },
  { id: 'FL-13', operator: 'Sam Okafor', model: 'Linde E20' },
  { id: 'FL-14', operator: 'Lena Weiss', model: 'Linde E20' },
];

const TRUCKS = [
  { id: 'TRK-2205', carrier: 'Northline Freight' },
  { id: 'TRK-2229', carrier: 'Bluewater Logistics' },
  { id: 'TRK-2231', carrier: 'Northline Freight' },
  { id: 'TRK-2240', carrier: 'Keystone Haulage' },
  { id: 'TRK-2246', carrier: 'Bluewater Logistics' },
  { id: 'TRK-2251', carrier: 'Keystone Haulage' },
];

const PARTNERS = ['Detroit DC', 'Toledo Plant', 'Ann Arbor Hub', 'Flint Supplier Park', 'Lansing Retail DC', 'Grand Rapids FC'];

const FORKLIFT_SPEED = 3.2; // m/s
const TRUCK_SPEED = 9;
const TRUCK_REVERSE_SPEED = 2.6;
const PICK_TIME = 3;
const DROP_TIME = 2.4;
const MAX_PER_TRUCK = 2;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export class YardSimulation {
  constructor({ seed = 4, now = Date.now() } = {}) {
    this.rand = mulberry32(seed);
    this.startWall = now;
    this.t = 0;
    this.shipmentSeq = 78450;
    this.site = { ...SITE, stock: 610, stockStart: 590, onTime: 96.2, onTimeStart: 95.8 };

    this.docks = Array.from({ length: DOCK_COUNT }, (_, i) => ({
      id: `D${i + 1}`, index: i, name: dockLabel(i), kind: dockKind(i), truck: null, door: 0,
    }));
    this.chargers = Array.from({ length: CHARGER_COUNT }, (_, i) => ({ id: `C${i + 1}`, index: i, forklift: null }));

    this.forklifts = FORKLIFTS.map((f, i) => ({
      ...f, x: idleX(i), z: IDLE_Z, heading: Math.PI / 2, speed: 0, battery: 70,
      state: 'idle', path: [], timer: 0, job: null, carrying: false, moves: 8 + Math.floor(this.rand() * 18),
      spot: { approach: null }, charger: null, idleSpot: i,
    }));

    this.trucks = TRUCKS.map((t) => ({
      ...t, dir: 'inbound', status: 'offsite', x: ROAD_X, z: -95, heading: -Math.PI / 2, speed: 0,
      path: [], dock: null, pallets: 0, moved: 0, reserved: 0, eta: 0, timer: 0, shipment: null, finishAt: null,
    }));

    this.#seedScene();
  }

  // Start in a busy, realistic state rather than an empty yard.
  #seedScene() {
    const [t1, t2, t3, t4] = this.trucks;
    this.#dockTruckNow(t1, 0, 'inbound', 16, 5);
    this.#dockTruckNow(t2, 4, 'outbound', 12, 3);
    this.#schedule(t3, 'inbound', 6);
    this.#schedule(t4, 'outbound', 30);
    this.#schedule(this.trucks[4], 'inbound', 70);
    this.#schedule(this.trucks[5], 'outbound', 110);

    const [f10, f11, f12, f13] = this.forklifts;
    f10.battery = 84; f11.battery = 82; f12.battery = 88; f13.battery = 94; this.forklifts[4].battery = 61;
    this.#assign(f10, t1);
    this.#assign(f11, t2);
    this.#parkAtCharger(f12, 2);
    this.#parkAtCharger(f13, 3);
  }

  // ---------------------------------------------------------------- helpers
  wall(t = this.t) { return this.startWall + t * 1000; }

  #newShipment(truck, dir) {
    const party = PARTNERS[Math.floor(this.rand() * PARTNERS.length)];
    const now = this.wall();
    const m = 60000;
    const ago = (min) => now - min * m;
    const stages = dir === 'inbound'
      ? [{ label: 'Order confirmed', ts: ago(165) }, { label: 'Picked', ts: ago(77) }, { label: 'Loaded', ts: ago(32) }, { label: 'In transit', ts: ago(6) }, { label: 'Unloading', ts: null }]
      : [{ label: 'Order confirmed', ts: ago(120) }, { label: 'Picked', ts: ago(25) }, { label: 'Loading', ts: null }, { label: 'Departed', ts: null }, { label: 'Delivered', ts: null }];
    return {
      id: `SHP-${this.shipmentSeq++}`, dir, party, stages, current: dir === 'inbound' ? 3 : 2,
      from: dir === 'inbound' ? party : `${SITE.code} ${SITE.name}`,
      to: dir === 'inbound' ? `${SITE.code} ${SITE.name}` : party,
    };
  }

  #schedule(truck, dir, eta) {
    Object.assign(truck, {
      dir, status: 'scheduled', eta, dock: null, path: [], pallets: 10 + Math.floor(this.rand() * 7),
      moved: 0, reserved: 0, x: ROAD_X + 2.5, z: -95, heading: -Math.PI / 2, speed: 0, finishAt: null,
    });
    truck.shipment = this.#newShipment(truck, dir);
  }

  #dockTruckNow(truck, dockIndex, dir, pallets, moved) {
    this.#schedule(truck, dir, 0);
    const dock = this.docks[dockIndex];
    Object.assign(truck, {
      status: dir === 'inbound' ? 'unloading' : 'loading', dock: dockIndex, pallets, moved, reserved: moved,
      x: TRUCK_PARK_X, z: dockZ(dockIndex), heading: Math.PI,
    });
    dock.truck = truck.id; dock.door = 1;
    truck.shipment.stages[dir === 'inbound' ? 4 : 2].ts = this.wall() - 13 * 60000;
    truck.shipment.current = dir === 'inbound' ? 4 : 2;
  }

  #parkAtCharger(f, ci) {
    const c = this.chargers[ci];
    c.forklift = f.id; f.charger = ci;
    Object.assign(f, { x: chargerX(ci), z: CHARGER_SPOT_Z, heading: Math.PI / 2, state: 'charging', path: [] });
    f.spot = { approach: { x: chargerX(ci), z: CHARGER_APPROACH_Z } };
  }

  #route(f, to, toApproach = null) {
    const pts = [];
    const from = f.spot?.approach;
    if (from) pts.push(from);
    const a = from || f;
    const b = toApproach || to;
    if (Math.abs(a.z - b.z) > 1.2) {
      pts.push({ x: LANE_X, z: a.z }, { x: LANE_X, z: b.z });
    }
    if (toApproach) pts.push(toApproach);
    pts.push(to);
    f.path = pts;
    f.spot = { approach: null };
  }

  #slotOf(f, truck) {
    const others = this.forklifts.filter((o) => o !== f && o.job?.truck === truck.id);
    return others.some((o) => o.job.slot === 0) ? 1 : 0;
  }

  #points(truck, slot) {
    const z = dockZ(truck.dock) + (slot === 0 ? -0.95 : 0.95);
    const trailer = { x: PICK_TRAILER_X, z };
    const door = { x: PICK_DOOR_X, z };
    return truck.dir === 'inbound' ? { pick: trailer, drop: door } : { pick: door, drop: trailer };
  }

  #assign(f, truck) {
    truck.reserved++;
    const slot = this.#slotOf(f, truck);
    f.job = { truck: truck.id, slot };
    f.state = 'toPick';
    this.#route(f, this.#points(truck, slot).pick);
  }

  #goCharge(f) {
    const ci = this.chargers.findIndex((c) => !c.forklift);
    if (ci < 0) return false;
    this.chargers[ci].forklift = f.id;
    f.charger = ci;
    f.state = 'toCharger';
    f.job = null;
    this.#route(f, { x: chargerX(ci), z: CHARGER_SPOT_Z }, { x: chargerX(ci), z: CHARGER_APPROACH_Z });
    return true;
  }

  #goIdle(f) {
    const taken = new Set(this.forklifts.filter((o) => o !== f && (o.state === 'idle' || o.state === 'toIdle')).map((o) => o.idleSpot));
    let spot = f.idleSpot;
    if (taken.has(spot)) spot = [0, 1, 2, 3, 4].find((s) => !taken.has(s)) ?? spot;
    f.idleSpot = spot;
    f.state = 'toIdle';
    f.job = null;
    this.#route(f, { x: idleX(spot), z: IDLE_Z });
  }

  #move(e, speedFor, dt) {
    if (!e.path.length) { e.speed = 0; return true; }
    let remaining = dt;
    let moved = 0;
    while (remaining > 0 && e.path.length) {
      const p = e.path[0];
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d = Math.hypot(dx, dz);
      const v = speedFor(p);
      if (d < 1e-3) { e.path.shift(); continue; }
      const target = headingFrom(dx, dz) + (p.rev ? Math.PI : 0);
      e.heading = turnToward(e.heading, target, dt * 4.5);
      const step = Math.min(d, v * remaining);
      e.x += (dx / d) * step;
      e.z += (dz / d) * step;
      moved += step;
      remaining -= step / v;
      if (step >= d - 1e-6) e.path.shift();
    }
    e.speed = moved / dt;
    return e.path.length === 0;
  }

  // ------------------------------------------------------------------ step
  step(dt) {
    this.t += dt;
    for (const truck of this.trucks) this.#stepTruck(truck, dt);
    for (const f of this.forklifts) this.#stepForklift(f, dt);
    this.#dispatch();
    for (const d of this.docks) {
      const truck = d.truck && this.trucks.find((t) => t.id === d.truck);
      const open = truck && (truck.status === 'unloading' || truck.status === 'loading');
      d.door = clamp(d.door + (open ? dt : -dt) / 2.5, 0, 1);
    }
    const s = this.site;
    s.onTime = clamp(s.onTime + (this.rand() - 0.5) * 0.004 * dt, 94.5, 98.5);
  }

  #stepTruck(t, dt) {
    switch (t.status) {
      case 'scheduled':
      case 'waiting': {
        t.eta -= dt;
        if (t.eta > 0) return;
        const kind = t.dir === 'inbound' ? 'inbound' : 'outbound';
        const free = this.docks.filter((d) => d.kind === kind && !d.truck);
        if (!free.length) { t.status = 'waiting'; t.eta = 0; return; }
        const dock = free[Math.floor(this.rand() * free.length)];
        dock.truck = t.id;
        t.dock = dock.index;
        t.status = 'arriving';
        const z = dockZ(dock.index);
        t.x = ROAD_X + 2.5; t.z = -95; t.heading = -Math.PI / 2;
        t.path = [{ x: ROAD_X + 2.5, z }, { x: TRUCK_PARK_X, z, rev: true }];
        return;
      }
      case 'arriving':
        if (this.#move(t, (p) => (p.rev ? TRUCK_REVERSE_SPEED : TRUCK_SPEED), dt)) {
          t.heading = Math.PI;
          t.status = t.dir === 'inbound' ? 'unloading' : 'loading';
          const st = t.shipment.stages[t.dir === 'inbound' ? 4 : 2];
          st.ts = this.wall();
          t.shipment.current = t.dir === 'inbound' ? 4 : 2;
        }
        return;
      case 'unloading':
      case 'loading':
        if (t.moved >= t.pallets) { t.status = 'sealing'; t.timer = 3; }
        return;
      case 'sealing':
        t.timer -= dt;
        if (t.timer <= 0) {
          const z = dockZ(t.dock);
          this.docks[t.dock].truck = null;
          t.status = 'departing';
          t.path = [{ x: ROAD_X - 2.5, z }, { x: ROAD_X - 2.5, z: 95 }];
          const sh = t.shipment;
          if (t.dir === 'inbound') { sh.current = 5; }
          else { sh.stages[3].ts = this.wall(); sh.current = 4; }
        }
        return;
      case 'departing':
        if (this.#move(t, () => TRUCK_SPEED, dt)) {
          t.status = 'offsite';
          const dir = this.rand() < 0.55 ? 'inbound' : 'outbound';
          this.#schedule(t, dir, 25 + this.rand() * 60);
        }
        return;
      default:
    }
  }

  #stepForklift(f, dt) {
    const moving = f.path.length > 0;
    if (moving) this.#move(f, () => FORKLIFT_SPEED, dt); else f.speed = 0;
    const truck = f.job && this.trucks.find((t) => t.id === f.job.truck);

    if (f.state === 'charging') f.battery = Math.min(100, f.battery + 0.42 * dt);
    else if (moving) f.battery -= (f.carrying ? 0.2 : 0.15) * dt;
    else if (f.state === 'picking' || f.state === 'dropping') f.battery -= 0.05 * dt;
    else f.battery -= 0.004 * dt;
    f.battery = clamp(f.battery, 3, 100);

    if (moving && f.path.length) return; // still travelling

    switch (f.state) {
      case 'toPick': f.state = 'picking'; f.timer = PICK_TIME; break;
      case 'picking':
        f.timer -= dt;
        if (f.timer <= 0) {
          f.carrying = true;
          if (truck.dir === 'outbound') this.site.stock--;
          f.state = 'toDrop';
          this.#route(f, this.#points(truck, f.job.slot).drop);
        }
        break;
      case 'toDrop': f.state = 'dropping'; f.timer = DROP_TIME; break;
      case 'dropping':
        f.timer -= dt;
        if (f.timer <= 0) {
          f.carrying = false;
          f.moves++;
          truck.moved++;
          if (truck.dir === 'inbound') this.site.stock++;
          if (f.battery < 30 && this.#goCharge(f)) {
            /* heading to charger */
          } else if (truck.reserved < truck.pallets) {
            truck.reserved++;
            f.state = 'toPick';
            this.#route(f, this.#points(truck, f.job.slot).pick);
          } else {
            f.job = null; f.state = 'free'; f.timer = 2.5;
          }
        }
        break;
      case 'free':
        f.timer -= dt;
        if (f.timer <= 0) this.#goIdle(f);
        break;
      case 'toIdle': f.state = 'idle'; f.heading = turnToward(f.heading, Math.PI / 2, 1); break;
      case 'toCharger': f.state = 'charging'; f.spot = { approach: { x: chargerX(f.charger), z: CHARGER_APPROACH_Z } }; break;
      case 'charging':
        if (f.battery >= 96) {
          this.chargers[f.charger].forklift = null;
          f.charger = null;
          f.state = 'free'; f.timer = 0.5;
        }
        break;
      default:
    }
  }

  #dispatch() {
    const available = () => this.forklifts.filter((f) => ['idle', 'toIdle', 'free'].includes(f.state));
    for (const f of available()) {
      if (f.battery < 35 && this.#goCharge(f)) continue;
    }
    const work = this.trucks.filter((t) => (t.status === 'unloading' || t.status === 'loading') && t.reserved < t.pallets);
    for (const t of work) {
      const assigned = this.forklifts.filter((f) => f.job?.truck === t.id).length;
      if (assigned >= MAX_PER_TRUCK) continue;
      const z = dockZ(t.dock);
      const pool = available().filter((f) => f.battery >= 35).sort((a, b) => Math.abs(a.z - z) - Math.abs(b.z - z));
      if (pool[0]) this.#assign(pool[0], t);
    }
  }

  // -------------------------------------------------------------- snapshot
  snapshot() {
    const now = this.wall();
    const docked = this.docks.filter((d) => d.truck).length;
    const onSite = this.trucks.filter((t) => ['arriving', 'unloading', 'loading', 'sealing', 'departing'].includes(t.status));
    const inbound = this.trucks.filter((t) => t.dir === 'inbound' && ['scheduled', 'waiting', 'arriving'].includes(t.status) && t.eta < 600);
    const s = this.site;
    return {
      ts: now,
      site: {
        code: s.code, name: s.name, capacity: s.capacity,
        stockOnHand: s.stock, stockDelta: s.stock - s.stockStart,
        trucksOnSite: onSite.length, trucksInbound: inbound.length,
        onTimeDelivery: round(s.onTime, 1), onTimeDelta: round(s.onTime - s.onTimeStart, 1),
        utilisation: Math.round((s.stock / s.capacity) * 100), docksOccupied: docked, docksTotal: this.docks.length,
      },
      docks: this.docks.map((d) => ({
        id: d.id, type: 'dock', name: d.name, kind: d.kind, index: d.index,
        doorOpen: round(d.door, 2), truck: d.truck || '',
        forklifts: this.forklifts.filter((f) => f.job && this.trucks.find((t) => t.id === f.job.truck)?.dock === d.index).length,
      })),
      chargers: this.chargers.map((c) => ({ id: c.id, type: 'charger', name: c.id, index: c.index, busy: !!c.forklift, forklift: c.forklift || '' })),
      forklifts: this.forklifts.map((f) => this.#forkliftView(f)),
      trucks: this.trucks.map((t) => this.#truckView(t, now)),
    };
  }

  #forkliftView(f) {
    const truck = f.job && this.trucks.find((t) => t.id === f.job.truck);
    let status = 'Idle';
    let task = 'Waiting for task';
    if (truck) {
      const verb = truck.dir === 'inbound' ? 'Unloading' : 'Loading';
      status = verb;
      task = `${verb} ${truck.id} at ${dockLabel(truck.dock)}`;
    } else if (f.state === 'toCharger') { status = 'To charger'; task = `Heading to charger C${f.charger + 1}`; }
    else if (f.state === 'charging') { status = 'Charging'; task = 'Charging at bay'; }
    else if (f.state === 'toIdle') { task = 'Parking at staging'; }
    return {
      id: f.id, type: 'forklift', name: f.id, operator: f.operator, model: f.model,
      status, task, battery: round(f.battery, 1), speed: round(f.speed * 3.6, 1),
      carrying: f.carrying, load: f.carrying && truck ? `1 pallet · ${truck.shipment.id}` : 'Empty',
      movesToday: f.moves, x: round(f.x), z: round(f.z), heading: round(f.heading, 3),
      charger: f.charger != null ? `C${f.charger + 1}` : '', truck: truck ? truck.id : '',
      dock: truck ? dockLabel(truck.dock) : '',
    };
  }

  #truckView(t, now) {
    const dock = t.dock != null ? dockLabel(t.dock) : '';
    const labels = {
      offsite: 'Off site', scheduled: 'En route', waiting: 'Waiting', arriving: 'Arriving',
      unloading: 'Unloading', loading: 'Loading', sealing: 'Sealing', departing: 'Departing',
    };
    const verb = t.dir === 'inbound' ? 'Unloading' : 'Loading';
    const tasks = {
      offsite: 'Off site',
      scheduled: `ETA ${Math.max(1, Math.ceil(t.eta / 60))} min · ${t.dir}`,
      waiting: 'Waiting for a free dock',
      arriving: `Reversing into ${dock}`,
      unloading: `${verb} at ${dock} · ${t.moved}/${t.pallets}`,
      loading: `${verb} at ${dock} · ${t.moved}/${t.pallets}`,
      sealing: `Sealing doors at ${dock}`,
      departing: 'Leaving site',
    };
    const crew = this.forklifts.filter((f) => f.job?.truck === t.id).length;
    let doneAt = null;
    if (t.status === 'unloading' || t.status === 'loading') {
      doneAt = now + ((t.pallets - t.moved) * 13000) / Math.max(1, crew);
    }
    const sh = t.shipment;
    return {
      id: t.id, type: 'truck', name: t.id, carrier: t.carrier, dir: t.dir,
      status: labels[t.status], phase: t.status, task: tasks[t.status], dock, dockIndex: t.dock ?? -1,
      onSite: ['arriving', 'unloading', 'loading', 'sealing', 'departing'].includes(t.status),
      x: round(t.x), z: round(t.z), heading: round(t.heading, 3), speed: round(t.speed * 3.6, 1),
      pallets: t.pallets, moved: t.moved, forklifts: crew,
      eta: t.status === 'scheduled' ? now + t.eta * 1000 : null, doneAt,
      shipment: sh && { id: sh.id, dir: sh.dir, from: sh.from, to: sh.to, current: sh.current, stages: sh.stages.map((s) => ({ ...s })) },
    };
  }
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

export function turnToward(a, b, maxStep) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}
