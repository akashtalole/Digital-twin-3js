// Procedural canvas textures, so the twin ships with no image assets.
import * as THREE from 'three';

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export const BRAND = 'YardTwin';

export function corrugatedTexture() {
  const t = canvas(256, 64, (g, w, h) => {
    g.fillStyle = '#dfe4ee'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const grad = g.createLinearGradient(x, 0, x + 16, 0);
      grad.addColorStop(0, '#cdd4e1'); grad.addColorStop(0.45, '#eef1f7'); grad.addColorStop(1, '#d3d9e5');
      g.fillStyle = grad; g.fillRect(x, 0, 16, h);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function rollerDoorTexture() {
  return canvas(64, 128, (g, w, h) => {
    g.fillStyle = '#c9d2e3'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) {
      g.fillStyle = '#b3bed3'; g.fillRect(0, y, w, 1.5);
      g.fillStyle = '#dce3ef'; g.fillRect(0, y + 2, w, 1);
    }
  });
}

export function cartonTexture() {
  return canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#e2ac72'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,70,20,0.08)';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1);
    g.fillStyle = '#c98c52'; g.fillRect(w * 0.44, 0, w * 0.12, h);
    g.strokeStyle = 'rgba(110,62,20,0.35)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
  });
}

function drawLogo(g, x, y, s, color = '#2457e6') {
  g.save();
  g.translate(x, y);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(s * 0.5, 0); g.lineTo(s, s * 0.25); g.lineTo(s, s * 0.75); g.lineTo(s * 0.5, s); g.lineTo(0, s * 0.75); g.lineTo(0, s * 0.25);
  g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath(); g.moveTo(s * 0.5, 0); g.lineTo(s, s * 0.25); g.lineTo(s * 0.5, s * 0.5); g.lineTo(0, s * 0.25); g.closePath(); g.fill();
  g.restore();
}

export function trailerTexture() {
  return canvas(1024, 256, (g, w, h) => {
    g.fillStyle = '#fbfcfe'; g.fillRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, h * 0.72, 0, h);
    grad.addColorStop(0, '#2f63ea'); grad.addColorStop(1, '#1d46c4');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * 0.86); g.quadraticCurveTo(w * 0.55, h * 0.84, w, h * 0.62); g.lineTo(w, h); g.closePath(); g.fill();
    drawLogo(g, w * 0.36, h * 0.2, 86);
    g.fillStyle = '#1b2a4a';
    g.font = '700 74px "Plus Jakarta Sans", system-ui, sans-serif';
    g.fillText(BRAND, w * 0.36 + 104, h * 0.2 + 66);
    g.font = '500 24px "Plus Jakarta Sans", system-ui, sans-serif';
    g.fillStyle = '#5a6884';
    g.fillText('Cross-dock freight · live tracked', w * 0.36 + 106, h * 0.2 + 104);
  });
}

export function signTexture() {
  return canvas(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    drawLogo(g, 10, 20, 88);
    g.fillStyle = '#2b3a5c';
    g.font = '700 70px "Plus Jakarta Sans", system-ui, sans-serif';
    g.fillText(BRAND, 116, 88);
  });
}

export function labelTexture(text, { bg = '#1c2b52', fg = '#ffffff', w = 128, h = 64, font = 34 } = {}) {
  return canvas(w, h, (g) => {
    g.fillStyle = bg;
    roundRect(g, 4, 4, w - 8, h - 8, 10); g.fill();
    g.fillStyle = fg;
    g.font = `700 ${font}px "Plus Jakarta Sans", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

export function roadTexture() {
  const t = canvas(128, 512, (g, w, h) => {
    g.fillStyle = '#d4dae6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.fillRect(w / 2 - 3, 0, 6, h * 0.45);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(6, 0, 4, h); g.fillRect(w - 10, 0, 4, h);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function glowTexture(color = '#3ccf7a') {
  return canvas(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
