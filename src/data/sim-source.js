// Demo data source: runs the yard simulator in the page.
import { YardSimulation } from '../model/simulation.js';

export class SimulatedSource {
  constructor({ tickMs = 100 } = {}) {
    this.kind = 'demo';
    this.tickMs = tickMs;
    this.listeners = new Set();
    this.sim = new YardSimulation();
    this.timer = null;
  }

  onSnapshot(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  start() {
    if (this.timer) return;
    let last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      // Cap catch-up so a backgrounded tab doesn't fast-forward minutes at once.
      let dt = Math.min((now - last) / 1000, 1);
      last = now;
      while (dt > 0) { const s = Math.min(dt, 0.1); this.sim.step(s); dt -= s; }
      const snap = this.sim.snapshot();
      for (const cb of this.listeners) cb(snap);
    }, this.tickMs);
  }

  stop() { clearInterval(this.timer); this.timer = null; }
}
