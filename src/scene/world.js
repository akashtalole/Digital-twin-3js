// three.js world: static cross-dock environment + live entities driven by snapshots.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  BUILDING, DOCK_COUNT, DOCK_SPACING, dockZ, ROAD_X, ROAD_WIDTH, LANE_X, TRAILER_REAR_X,
  CHARGER_COUNT, chargerX, CHARGER_Z, IDLE_Z, idleX,
} from '../model/layout.js';
import { corrugatedTexture, rollerDoorTexture, roadTexture, labelTexture, signTexture } from './textures.js';
import {
  MAT, createForklift, createTruck, createCharger, createTree, createPin, createSelectionRing, palletStack,
} from './models.js';

const HOME = { target: new THREE.Vector3(-6, 0, -9), radius: 108, polar: 0.92, azimuth: -0.82 };

const THEMES = {
  light: { bg: '#e8edf5', ground: '#dfe5ee', yard: '#eef1f6', road: '#ffffff', hemi: 1.15, sun: 1.75, lines: '#f2b21b' },
  dark: { bg: '#0f1522', ground: '#1c2436', yard: '#36415a', road: '#7d889e', hemi: 0.8, sun: 1.25, lines: '#d79b13' },
};

const STATUS_BEACON = {
  Unloading: '#3ccf7a', Loading: '#4f7dff', Charging: '#f5a524', 'To charger': '#f5a524', Idle: '#9aa5b8',
};

export class World {
  constructor(canvas, { onSelect, onHover } = {}) {
    this.canvas = canvas;
    this.onSelect = onSelect || (() => {});
    this.onHover = onHover || (() => {});
    this.entities = new Map();
    this.selected = null;
    this.follow = false;
    this.clock = new THREE.Clock();
    this.tween = null;
    this.smoothing = 7;
    this.frameHooks = [];

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 900);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.08, maxPolarAngle: 1.36, minPolarAngle: 0.25,
      minDistance: 18, maxDistance: 230, screenSpacePanning: false,
    });
    this.controls.addEventListener('start', () => { this.tween = null; });
    this.#placeCamera(HOME);

    this.#buildLights();
    this.#buildEnvironment();

    this.ring = createSelectionRing();
    this.ring.visible = false;
    this.pin = createPin();
    this.pin.visible = false;
    this.scene.add(this.ring, this.pin);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.#bindPointer();

    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    renderer.setAnimationLoop(() => this.#frame());
  }

  // ------------------------------------------------------------ scene setup
  #buildLights() {
    this.hemi = new THREE.HemisphereLight('#ffffff', '#b6c0d4', 1.15);
    const sun = new THREE.DirectionalLight('#ffffff', 1.75);
    sun.position.set(-40, 70, 45);
    sun.target.position.set(0, 0, -8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 10, far: 220 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.scene.add(this.hemi, sun, sun.target);
  }

  #plane(w, d, mat, x, z, y = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  #buildEnvironment() {
    const B = BUILDING;
    this.groundMat = new THREE.MeshStandardMaterial({ color: THEMES.light.ground, roughness: 1 });
    this.yardMat = new THREE.MeshStandardMaterial({ color: THEMES.light.yard, roughness: 0.95 });
    this.lineMat = new THREE.MeshBasicMaterial({ color: THEMES.light.lines });
    const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });

    this.#plane(600, 600, this.groundMat, 0, 0, -0.02);
    const yardX0 = ROAD_X + ROAD_WIDTH / 2;
    this.#plane(B.x1 + 6 - yardX0, 92, this.yardMat, (yardX0 + B.x1 + 6) / 2, -8, 0);

    const rt = roadTexture();
    rt.repeat.set(1, 260 / 14);
    this.roadMat = new THREE.MeshStandardMaterial({ map: rt, roughness: 0.9 });
    this.#plane(ROAD_WIDTH, 260, this.roadMat, ROAD_X, 0, 0.005);
    this.#plane(2.2, 260, this.yardMat, ROAD_X - ROAD_WIDTH / 2 - 1.1, 0, 0.01); // sidewalk

    // Truck bays and the forklift lane
    const line = (w, d, x, z) => this.#plane(w, d, this.lineMat, x, z, 0.015);
    for (let i = 0; i < DOCK_COUNT; i++) {
      const z = dockZ(i);
      const x0 = TRAILER_REAR_X - 15.5;
      const x1 = TRAILER_REAR_X - 0.3;
      line(x1 - x0, 0.14, (x0 + x1) / 2, z - 1.75);
      line(x1 - x0, 0.14, (x0 + x1) / 2, z + 1.75);
      line(0.14, 3.64, x1, z);
    }
    for (let z = B.z0 - 4; z < B.z1 + 4; z += 3) line(0.14, 1.6, LANE_X + 2.4, z);
    for (let z = B.z0 - 4; z < B.z1 + 4; z += 3) this.#plane(1.4, 0.12, white, ROAD_X + ROAD_WIDTH / 2 + 3, z, 0.015);

    // Building shell
    const len = B.z1 - B.z0;
    const wallTex = (rx) => { const t = corrugatedTexture(); t.repeat.set(rx, 1); return t; };
    const wallMat = (rx) => new THREE.MeshStandardMaterial({ map: wallTex(rx), roughness: 0.7 });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(B.x1 - B.x0, B.h, len), [
      wallMat(len / 4), wallMat(len / 4), MAT.concrete, MAT.concrete, wallMat((B.x1 - B.x0) / 4), wallMat((B.x1 - B.x0) / 4),
    ]);
    shell.position.set((B.x0 + B.x1) / 2, B.h / 2, (B.z0 + B.z1) / 2);
    shell.castShadow = true; shell.receiveShadow = true;
    this.scene.add(shell);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, len), MAT.concrete);
    plinth.position.set(B.x0 - 0.2, 0.25, (B.z0 + B.z1) / 2);
    this.scene.add(plinth);

    const roofMat = new THREE.MeshStandardMaterial({ color: '#3a6cf0', roughness: 0.5 });
    const gableMat = new THREE.MeshStandardMaterial({ color: '#e6eaf2', roughness: 0.7 });
    const half = DOCK_SPACING / 2;
    const shape = new THREE.Shape([new THREE.Vector2(-half - 0.15, 0), new THREE.Vector2(half + 0.15, 0), new THREE.Vector2(0, 2.8)]);
    const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: B.x1 - B.x0 + 0.8, bevelEnabled: false });
    for (let i = 0; i < DOCK_COUNT; i++) {
      const roof = new THREE.Mesh(roofGeo, [gableMat, roofMat]);
      roof.rotation.y = Math.PI / 2;
      roof.position.set(B.x0 - 0.4, B.h, dockZ(i));
      roof.castShadow = true; roof.receiveShadow = true;
      this.scene.add(roof);
    }

    // Dock doors
    this.doors = [];
    const doorTex = rollerDoorTexture();
    const doorMat = new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.6 });
    const interior = new THREE.MeshStandardMaterial({ color: '#5c6886', roughness: 1 });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#2457e6', roughness: 0.4 });
    const W = 4.2; const H = 4.6; const sill = 0.3;
    for (let i = 0; i < DOCK_COUNT; i++) {
      const z = dockZ(i);
      const g = new THREE.Group();
      g.position.set(B.x0, 0, z);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), interior);
      back.rotation.y = -Math.PI / 2; back.position.set(-0.02, sill + H / 2, 0);
      g.add(back);
      const stackA = palletStack(2, 2, 3, 0.55); stackA.position.set(-0.3, sill, -1.0);
      const stackB = palletStack(2, 2, 2 + (i % 2), 0.55); stackB.position.set(-0.3, sill, 1.0);
      g.add(stackA, stackB);
      const post = (zz) => { const p = new THREE.Mesh(new THREE.BoxGeometry(1.0, H + 0.6, 0.4), frameMat); p.position.set(-0.5, (H + 0.6) / 2, zz); p.castShadow = true; return p; };
      g.add(post(-W / 2 - 0.2), post(W / 2 + 0.2));
      const header = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, W + 0.8), frameMat);
      header.position.set(-0.5, sill + H + 0.22, 0); header.castShadow = true;
      g.add(header);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.1, H, W), doorMat);
      panel.position.set(-0.95, sill + H / 2, 0);
      panel.castShadow = true;
      g.add(panel);
      for (const zz of [-1.4, 1.4]) {
        const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.35), MAT.black);
        bumper.position.set(-1.1, 0.5, zz); g.add(bumper);
      }
      const lightMat = new THREE.MeshStandardMaterial({ color: '#9aa5b8', emissive: '#000000' });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), lightMat);
      lamp.position.set(-1.05, sill + H + 0.25, W / 2 + 0.2);
      g.add(lamp);
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshBasicMaterial({ map: labelTexture(`D${i + 1}`), transparent: true }));
      tag.rotation.y = -Math.PI / 2; tag.position.set(-0.03, sill + H + 1.25, 0);
      g.add(tag);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1.4, H + 1, W + 1), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(-0.6, (H + 1) / 2, 0);
      g.add(hit);
      this.scene.add(g);
      this.doors.push({ group: g, panel, lamp, lightMat, open: 0, target: 0, H, sill });
      this.#register(`D${i + 1}`, 'dock', g, { height: H + 1.6, anchor: new THREE.Vector3(-1.5, 0, 0) });
    }

    // Branding sign on the end wall
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true }));
    sign.position.set(B.x0 + 9, B.h - 2.4, B.z1 + 0.02);
    this.scene.add(sign);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshStandardMaterial({ color: '#1f4bd0' }));
    strip.rotation.y = -Math.PI / 2; strip.position.set(B.x0 - 0.02, B.h - 1.0, dockZ(0) - 2.6);
    this.scene.add(strip);

    // Charging bay
    const pad = new THREE.MeshStandardMaterial({ color: '#d9f2e3', roughness: 1, transparent: true, opacity: 0.85 });
    this.padMat = pad;
    const cx0 = chargerX(0) - 2.4; const cx1 = chargerX(CHARGER_COUNT - 1) + 2.4;
    this.#plane(cx1 - cx0, 7.6, pad, (cx0 + cx1) / 2, CHARGER_Z + 3.3, 0.012);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(cx1 - cx0 + 6, 1.2, 0.35), MAT.concrete);
    wall.position.set((cx0 + cx1) / 2, 0.6, CHARGER_Z - 0.75); wall.castShadow = true; wall.receiveShadow = true;
    this.scene.add(wall);
    this.chargers = [];
    for (let i = 0; i < CHARGER_COUNT; i++) {
      const c = createCharger(`C${i + 1}`);
      c.position.set(chargerX(i), 0, CHARGER_Z);
      this.scene.add(c);
      this.chargers.push(c);
      this.#register(`C${i + 1}`, 'charger', c, { height: 1.8 });
    }

    // Staging area for idle forklifts
    const staging = new THREE.MeshStandardMaterial({ color: '#dfe7fb', roughness: 1, transparent: true, opacity: 0.8 });
    this.stagingMat = staging;
    this.#plane(idleX(4) - idleX(0) + 4, 5, staging, (idleX(0) + idleX(4)) / 2, IDLE_Z, 0.012);

    // Fence + trees
    const fenceMat = new THREE.MeshBasicMaterial({ color: '#8f9bb0', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
    const fence = (x0, z0, x1, z1) => {
      const L = Math.hypot(x1 - x0, z1 - z0);
      const ang = Math.atan2(-(z1 - z0), x1 - x0);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(L, 1.8), fenceMat);
      mesh.position.set((x0 + x1) / 2, 0.9, (z0 + z1) / 2); mesh.rotation.y = ang;
      this.scene.add(mesh);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.06, 0.06), MAT.steel);
      rail.position.set((x0 + x1) / 2, 1.8, (z0 + z1) / 2); rail.rotation.y = ang;
      this.scene.add(rail);
      const n = Math.max(1, Math.round(L / 3));
      for (let k = 0; k <= n; k++) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6), MAT.steel);
        p.position.set(x0 + ((x1 - x0) * k) / n, 0.95, z0 + ((z1 - z0) * k) / n);
        this.scene.add(p);
      }
    };
    const fx = ROAD_X + ROAD_WIDTH / 2 + 0.5;
    fence(fx, 33, B.x1 + 5, 33);
    fence(fx, 26, fx, 33);
    fence(fx, -52, B.x1 + 5, -52);
    fence(fx, -52, fx, -46);
    for (const [x, z, s] of [[-52, -30, 1.2], [-52, 4, 1.0], [-50, 30, 1.3], [-26, 38, 1.1], [-4, 38, 0.9], [24, 38, 1.2], [-24, -57, 1.0], [8, -58, 1.2], [50, 28, 1.1]]) {
      const t = createTree(s); t.position.set(x, 0, z); this.scene.add(t);
    }
  }

  // --------------------------------------------------------------- entities
  #register(id, kind, obj, extra = {}) {
    obj.traverse((o) => { o.userData.entityId = id; });
    const e = { id, kind, obj, data: null, target: null, height: extra.height || 3, anchor: extra.anchor || new THREE.Vector3(), seen: false };
    this.entities.set(id, e);
    return e;
  }

  #ensure(id, kind, factory) {
    let e = this.entities.get(id);
    if (!e) {
      const obj = factory();
      this.scene.add(obj);
      e = this.#register(id, kind, obj, { height: obj.userData.height });
    }
    return e;
  }

  update(snapshot, { smoothing = 7 } = {}) {
    this.smoothing = smoothing;
    for (const f of snapshot.forklifts || []) {
      const e = this.#ensure(f.id, 'forklift', createForklift);
      e.data = f;
      e.target = { x: num(f.x, 0), z: num(f.z, 0), h: num(f.heading, 0) };
      if (!e.seen) { e.obj.position.set(e.target.x, 0, e.target.z); e.obj.rotation.y = e.target.h; e.seen = true; }
    }
    for (const t of snapshot.trucks || []) {
      const e = this.#ensure(t.id, 'truck', createTruck);
      const wasVisible = e.obj.visible && e.seen;
      e.data = t;
      e.target = { x: num(t.x, 0), z: num(t.z, 0), h: num(t.heading, 0) };
      e.obj.visible = !!t.onSite;
      if (t.onSite && !wasVisible) { e.obj.position.set(e.target.x, 0, e.target.z); e.obj.rotation.y = e.target.h; }
      e.seen = true;
    }
    for (const d of snapshot.docks || []) {
      const e = this.entities.get(d.id);
      if (!e) continue;
      e.data = d;
      const door = this.doors[d.index ?? Number(d.id.slice(1)) - 1];
      if (door) { door.target = num(d.doorOpen, 0); door.occupied = !!d.truck; }
    }
    for (const c of snapshot.chargers || []) {
      const e = this.entities.get(c.id);
      if (e) e.data = c;
    }
  }

  // ------------------------------------------------------------ interaction
  #bindPointer() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY }; });
    this.canvas.addEventListener('pointerup', (ev) => {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
      const id = this.#pick(ev);
      this.select(id);
      this.onSelect(id);
    });
    let pending = false;
    this.canvas.addEventListener('pointermove', (ev) => {
      if (pending || ev.buttons) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const id = this.#pick(ev);
        if (id !== this.hovered) { this.hovered = id; this.canvas.style.cursor = id ? 'pointer' : ''; this.onHover(id); }
      });
    });
    this.canvas.addEventListener('pointerleave', () => { this.hovered = null; this.onHover(null); });
  }

  #pick(ev) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const roots = [...this.entities.values()].filter((e) => e.obj.visible).map((e) => e.obj);
    const hit = this.raycaster.intersectObjects(roots, true)[0];
    return hit?.object.userData.entityId || null;
  }

  select(id) {
    this.selected = id && this.entities.has(id) ? id : null;
    if (!this.selected) this.follow = false;
  }

  focus(id, { distance = 46 } = {}) {
    const e = this.entities.get(id);
    if (!e) return;
    const p = this.#entityPos(e);
    const offset = this.camera.position.clone().sub(this.controls.target).setLength(distance);
    this.#tweenTo(p, p.clone().add(offset));
  }

  zoom(factor) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.#tweenTo(this.controls.target.clone(), this.controls.target.clone().add(offset.setLength(len)));
  }

  rotate(angle) {
    const offset = this.camera.position.clone().sub(this.controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.#tweenTo(this.controls.target.clone(), this.controls.target.clone().add(offset));
  }

  home() {
    this.follow = false;
    const s = new THREE.Spherical(HOME.radius, HOME.polar, HOME.azimuth);
    this.#tweenTo(HOME.target.clone(), HOME.target.clone().add(new THREE.Vector3().setFromSpherical(s)));
  }

  #placeCamera({ target, radius, polar, azimuth }) {
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(radius, polar, azimuth)));
    this.controls.update();
  }

  #tweenTo(target, position, dur = 0.9) {
    this.tween = { t: 0, dur, fromT: this.controls.target.clone(), toT: target, fromP: this.camera.position.clone(), toP: position };
  }

  #entityPos(e) {
    return e.obj.localToWorld(e.anchor.clone());
  }

  screenPosition(id) {
    const e = this.entities.get(id);
    if (!e || !e.obj.visible) return null;
    const p = this.#entityPos(e);
    p.y += e.height + 0.6;
    p.project(this.camera);
    if (p.z > 1) return null;
    const r = this.canvas.getBoundingClientRect();
    return { x: ((p.x + 1) / 2) * r.width + r.left, y: ((1 - p.y) / 2) * r.height + r.top };
  }

  setTheme(dark) {
    const t = dark ? THEMES.dark : THEMES.light;
    this.scene.background = new THREE.Color(t.bg);
    this.scene.fog = new THREE.Fog(t.bg, 170, 420);
    this.groundMat.color.set(t.ground);
    this.yardMat.color.set(t.yard);
    this.roadMat.color.set(t.road);
    this.lineMat.color.set(t.lines);
    this.padMat.color.set(dark ? '#1f4a35' : '#d9f2e3');
    this.stagingMat.color.set(dark ? '#25345a' : '#dfe7fb');
    this.hemi.intensity = t.hemi;
    this.sun.intensity = t.sun;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Pull the camera back on narrow screens so the whole yard still fits.
    this.camera.fov = w < h ? 44 : 30;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ frame
  #frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.elapsedTime;
    const k = 1 - Math.exp(-dt * this.smoothing);

    for (const e of this.entities.values()) {
      if (e.target && (e.kind === 'forklift' || e.kind === 'truck')) {
        const o = e.obj;
        const prev = o.position.clone();
        o.position.x += (e.target.x - o.position.x) * k;
        o.position.z += (e.target.z - o.position.z) * k;
        o.rotation.y += shortest(o.rotation.y, e.target.h) * k;
        if (this.follow && this.selected === e.id && !this.tween) {
          const d = o.position.clone().sub(prev);
          this.camera.position.add(d); this.controls.target.add(d);
        }
      }
      if (e.kind === 'forklift' && e.data) {
        const { carriage, load, beacon } = e.obj.userData;
        const lift = e.data.carrying ? 0.42 : 0.02;
        carriage.position.y += (lift - carriage.position.y) * Math.min(1, dt * 5);
        load.visible = !!e.data.carrying;
        const col = STATUS_BEACON[e.data.status] || '#9aa5b8';
        beacon.material.color.set(col); beacon.material.emissive.set(col);
        beacon.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(time * 5 + e.id.length);
      }
      if (e.kind === 'charger') {
        const busy = !!e.data?.busy;
        const { screen, pad } = e.obj.userData;
        screen.emissiveIntensity = busy ? 0.55 + 0.35 * Math.sin(time * 3) : 0.15;
        screen.color.set(busy ? '#3ccf7a' : '#9aa5b8'); screen.emissive.set(busy ? '#3ccf7a' : '#4a5468');
        pad.visible = busy;
        pad.material.opacity = 0.65 + 0.3 * Math.sin(time * 2.4);
      }
    }

    for (const d of this.doors) {
      d.open += (d.target - d.open) * Math.min(1, dt * 3);
      const s = 1 - 0.86 * d.open;
      d.panel.scale.y = s;
      d.panel.position.y = d.sill + d.H - (d.H * s) / 2;
      d.lightMat.color.set(d.occupied ? '#3ccf7a' : '#9aa5b8');
      d.lightMat.emissive.set(d.occupied ? '#1f9d55' : '#000000');
    }

    const sel = this.selected && this.entities.get(this.selected);
    if (sel && sel.obj.visible) {
      const p = this.#entityPos(sel);
      const radius = sel.kind === 'truck' ? 7.6 : sel.kind === 'dock' ? 3.4 : 2.0;
      this.ring.visible = true;
      this.ring.position.set(p.x, 0.04, p.z);
      this.ring.scale.setScalar(radius * (1 + 0.04 * Math.sin(time * 3)));
      this.pin.visible = true;
      this.pin.position.set(p.x, sel.height + 1.2 + Math.sin(time * 2.2) * 0.25, p.z);
      this.pin.rotation.y = time * 0.8;
    } else {
      this.ring.visible = false; this.pin.visible = false;
    }

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const s = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
      this.controls.target.lerpVectors(tw.fromT, tw.toT, s);
      this.camera.position.lerpVectors(tw.fromP, tw.toP, s);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    for (const hook of this.frameHooks) hook();
  }
}

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function shortest(a, b) { return ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; }
