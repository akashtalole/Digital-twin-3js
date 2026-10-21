import { World } from './scene/world.js';
import { UI } from './ui/ui.js';
import { SimulatedSource } from './data/sim-source.js';
import { ThingsBoardSource } from './data/thingsboard.js';

const $ = (s) => document.querySelector(s);
const STORE_KEY = 'yardtwin.tb';

const store = {
  get() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const world = new World($('#scene'), {
  onSelect: (id) => ui.select(id),
  onHover: (id) => ui.hover(id),
});
const ui = new UI(world, { onSelect: () => {}, onOpenConnect: openConnect });

// Theme follows the viewer: OS preference unless the host sets data-theme.
const media = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => {
  const forced = document.documentElement.dataset.theme;
  world.setTheme(forced ? forced === 'dark' : media.matches);
};
media.addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
applyTheme();

let source = null;
let unsubscribe = null;

function use(next, smoothing) {
  unsubscribe?.();
  source?.stop();
  source = next;
  ui.setSource(next);
  unsubscribe = next.onSnapshot((snap) => { world.update(snap, { smoothing }); ui.render(snap); });
}

function startDemo() {
  const demo = new SimulatedSource();
  use(demo, 7);
  demo.start();
  ui.setLiveState('demo', 'Demo');
  ui.setUser('Demo mode', 'Simulated telemetry');
}

async function connectThingsBoard(cfg) {
  const tb = new ThingsBoardSource(cfg);
  tb.onStatus(({ state, detail }) => {
    if (source !== tb && state !== 'live') return;
    ui.setLiveState(state, state === 'live' ? 'Live' : state === 'error' ? 'Error' : detail || 'Connecting');
  });
  ui.setLiveState('connecting', 'Connecting');
  await tb.start(); // throws on failure; demo keeps running until then
  use(tb, 2.6);
  const snap = tb.snapshot();
  world.update(snap, { smoothing: 2.6 });
  ui.render(snap, true);
  ui.setLiveState('live', 'Live');
  const u = tb.user || {};
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || 'ThingsBoard user';
  ui.setUser(name, (u.authority || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) || 'ThingsBoard');
}

// ----------------------------------------------------------- connect dialog
const dialog = $('#connect');
function openConnect() {
  const saved = store.get();
  $('#tb-host').value ||= saved.host || '';
  $('#tb-user').value ||= saved.username || '';
  $('#connect-error').hidden = true;
  dialog.showModal();
}
$('#connect-cancel').onclick = () => dialog.close();
$('#use-demo').onclick = () => { dialog.close(); if (source?.kind !== 'demo') startDemo(); };
$('#connect-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const host = $('#tb-host').value.trim();
  const username = $('#tb-user').value.trim();
  const password = $('#tb-pass').value;
  const token = $('#tb-token').value.trim();
  const err = $('#connect-error');
  if (!token && !(username && password)) {
    err.textContent = 'Enter a username and password, or paste a JWT token.';
    err.hidden = false;
    return;
  }
  const btn = $('#connect-submit');
  btn.disabled = true; btn.textContent = 'Connecting…';
  try {
    await connectThingsBoard({ host, username, password, token });
    store.set({ host, username });
    $('#tb-pass').value = ''; $('#tb-token').value = '';
    dialog.close();
  } catch (e) {
    const net = e instanceof TypeError || /fetch|network/i.test(e.message);
    err.textContent = net
      ? `Couldn't reach ${host}. Check the URL, and that ThingsBoard allows cross-origin requests from this page (CORS).`
      : e.message;
    err.hidden = false;
    ui.setLiveState(source?.kind === 'demo' ? 'demo' : 'error', source?.kind === 'demo' ? 'Demo' : 'Error');
  } finally {
    btn.disabled = false; btn.textContent = 'Connect';
  }
});

startDemo();
// Open on a forklift like an operator would, except on phones where the card covers the yard.
if (window.innerWidth > 760) setTimeout(() => ui.select('FL-12'), 400);
