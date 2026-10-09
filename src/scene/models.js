// Low-poly procedural models: forklift, truck, charger, pallets, props.
// Every model faces local +X (forks / cab forward), matching the simulator heading.
import * as THREE from 'three';
import { cartonTexture, trailerTexture, labelTexture, glowTexture } from './textures.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.05, ...extra });

export const MAT = {
  yellow: std('#f5b81c', { roughness: 0.45 }),
  yellowDark: std('#d99a0b'),
  black: std('#23262e', { roughness: 0.7 }),
  tyre: std('#1a1c22', { roughness: 0.9 }),
  steel: std('#8a93a6', { metalness: 0.4, roughness: 0.4 }),
  orange: std('#f07a1a'),
  skin: std('#e2b48f'),
  white: std('#f7f9fc', { roughness: 0.5 }),
  blue: std('#2457e6', { roughness: 0.4 }),
  blueDark: std('#1b3fae', { roughness: 0.5 }),
  glass: std('#22324f', { roughness: 0.15, metalness: 0.3 }),
  wood: std('#b98a5a', { roughness: 0.85 }),
  carton: new THREE.MeshStandardMaterial({ map: cartonTexture(), roughness: 0.8 }),
  green: std('#3ccf7a', { emissive: '#1f9d55', emissiveIntensity: 0.6 }),
  leaf: std('#5fc787', { roughness: 0.8 }),
  trunk: std('#9b7a5b'),
  concrete: std('#f1f3f7', { roughness: 0.9 }),
};

const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
};

const wheel = (r, w, x, y, z) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18), MAT.tyre);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

export function palletStack(rows = 2, cols = 2, layers = 2, size = 0.52) {
  const g = new THREE.Group();
  const pallet = box(cols * size + 0.1, 0.14, rows * size + 0.1, MAT.wood, 0, 0.07, 0);
  g.add(pallet);
  for (let l = 0; l < layers; l++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const b = box(size * 0.96, size * 0.9, size * 0.96, MAT.carton,
          (c - (cols - 1) / 2) * size, 0.14 + size * 0.45 + l * size * 0.9, (r - (rows - 1) / 2) * size);
        b.rotation.y = (Math.random() - 0.5) * 0.06;
        g.add(b);
      }
    }
  }
  return g;
}

export function createForklift() {
  const g = new THREE.Group();
  // chassis & counterweight
  g.add(box(1.5, 0.75, 1.1, MAT.yellow, -0.15, 0.62, 0));
  g.add(box(0.45, 0.95, 1.12, MAT.yellowDark, -1.0, 0.72, 0));
  g.add(box(0.4, 0.12, 1.15, MAT.black, 0.55, 0.3, 0));
  // overhead guard
  for (const [x, z] of [[-0.75, 0.5], [-0.75, -0.5], [0.42, 0.5], [0.42, -0.5]]) {
    g.add(box(0.07, 1.25, 0.07, MAT.black, x, 1.6, z));
  }
  g.add(box(1.3, 0.06, 1.1, MAT.black, -0.17, 2.24, 0));
  // seat + driver
  g.add(box(0.45, 0.35, 0.55, MAT.black, -0.45, 1.15, 0));
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.35, 4, 10), MAT.orange);
  torso.position.set(-0.4, 1.55, 0); torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), MAT.skin);
  head.position.set(-0.36, 1.98, 0); g.add(head);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.165, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.yellow);
  hat.position.set(-0.36, 2.0, 0); g.add(hat);
  g.add(box(0.06, 0.4, 0.06, MAT.black, 0.12, 1.25, 0.12)); // steering column
  // mast
  g.add(box(0.1, 2.5, 0.1, MAT.black, 0.78, 1.3, 0.38));
  g.add(box(0.1, 2.5, 0.1, MAT.black, 0.78, 1.3, -0.38));
  g.add(box(0.08, 0.08, 0.86, MAT.black, 0.78, 2.5, 0));
  // carriage (raised when carrying)
  const carriage = new THREE.Group();
  carriage.add(box(0.08, 0.9, 0.86, MAT.black, 0.88, 0.5, 0));
  carriage.add(box(1.15, 0.06, 0.12, MAT.steel, 1.48, 0.07, 0.3));
  carriage.add(box(1.15, 0.06, 0.12, MAT.steel, 1.48, 0.07, -0.3));
  const load = palletStack(2, 2, 2, 0.5);
  load.position.set(1.48, 0.1, 0);
  load.visible = false;
  carriage.add(load);
  g.add(carriage);
  // wheels
  g.add(wheel(0.3, 0.22, 0.42, 0.3, 0.56), wheel(0.3, 0.22, 0.42, 0.3, -0.56));
  g.add(wheel(0.24, 0.2, -0.82, 0.24, 0.56), wheel(0.24, 0.2, -0.82, 0.24, -0.56));
  // status beacon
  const beaconMat = new THREE.MeshStandardMaterial({ color: '#3ccf7a', emissive: '#3ccf7a', emissiveIntensity: 0.9 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), beaconMat);
  beacon.position.set(-0.75, 2.33, 0);
  g.add(beacon);
  g.userData = { carriage, load, beacon, height: 2.5 };
  return g;
}

let trailerTex;
export function createTruck() {
  trailerTex ||= trailerTexture();
  const g = new THREE.Group();
  const livery = new THREE.MeshStandardMaterial({ map: trailerTex, roughness: 0.45 });
  // trailer box: material order +x, -x, +y, -y, +z, -z
  const trailer = new THREE.Mesh(new THREE.BoxGeometry(10.6, 3.0, 2.55), [MAT.white, MAT.white, MAT.white, MAT.white, livery, livery]);
  trailer.position.set(-1.7, 2.65, 0);
  trailer.castShadow = true; trailer.receiveShadow = true;
  g.add(trailer);
  g.add(box(0.08, 2.9, 2.5, MAT.blueDark, -7.03, 2.65, 0)); // rear doors
  g.add(box(0.1, 0.12, 2.6, MAT.black, -7.0, 1.1, 0));
  g.add(box(10.4, 0.35, 1.1, MAT.black, -1.6, 0.98, 0)); // chassis
  // cab
  g.add(box(2.4, 2.55, 2.5, MAT.blue, 5.0, 1.95, 0));
  g.add(box(0.6, 0.9, 2.45, MAT.blue, 3.55, 3.0, 0)); // sleeper roof fairing
  const windshield = box(0.06, 1.0, 2.2, MAT.glass, 6.23, 2.55, 0);
  windshield.castShadow = false; g.add(windshield);
  g.add(box(0.9, 0.85, 0.05, MAT.glass, 5.55, 2.55, 1.255), box(0.9, 0.85, 0.05, MAT.glass, 5.55, 2.55, -1.255));
  g.add(box(0.12, 0.7, 2.0, MAT.steel, 6.24, 1.25, 0)); // grille
  g.add(box(0.25, 0.32, 2.55, MAT.black, 6.25, 0.65, 0)); // bumper
  for (const z of [1.0, -1.0]) {
    const lamp = box(0.05, 0.16, 0.34, MAT.white, 6.28, 1.0, z * 0.85);
    lamp.material = new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#ffe9a6', emissiveIntensity: 0.6 });
    g.add(lamp);
  }
  for (const x of [-5.9, -4.75, 2.6, 5.35]) {
    g.add(wheel(0.52, 0.42, x, 0.52, 1.05), wheel(0.52, 0.42, x, 0.52, -1.05));
  }
  g.userData = { height: 4.2 };
  return g;
}

export function createCharger(label) {
  const g = new THREE.Group();
  g.add(box(0.9, 1.5, 0.55, MAT.white, 0, 0.75, 0));
  g.add(box(0.95, 0.08, 0.6, MAT.concrete, 0, 1.53, 0));
  const screenMat = new THREE.MeshStandardMaterial({ color: '#3ccf7a', emissive: '#3ccf7a', emissiveIntensity: 0.7 });
  const screen = box(0.5, 0.28, 0.03, screenMat, 0, 1.12, 0.29);
  screen.castShadow = false; g.add(screen);
  g.add(box(0.08, 0.6, 0.08, MAT.black, 0.36, 0.7, 0.32));
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshBasicMaterial({ map: labelTexture(label, { bg: '#e8eefc', fg: '#1b3fae' }), transparent: true }));
  tag.position.set(0, 0.45, 0.285);
  g.add(tag);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 4.2), new THREE.MeshBasicMaterial({ map: glowTexture('rgba(60,207,122,0.55)'), transparent: true, depthWrite: false }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.03, 2.1);
  g.add(pad);
  g.userData = { screen: screenMat, pad };
  return g;
}

export function createTree(scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 8), MAT.trunk);
  trunk.position.y = 0.6; trunk.castShadow = true;
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1.3, 18, 14), MAT.leaf);
  crown.scale.set(1, 1.25, 1);
  crown.position.y = 2.3; crown.castShadow = true;
  g.add(trunk, crown);
  g.scale.setScalar(scale);
  return g;
}

export function createPin() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#2457e6', roughness: 0.35, emissive: '#1b3fae', emissiveIntensity: 0.25 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 18), mat);
  head.position.y = 1.35;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.66, 1.2, 24), mat);
  tip.rotation.x = Math.PI; tip.position.y = 0.55;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  dot.position.set(0, 1.4, 0.5);
  dot.scale.z = 0.4;
  g.add(head, tip, dot);
  g.userData = { dot };
  return g;
}

export function createSelectionRing() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.12, 48), new THREE.MeshBasicMaterial({ color: '#2457e6', transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1.0, 48), new THREE.MeshBasicMaterial({ color: '#2457e6', transparent: true, opacity: 0.12, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2;
  g.add(ring, fill);
  g.position.y = 0.04;
  g.renderOrder = 2;
  return g;
}
