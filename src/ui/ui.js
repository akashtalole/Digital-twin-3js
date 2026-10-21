// HUD panels: KPIs, detail card, shipment tracker, fleet list, search, alerts, labels.
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const pct = (v) => `${Math.round(Number(v) || 0)}%`;

const ICONS = {
  forklift: '<svg viewBox="0 0 24 24"><path d="M4 18V9h5l3 5v4"/><path d="M4 9V5h4l1 4"/><path d="M16 4v14h5"/><circle cx="6.5" cy="18.5" r="1.8"/><circle cx="12" cy="18.5" r="1.8"/></svg>',
  truck: '<svg viewBox="0 0 24 24"><path d="M2 6h11v10H2zM13 9h4l3 3.5V16h-7z"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>',
  dock: '<svg viewBox="0 0 24 24"><path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-9h10v9M7 15h10M7 18h10"/></svg>',
  drone: '<svg viewBox="0 0 24 24"><rect x="9" y="10" width="6" height="4" rx="1.5"/><path d="M9 10 6 7M15 10l3-3M9 14l-3 3M15 14l3 3"/><path d="M3 6h6M15 6h6M3 18h6M15 18h6"/></svg>',
  charger: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="10" height="18" rx="2"/><path d="m11 7-3 5h4l-3 5M15 10h3v6a2 2 0 0 0 2 2"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  locate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  stages: [
    '<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M10 12h5M10 16h5"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M12 3 20 7v10l-8 4-8-4V7Z"/><path d="m4 7 8 4 8-4M12 11v10"/></svg>',
    '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="14" rx="2"/><path d="M9 6V4h6v2M4 11h16"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z"/><circle cx="6" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  ],
};

const PILL = {
  Unloading: 'ok', Loading: 'accent', Charging: 'warn', 'To charger': 'warn', Idle: '',
  'En route': 'accent', Arriving: 'accent', Waiting: 'bad', Sealing: '', Departing: '', 'Off site': '',
  Occupied: 'accent', Free: 'ok',
  Patrolling: 'accent', Scanning: 'ok', Inspecting: 'ok', 'In flight': 'accent', 'Taking off': 'accent',
  Returning: '', Landing: '', Docked: '',
};
const pill = (status) => `<span class="pill ${PILL[status] ?? ''}">${esc(status)}</span>`;
const batteryClass = (b) => (b < 20 ? 'bad' : b < 40 ? 'warn' : '');

export class UI {
  constructor(world, { onSelect, onOpenConnect }) {
    this.world = world;
    this.onSelectCb = onSelect;
    this.snapshot = null;
    this.selected = null;
    this.hovered = null;
    this.tab = 'forklift';
    this.source = null;
    this.lastRender = 0;
    this.pending = null;

    // Don't swap panel HTML while a press is in progress, or the click is lost.
    this.holding = false;
    document.addEventListener('pointerdown', (ev) => { if (ev.target.closest('.panel, .popover, .topbar')) this.holding = true; }, true);
    document.addEventListener('pointerup', () => setTimeout(() => { this.holding = false; }, 0), true);
    this.#bindTopbar(onOpenConnect);
    this.#bindFleet();
    this.#bindCamera();
    this.#startClock();
    world.frameHooks.push(() => this.#positionLabels());
  }

  setSource(source) { this.source = source; this.render(this.snapshot, true); }

  setLiveState(state, label) {
    const btn = $('#live-btn');
    btn.dataset.state = state;
    $('#live-label').textContent = label;
  }

  setUser(name, role) {
    $('#user-name').textContent = name;
    $('#user-role').textContent = role;
    $('#avatar').textContent = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || 'TB';
  }

  // -------------------------------------------------------------- lookups
  #all() {
    const s = this.snapshot;
    if (!s) return [];
    return [...s.forklifts, ...s.trucks, ...(s.drones || []), ...s.docks, ...s.chargers];
  }

  find(id) { return this.#all().find((e) => e.id === id) || null; }

  select(id, { focus = false } = {}) {
    this.selected = id;
    this.world.select(id);
    if (focus && id) this.world.focus(id, { distance: this.find(id)?.type === 'truck' ? 62 : 44 });
    this.render(this.snapshot, true);
  }

  hover(id) { this.hovered = id; }

  // --------------------------------------------------------------- render
  render(snap, force = false) {
    if (!snap) return;
    this.snapshot = snap;
    const now = performance.now();
    if (this.holding || (!force && now - this.lastRender < 250)) {
      clearTimeout(this.pending);
      this.pending = setTimeout(() => this.render(this.snapshot, true), 260);
      return;
    }
    this.lastRender = now;
    this.#renderTop(snap);
    this.#renderDetail();
    this.#renderShipment(snap);
    this.#renderFleet(snap);
    this.#renderAlerts(snap);
  }

  #renderTop(s) {
    const site = s.site;
    $('#site-code').textContent = site.code;
    $('#site-name').textContent = site.name;
    $('#site-meta').textContent = `${site.utilisation}% full · ${site.docksOccupied}/${site.docksTotal} docked`;
    $('#fleet-site').textContent = site.name;
    $('#kpi-stock').textContent = site.stockOnHand.toLocaleString();
    setDelta('#kpi-stock-d', site.stockDelta, '');
    $('#kpi-stock-sub').textContent = `pallets · ${site.code}`;
    $('#kpi-trucks').textContent = site.trucksOnSite;
    setDelta('#kpi-trucks-d', site.trucksInbound, '', true);
    $('#kpi-trucks-sub').textContent = `${site.trucksInbound} inbound · ${site.code}`;
    $('#kpi-otd').textContent = `${Number(site.onTimeDelivery).toFixed(1)}%`;
    setDelta('#kpi-otd-d', site.onTimeDelta, '%');
    $('#kpi-otd-sub').textContent = `last 30 days · ${site.code}`;
  }

  #renderDetail() {
    const el = $('#detail');
    const e = this.selected && this.find(this.selected);
    if (!e) { el.hidden = true; return; }
    el.hidden = false;
    const site = this.snapshot.site.code;
    const tbUrl = this.source?.deviceUrl?.(e.tbId);
    let eyebrow; let sub; let status = e.status; let task = e.task; let meter = ''; let rows = [];
    if (e.type === 'forklift') {
      eyebrow = `Forklift · ${site}`;
      sub = `${e.operator || '—'} · ${e.model || ''}`;
      const b = Number(e.battery) || 0;
      meter = `<div class="meter"><div class="bar"><i class="${batteryClass(b)}" style="width:${b}%"></i></div><span class="num">Battery ${pct(b)}</span></div>`;
      rows = [
        ['Carrying', e.load || (e.carrying ? 'Pallet' : 'Empty')],
        ['Moves today', e.movesToday],
        ['Speed', `${Number(e.speed || 0).toFixed(1)} km/h`],
        e.truck ? ['Assigned truck', link(e.truck)] : ['Charger', e.charger ? link(e.charger) : '—'],
        ['Site', this.snapshot.site.name],
      ];
    } else if (e.type === 'truck') {
      eyebrow = `Truck · ${e.dir === 'outbound' ? 'Outbound' : 'Inbound'}`;
      sub = e.carrier || '';
      const p = e.pallets ? (e.moved / e.pallets) * 100 : 0;
      meter = `<div class="meter"><div class="bar"><i class="accent" style="width:${p}%"></i></div><span class="num">${e.moved}/${e.pallets} pallets</span></div>`;
      const sh = e.shipment || {};
      rows = [
        ['Shipment', sh.id ? `#${sh.id}` : '—'],
        [e.dir === 'outbound' ? 'Destination' : 'Origin', e.dir === 'outbound' ? sh.to : sh.from],
        ['Dock', e.dock ? link(dockIdFor(this.snapshot, e.dock), e.dock) : '—'],
        ['Forklifts', e.forklifts ?? 0],
        [e.eta ? 'Arrives' : 'Done by', e.eta ? hhmm(e.eta) : e.doneAt ? hhmm(e.doneAt) : '—'],
        ['Speed', `${Number(e.speed || 0).toFixed(1)} km/h`],
      ];
    } else if (e.type === 'dock') {
      eyebrow = `Dock ${e.id} · ${e.kind === 'outbound' ? 'Outbound' : 'Inbound'}`;
      sub = this.snapshot.site.name;
      status = e.truck ? 'Occupied' : 'Free';
      task = e.truck ? `${e.truck} at door` : 'Ready for next truck';
      meter = `<div class="meter"><div class="bar"><i class="accent" style="width:${(Number(e.doorOpen) || 0) * 100}%"></i></div><span class="num">Door ${Number(e.doorOpen) > 0.95 ? 'open' : Number(e.doorOpen) < 0.05 ? 'closed' : 'moving'}</span></div>`;
      rows = [['Truck', e.truck ? link(e.truck) : '—'], ['Forklifts working', e.forklifts ?? 0], ['Direction', e.kind]];
    } else if (e.type === 'drone') {
      eyebrow = `Drone · ${site}`;
      sub = `${e.model || 'Inspection drone'} · pad ${e.pad || '—'}`;
      const b = Number(e.battery) || 0;
      meter = `<div class="meter"><div class="bar"><i class="${batteryClass(b)}" style="width:${b}%"></i></div><span class="num">Battery ${pct(b)}</span></div>`;
      rows = [
        ['Mission', e.mission || 'None'],
        ['Altitude', `${Number(e.altitude || 0).toFixed(1)} m`],
        ['Speed', `${Number(e.speed || 0).toFixed(1)} km/h`],
        e.target ? ['Inspecting', link(e.target)] : ['Home pad', e.pad || '—'],
        ['Scans today', e.scansToday ?? 0],
      ];
    } else {
      eyebrow = `Charger · ${site}`;
      sub = 'Forklift charging bay';
      status = e.busy ? 'Charging' : 'Free';
      task = e.busy ? `${e.forklift} connected` : 'Available';
      rows = [['Forklift', e.forklift ? link(e.forklift) : '—']];
    }
    const name = e.type === 'dock' ? e.name : e.id;
    morph(el, `
      <div class="detail-head">
        <span class="detail-icon">${ICONS[e.type]}</span>
        <div><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(name)}</h2><div class="sub">${esc(sub)}</div></div>
        <div class="detail-actions">
          <button type="button" data-act="follow" aria-pressed="${this.world.follow}" title="Follow in 3D">${ICONS.locate}</button>
          <a ${tbUrl ? `href="${esc(tbUrl)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'} title="${tbUrl ? 'Open device in ThingsBoard' : 'Available when connected to ThingsBoard'}">${ICONS.open}</a>
          <button type="button" data-act="close" title="Close">${ICONS.close}</button>
        </div>
      </div>
      <div class="status-line">${pill(status)}<span>${esc(task)}</span></div>
      ${meter}
      <dl class="rows">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v && String(v).startsWith('<button') ? v : esc(v ?? '—')}</dd></div>`).join('')}</dl>`);
    el.querySelector('[data-act="close"]').onclick = () => { this.select(null); this.onSelectCb(null); };
    el.querySelector('[data-act="follow"]').onclick = () => {
      this.world.follow = !this.world.follow;
      if (this.world.follow) this.world.focus(e.id, { distance: 44 });
      this.render(this.snapshot, true);
    };
    el.querySelectorAll('[data-goto]').forEach((b) => { b.onclick = () => this.select(b.dataset.goto, { focus: true }); });
  }

  #renderShipment(s) {
    const el = $('#shipment');
    const sel = this.selected && this.find(this.selected);
    let truck = sel?.type === 'truck' ? sel : null;
    if (!truck && sel?.type === 'forklift' && sel.truck) truck = s.trucks.find((t) => t.id === sel.truck);
    if (!truck && sel?.type === 'drone' && sel.target) truck = s.trucks.find((t) => t.id === sel.target);
    if (!truck && sel?.type === 'dock' && sel.truck) truck = s.trucks.find((t) => t.id === sel.truck);
    truck ||= s.trucks.find((t) => t.phase === 'unloading' || t.status === 'Unloading')
      || s.trucks.find((t) => t.onSite) || s.trucks.find((t) => t.status === 'En route');
    const sh = truck?.shipment;
    if (!sh) { morph(el, '<div class="ship-empty">No shipments in progress.</div>'); return; }
    const cur = Number(sh.current);
    const steps = sh.stages.map((st, i) => {
      const state = i < cur ? 'done' : i === cur ? 'current' : '';
      let label = st.label;
      let when = st.ts ? hhmm(st.ts) : '—';
      if (i === cur && (truck.status === 'Unloading' || truck.status === 'Loading')) {
        label = `${st.label} ${truck.moved}/${truck.pallets}`;
        when = truck.doneAt ? `ETA ${hhmm(truck.doneAt)}` : when;
      } else if (i === cur && truck.eta) {
        when = `ETA ${hhmm(truck.eta)}`;
      }
      return `<div class="step ${state}"><span class="node">${ICONS.stages[i] || ICONS.stages[4]}</span><b>${esc(label)}</b><small class="num">${esc(when)}</small></div>`;
    }).join('');
    const left = truck.doneAt ? Math.max(1, Math.round((truck.doneAt - Date.now()) / 60000)) : null;
    const meta = [s.site.code, truck.dock, left ? `${left} min left` : truck.eta ? `arrives ${hhmm(truck.eta)}` : null].filter(Boolean).join(' · ');
    morph(el, `
      <div>
        <div class="ship-head">${ICONS.truck}<h3>Shipment tracking</h3><small>${esc(truck.id)} · ${esc(truck.carrier || '')}</small></div>
        <div class="steps">${steps}</div>
      </div>
      <button type="button" class="ship-card" data-goto="${esc(truck.id)}">
        <svg class="truck-ico" viewBox="0 0 24 24">${ICONS.truck.replace(/<\/?svg[^>]*>/g, '')}</svg>
        <div><b>#${esc(sh.id)}</b><small>${sh.dir === 'outbound' ? 'To' : 'From'}: ${esc(sh.dir === 'outbound' ? sh.to : sh.from)}</small>${pill(truck.status)}<small>${esc(meta)}</small></div>
        ${ICONS.chev}
      </button>`);
    el.querySelector('[data-goto]').onclick = () => this.select(truck.id, { focus: true });
  }

  #renderFleet(s) {
    const working = s.forklifts.filter((f) => f.status === 'Unloading' || f.status === 'Loading').length;
    $('#tab-dock').textContent = `${s.docks.filter((d) => d.truck).length}/${s.docks.length}`;
    $('#tab-forklift').textContent = `${working}/${s.forklifts.length}`;
    $('#tab-truck').textContent = s.trucks.filter((t) => t.onSite).length;
    const drones = s.drones || [];
    $('#tab-drone').textContent = `${drones.filter((d) => d.airborne).length}/${drones.length}`;
    let rows = '';
    if (this.tab === 'forklift') {
      rows = s.forklifts.map((f) => row(f.id, f.id, s.site.code, f.task, f.status,
        `<span class="num">${pct(f.battery)}</span><div class="bar"><i class="${batteryClass(f.battery)}" style="width:${f.battery}%"></i></div>`, this.selected)).join('');
    } else if (this.tab === 'truck') {
      const order = { Unloading: 0, Loading: 0, Arriving: 1, Sealing: 1, Departing: 2, Waiting: 3, 'En route': 4, 'Off site': 5 };
      rows = s.trucks.filter((t) => t.status !== 'Off site').sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
        .map((t) => row(t.id, t.id, t.dir === 'outbound' ? 'Outbound' : 'Inbound', t.task, t.status,
          `<span class="num">${t.moved}/${t.pallets}</span><div class="bar"><i class="accent" style="width:${t.pallets ? (t.moved / t.pallets) * 100 : 0}%"></i></div>`, this.selected)).join('');
    } else if (this.tab === 'drone') {
      rows = drones.map((d) => row(d.id, d.id, d.airborne ? `${Math.round(d.altitude)} m` : `Pad ${d.pad}`, d.task, d.status,
        `<span class="num">${pct(d.battery)}</span><div class="bar"><i class="${batteryClass(d.battery)}" style="width:${d.battery}%"></i></div>`, this.selected)).join('');
    } else {
      rows = s.docks.map((d) => row(d.id, d.name, d.id, d.truck ? `${d.truck} · ${d.forklifts} forklift${d.forklifts === 1 ? '' : 's'}` : 'Ready for next truck',
        d.truck ? 'Occupied' : 'Free', `<span>Door ${Math.round(d.doorOpen * 100)}%</span><div class="bar"><i class="accent" style="width:${d.doorOpen * 100}%"></i></div>`, this.selected)).join('');
    }
    morph($('#fleet-list'), rows || '<div class="ship-empty">Nothing to show.</div>');
  }

  #renderAlerts(s) {
    const alerts = [];
    for (const f of s.forklifts) {
      if (f.battery < 25 && f.status !== 'Charging' && f.status !== 'To charger') alerts.push({ id: f.id, bad: true, text: `${f.id} battery at ${pct(f.battery)}`, sub: f.task });
    }
    for (const d of s.drones || []) {
      if (d.airborne && d.battery < 25) alerts.push({ id: d.id, bad: true, text: `${d.id} returning on low battery (${pct(d.battery)})`, sub: d.task });
    }
    for (const t of s.trucks) if (t.status === 'Waiting') alerts.push({ id: t.id, text: `${t.id} is waiting for a dock`, sub: `${t.dir} · ${t.carrier || ''}` });
    if (s.site.utilisation >= 90) alerts.push({ id: null, text: `${s.site.code} is ${s.site.utilisation}% full`, sub: 'Consider holding inbound trucks' });
    this.alerts = alerts;
    const count = $('#bell-count');
    count.hidden = !alerts.length;
    count.textContent = alerts.length;
    const pop = $('#alerts');
    if (!pop.hidden) this.#fillAlerts();
  }

  #fillAlerts() {
    const pop = $('#alerts');
    pop.innerHTML = this.alerts?.length
      ? this.alerts.map((a) => `<button type="button" class="alert ${a.bad ? 'bad' : ''}" data-goto="${esc(a.id || '')}"><span><b>${esc(a.text)}</b><small>${esc(a.sub)}</small></span></button>`).join('')
      : '<div class="empty">No active alerts. Everything is running normally.</div>';
    pop.querySelectorAll('[data-goto]').forEach((b) => { b.onclick = () => { pop.hidden = true; if (b.dataset.goto) this.select(b.dataset.goto, { focus: true }); }; });
  }

  // ---------------------------------------------------------------- labels
  #positionLabels() {
    const layer = $('#labels');
    const want = [];
    if (this.selected) want.push([this.selected, 'sel']);
    if (this.hovered && this.hovered !== this.selected) want.push([this.hovered, 'hover']);
    const html = [];
    for (const [id, kind] of want) {
      const e = this.find(id);
      const p = e && this.world.screenPosition(id);
      if (!p) continue;
      const status = e.type === 'dock' ? (e.truck ? 'Occupied' : 'Free') : e.type === 'charger' ? (e.busy ? 'Charging' : 'Free') : e.status;
      const name = e.type === 'dock' ? `${e.id} · ${e.name}` : e.id;
      html.push(`<div class="tag ${kind === 'hover' ? 'hover' : ''}" style="left:${p.x}px;top:${p.y}px">${esc(name)}<em>${esc(status)}</em></div>`);
    }
    const out = html.join('');
    if (out !== this.lastLabels) { morph(layer, out); this.lastLabels = out; }
  }

  // ---------------------------------------------------------------- events
  #bindFleet() {
    document.querySelectorAll('[data-tab]').forEach((b) => {
      b.onclick = () => {
        this.tab = b.dataset.tab;
        document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        this.render(this.snapshot, true);
      };
    });
    $('#fleet-list').addEventListener('click', (ev) => {
      const r = ev.target.closest('[data-goto]');
      if (r) this.select(r.dataset.goto, { focus: true });
    });
  }

  #bindCamera() {
    const acts = {
      in: () => this.world.zoom(0.72), out: () => this.world.zoom(1.38),
      left: () => this.world.rotate(-Math.PI / 6), right: () => this.world.rotate(Math.PI / 6), home: () => this.world.home(),
    };
    document.querySelectorAll('[data-cam]').forEach((b) => { b.onclick = () => acts[b.dataset.cam](); });
    $('#site-btn').onclick = () => { this.select(null); this.world.home(); };
  }

  #bindTopbar(onOpenConnect) {
    $('#live-btn').onclick = onOpenConnect;
    const bell = $('#bell-btn');
    const pop = $('#alerts');
    bell.onclick = (ev) => { ev.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) this.#fillAlerts(); };
    document.addEventListener('click', (ev) => {
      if (!pop.hidden && !pop.contains(ev.target)) pop.hidden = true;
      if (!ev.target.closest('.search')) $('#search-results').hidden = true;
    });

    const input = $('#search');
    const results = $('#search-results');
    let matches = [];
    const run = () => {
      const q = input.value.trim().toLowerCase();
      if (!q || !this.snapshot) { results.hidden = true; return; }
      const items = this.#all().map((e) => ({
        id: e.id, kind: e.type, title: e.type === 'dock' ? `${e.name} (${e.id})` : e.id,
        sub: e.type === 'truck' ? `#${e.shipment?.id || ''} · ${e.status}` : e.type === 'forklift' ? `${e.operator} · ${e.status}` : e.type === 'drone' ? `${e.mission || 'On pad'} · ${e.status}` : e.task || '',
        hay: [e.id, e.name, e.operator, e.carrier, e.task, e.mission, e.model, e.shipment?.id, e.shipment?.from, e.shipment?.to].join(' ').toLowerCase(),
      }));
      matches = items.filter((i) => i.hay.includes(q)).slice(0, 8);
      results.innerHTML = matches.length
        ? matches.map((m, i) => `<button type="button" role="option" data-i="${i}" aria-selected="${i === 0}"><span class="kind">${m.kind}</span><span><b>${esc(m.title)}</b><br><small>${esc(m.sub)}</small></span></button>`).join('')
        : `<div class="empty">No matches for “${esc(q)}”.</div>`;
      results.hidden = false;
    };
    const choose = (m) => { if (!m) return; input.value = ''; results.hidden = true; input.blur(); this.select(m.id, { focus: true }); };
    input.addEventListener('input', run);
    input.addEventListener('focus', run);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') choose(matches[0]);
      if (ev.key === 'Escape') { input.value = ''; results.hidden = true; input.blur(); }
    });
    results.addEventListener('click', (ev) => { const b = ev.target.closest('[data-i]'); if (b) choose(matches[Number(b.dataset.i)]); });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === '/' && document.activeElement !== input && !ev.target.closest('input, dialog')) { ev.preventDefault(); input.focus(); }
      if (ev.key === 'Escape' && this.selected && document.activeElement !== input) { this.select(null); this.onSelectCb(null); }
    });
  }

  #startClock() {
    const tick = () => { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); };
    tick();
    setInterval(tick, 5000);
  }
}


// Update `el` to match `html` in place, keeping existing nodes (and their
// focus, hover and pending clicks) wherever the structure is unchanged.
function morph(el, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  morphChildren(el, tpl.content);
}
function morphChildren(from, to) {
  const a = [...from.childNodes];
  const b = [...to.childNodes];
  for (let i = 0; i < b.length; i++) {
    const x = a[i]; const y = b[i];
    if (!x) { from.appendChild(y); continue; }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || (x.dataset?.goto ?? null) !== (y.dataset?.goto ?? null)) { from.replaceChild(y, x); continue; }
    if (x.nodeType === 3) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
    if (x.nodeType !== 1) continue;
    for (const { name, value } of [...y.attributes]) if (x.getAttribute(name) !== value) x.setAttribute(name, value);
    for (const { name } of [...x.attributes]) if (!y.hasAttribute(name)) x.removeAttribute(name);
    morphChildren(x, y);
  }
  for (let i = a.length - 1; i >= b.length; i--) a[i].remove();
}

function row(id, title, sub, task, status, mini, selected) {
  return `<button type="button" class="fleet-row" data-goto="${esc(id)}" aria-current="${selected === id}">
    <span><b>${esc(title)}</b><small>${esc(sub)}</small></span>
    <span class="task" title="${esc(task)}">${esc(task)}</span>
    ${pill(status)}
    <span class="mini">${mini}</span>
    ${ICONS.chev}
  </button>`;
}

function link(id, text = id) { return `<button type="button" data-goto="${esc(id)}">${esc(text)}</button>`; }
function dockIdFor(s, label) { return s.docks.find((d) => d.name === label)?.id || label; }

function setDelta(sel, v, unit, plusOnly = false) {
  const el = $(sel);
  const n = Number(v) || 0;
  if (!n && !plusOnly) { el.textContent = ''; return; }
  el.className = `delta ${n < 0 ? 'down' : ''}`;
  el.textContent = `${n < 0 ? '↓' : '↑'} ${n > 0 ? '+' : ''}${Number.isInteger(n) ? n : n.toFixed(1)}${unit}`;
}
