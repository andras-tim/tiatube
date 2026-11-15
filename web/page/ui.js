// The window's building blocks: elements, choices, the steps of a run, the time estimate, the result.
import { st } from './state.js';

export const $ = (id) => document.getElementById(id);
export const pad = (n) => String(n).padStart(2, '0');
export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
export const hostOf = (url) => { try { return new URL(url).hostname; } catch (e) { return ''; } };
export const mmss = (d) => (d ? `${Math.floor(d / 60)}:${pad(Math.round(d) % 60)}` : '');
export const mbOf = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0);
export const setMeta = (parts) => { $('meta').textContent = parts.filter(Boolean).join(' · '); };
export const warn = (t) => {
  $('warn').textContent = t;
  $('warn').hidden = !t;
};

// ---- choices: cards and segmented buttons; the value is in the box's data-value ----
export const pick = (id, v) => {
  for (const b of $(id).children) b.classList.toggle('on', b.dataset.value === v);
  $(id).dataset.value = v;
};
export const val = (id) => $(id).dataset.value;
export const label = (id) => [...$(id).children].find((b) => b.dataset.value === val(id))?.dataset.label || '';
// opts: [value, label, tooltip]
export const segSet = (id, opts, value) => {
  $(id).replaceChildren(...opts.map(([v, t, tip]) => {
    const b = el('button', '', t);
    b.type = 'button';
    b.dataset.value = v;
    b.dataset.label = t;
    if (tip) b.title = tip;
    return b;
  }));
  pick(id, opts.some((o) => o[0] === value) ? value : opts[0][0]);
};
// opts: [value, icon, label, small]
export const cardSet = (id, opts, value) => {
  $(id).classList.toggle('three', opts.length === 3);
  $(id).replaceChildren(...opts.map(([v, icon, t, small]) => {
    const b = el('button', 'card');
    b.type = 'button';
    b.dataset.value = v;
    b.dataset.label = t;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS(svg.namespaceURI, 'use');
    use.setAttribute('href', `#${icon}`);
    svg.append(use);
    b.append(svg, t);
    if (small) b.append(el('small', '', small));
    return b;
  }));
  pick(id, opts.some((o) => o[0] === value) ? value : opts[0][0]);
};
export const show = (id, on) => { $(id).hidden = $(`${id}-label`).hidden = !on; };
export const what = () => val('what');

// ---- time estimate: rates over the last 15 s, so a slow start or an ad does not stick ----
const samples = { cap: [], up: [], srv: [] };
export const sample = (k, v) => {
  const now = Date.now() / 1000, a = samples[k];
  if (a.length && a.at(-1)[1] === v) return;
  a.push([now, v]);
  while (a.length > 2 && now - a[1][0] > 15) a.shift();
};
// seconds until the value reaches 'goal', or null while there are too few samples
const left = (k, goal) => {
  const a = samples[k];
  if (a.length < 2) return null;
  const [t0, v0] = a[0], [t1, v1] = a.at(-1);
  if (t1 - t0 < 3 || v1 <= v0) return null;
  return Math.max(0, ((goal - v1) * (t1 - t0)) / (v1 - v0));
};
const human = (s) => (s < 10 ? 'pár mp' : s < 60 ? `kb. ${Math.ceil(s / 5) * 5} mp`
  : s < 3600 ? `kb. ${Math.round(s / 60)} perc` : `kb. ${Math.floor(s / 3600)} óra ${Math.round((s % 3600) / 60)} perc`);
const estimate = () => {
  if (st.mode === 'list') return null;
  if (st.mode === 'post' || st.mode === 'web') return st.end ? null : left('cap', 1);
  if (st.finished) return left('srv', 100);
  if (!st.job) return null;
  const cap = st.end ? 0 : left('cap', 1);
  // all bytes the capture will produce, from what it produced so far
  const p = samples.cap.length ? samples.cap.at(-1)[1] : 0;
  const total = st.end ? st.gotBytes : p > 0.05 ? st.gotBytes / p : null;
  const up = total ? left('up', total) : null;
  return cap == null && !st.end ? null : Math.max(cap || 0, up || 0);
};

// ---- the steps of a run ----
export const STEP = (key, text) => ({ key, text, state: 'todo', t0: 0, t1: 0, sub: null, err: '' });
// a done step stays done; a step gets its start time when it starts running and its end time when it ends
export const step = (key, state, patch = {}) => {
  const s = st.steps.find((x) => x.key === key);
  if (!s) return;
  if (state && s.state !== state && s.state !== 'ok' && s.state !== 'err') {
    if (!s.t0) s.t0 = Date.now();
    if (state === 'ok' || state === 'err') {
      s.t1 = Date.now();
      s.sub = null;
    }
    s.state = state;
  }
  Object.assign(s, patch);
};
const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
};
// the rows are kept and updated in place: a rebuilt row would restart the spinner's animation
const rows = new Map();
export const render = () => {
  if (!st.mode) return;
  const ul = $('steps');
  st.steps.forEach((s, i) => {
    let r = rows.get(s.key);
    if (!r) {
      r = { li: el('li'), ico: el('span'), txt: el('span'), t: el('span', 't'), sub: el('div', 'sub') };
      r.li.append(r.ico, r.txt, r.t, r.sub);
      rows.set(s.key, r);
    }
    if (ul.children[i] !== r.li) ul.insertBefore(r.li, ul.children[i] || null);
    const cls = s.state === 'ok' ? '' : s.state, ico = `ico ${s.state === 'now' ? 'run' : s.state}`;
    if (r.li.className !== cls) r.li.className = cls;
    if (r.ico.className !== ico) {
      r.ico.className = ico;
      r.ico.textContent = s.state === 'ok' ? '✓' : s.state === 'err' ? '!' : '';
    }
    if (r.txt.textContent !== s.text) r.txt.textContent = s.text;
    r.t.textContent = s.t0 ? clock((s.t1 || Date.now()) - s.t0) : '';
    const parts = [];
    if (s.state === 'now' && s.sub) {
      if (typeof s.sub.pct === 'number') {
        const bar = el('div', 'bar'), fill = el('i');
        fill.style.width = `${Math.round(100 * Math.min(1, s.sub.pct))}%`;
        bar.append(fill);
        parts.push(bar);
      }
      if (s.sub.text) parts.push(el('span', 'status', s.sub.text));
    }
    if (s.state === 'err' && s.err) parts.push(el('span', 'status bad', s.err));
    r.sub.replaceChildren(...parts);
    r.sub.hidden = !parts.length;
  });
  const eta = st.done ? null : estimate();
  $('total').textContent = eta == null ? '' : `Összesen hátra: ${human(eta)}`;
};
setInterval(() => { if (st.mode && !st.done) render(); }, 1000);

// ---- after the start the form gives way to the steps ----
export const toRun = (meta) => {
  setMeta(meta);
  $('opts').hidden = true;
  $('steps').hidden = false;
};

export const result = (parts) => {
  $('result').replaceChildren(...parts);
  $('result').hidden = false;
};

// the download has started already: the result says so; the link is only a fallback for a download that did not start
export const downloaded = (name, href) => {
  const again = el('a', '', 'újra letöltés');
  again.href = href;
  again.download = name;
  const retry = el('span', 'retry', 'Ha nem jelent meg a letöltések között: ');
  retry.append(again);
  return [el('span', '', `Letöltve: ${name}. A Letöltések mappában találod.`), retry];
};

// starts the download of a URL, as a click on a link would
export const download = (href, name) => {
  const a = el('a');
  a.href = href;
  if (name) a.download = name;
  a.click();
};
