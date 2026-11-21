// Videos captured on their page and built by the server. One job: the window creates it, the page captures, the
// window uploads, the server builds, the window takes the file. One video downloads by itself; several items of a
// playlist go one after the other into a ZIP made here (a window may start only one automatic download).
import { MSG } from '../../shared/protocol.js';
import { page, st } from '../state.js';
import { $, STEP, download, downloaded, el, label, render, result, sample, step, toRun, val, warn, what } from '../ui.js';
import { PREFIX, baseName, safeName, stamp } from '../names.js';
import { PARTS } from '../parts.js';
import { fail, saved } from '../run.js';
import { openSink, sinkError } from '../sink.js';
import { Zip } from '../zip.js';

const ENCODE = { mp3: 'MP3 kódolás, metaadatok', orig: 'Mentés újrakódolás nélkül, metaadatok',
  mp4: 'Összefűzés MP4-be, metaadatok', mkv: 'Összefűzés MKV-be, metaadatok' };
const BUILD = { assemble: 'fragmentek összerakása', cover: 'borítókép' };
// the server's errors in the user's words
const ERRORS = { 'no audio': 'nincs hang', 'no video': 'nincs kép', 'job too large': 'túl nagy a videó a szervernek',
  'server storage full': 'a szerver most tele van, próbáld később', 'fragment too large': 'túl nagy darab a feltöltésben' };
const say = (e) => ERRORS[e] || e;
const ZIP_TYPE = { description: 'ZIP', accept: { 'application/zip': ['.zip'] } };

// ---- one job ----

// the job in progress: its uploads, the page's end message, and how it reports
let cur = null;

// item: { videoId, title, author, url, thumbs, duration, ts }; view(stage, state, sub) shows the progress
const runJob = (item, opts, name, view) => new Promise((resolve, reject) => {
  cur = { item, view, resolve, reject, queue: [], active: 0, sentBytes: 0, end: null, finished: false };
  st.end = null;
  st.finished = false;
  view('connect', 'now');
  fetch('api/job', { method: 'POST', body: JSON.stringify({ videoId: item.videoId, title: item.title,
    author: item.author || '', url: item.url, thumbs: item.thumbs, duration: item.duration,
    date: stamp(item.ts, 'date'), name, what: opts.what, format: opts.format }) })
    .then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(say(j.error));
      st.job = j.job;
      st.maxFrag = j.maxFrag;
      page.send({ type: MSG.START, opts: { ...opts, videoId: item.videoId, duration: item.duration } });
      pump();
    })
    .catch((e) => reject(new Error(e.message.startsWith('Failed') ? 'a szerver nem érhető el' : e.message)));
});

// a fragment from the page
export const frag = (m) => {
  if (!cur) return;
  st.got++;
  st.gotBytes += m.buf.byteLength;
  cur.queue.push(m);
  cur.view('upload', 'now');
  pump();
};

export const progress = (m) => {
  if (!cur) return;
  cur.view('connect', 'ok');
  cur.view('capture', 'now', { pct: m.pct, text: m.text });
};

export const end = (m) => {
  if (!cur) return;
  cur.end = m;
  cur.view('connect', 'ok');
  cur.view('capture', 'ok');
  maybeFinish();
};

const upload = async (m) => {
  if (st.maxFrag && m.buf.byteLength > st.maxFrag) throw new Error(say('fragment too large'));
  const q = new URLSearchParams({ job: st.job, track: m.track, kind: m.kind, key: m.key, mime: m.mime || '',
    scale: m.scale || 1000, ms: m.ms ?? 0, ts: m.ts ?? 0 });
  let last = '';
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`api/frag?${q}`, { method: 'POST', body: m.buf });
      if (r.ok) return;
      last = (await r.json()).error;
      // a full server or a too large job does not get better by trying again
      if (r.status === 413 || r.status === 507 || r.status === 404) break;
    } catch (e) { last = e.message; }
    await new Promise((res) => setTimeout(res, 500 * (i + 1)));
  }
  throw new Error(say(last));
};

const pump = () => {
  const c = cur;
  while (c && st.job && !st.cancelled && c.active < 3 && c.queue.length) {
    const m = c.queue.shift();
    c.active++;
    upload(m).then(() => {
      c.active--;
      c.sentBytes += m.buf.byteLength;
      st.sentBytes += m.buf.byteLength;
      sample('up', st.sentBytes);
      c.view('upload', 'now', { text: `${(c.sentBytes / 1048576).toFixed(1)} MB${c.end ? '' : ' · lépést tart'}` });
      page.send({ type: MSG.ACK, bytes: m.buf.byteLength });
      render();
      pump();
      maybeFinish();
    }, (e) => {
      c.active--;
      c.reject(e);
    });
  }
};

const maybeFinish = async () => {
  const c = cur;
  if (!c || !c.end || c.finished || st.cancelled || c.active || c.queue.length) return;
  c.finished = st.finished = true;
  st.end = c.end;
  c.view('upload', 'ok');
  c.view('build', 'now');
  render();
  await fetch(`api/finish?job=${st.job}`, { method: 'POST', body: JSON.stringify({ ms: c.end.ms }) });
  poll(c);
};

const poll = async (c) => {
  if (st.cancelled) return;
  let s;
  try {
    s = await (await fetch(`api/status?job=${st.job}`)).json();
  } catch (e) {
    setTimeout(() => poll(c), 2000);
    return;
  }
  st.alive = Date.now();
  if (s.state === 'error' || s.error) {
    c.reject(new Error(say(s.error || 'ismeretlen hiba')));
    return;
  }
  if (s.state === 'queued') {
    c.view('build', 'ok');
    c.view('encode', 'now', { text: `Sorban: ${s.queue}. (a szerver egyszerre egyet kódol)` });
  } else if (s.step === 'encode') {
    sample('srv', s.pct || 0);
    c.view('build', 'ok');
    c.view('encode', 'now', { pct: (s.pct || 0) / 100, text: `${s.pct || 0}%` });
  } else if (s.state === 'building') {
    c.view('build', 'now', { text: BUILD[s.step] || '' });
  }
  if (s.state !== 'done') {
    render();
    setTimeout(() => poll(c), 1000);
    return;
  }
  c.view('build', 'ok');
  c.view('encode', 'ok');
  const [kind, name] = Object.entries(s.files || {})[0] || [];
  cur = null;
  c.resolve({ job: st.job, kind, name, complete: s.complete, audio: s.audio, video: s.video,
    href: `api/file?job=${st.job}&f=${kind}` });
};

// ---- the flows ----

const optsOf = () => ({ what: what(), format: val('format'), quality: val('quality') });

// one video: the page's, or one item of its playlist
const startOne = async (item) => {
  const opts = optsOf(), dfmt = val('dfmt'), part = PARTS[st.site];
  st.mode = opts.what;
  st.opts = opts;
  st.steps = [STEP('connect', part.connect), STEP('capture', part.capture(opts.what)),
    STEP('upload', 'Feltöltés a szerverre'), STEP('build', 'Összerakás, borítókép'), STEP('encode', ENCODE[opts.format]),
    STEP('dl', 'Letöltés')];
  toRun([label('what'), label('format'), opts.what === 'video' && label('quality'), PREFIX[dfmt]]);
  $('run-actions').hidden = false;
  render();
  let r;
  try {
    r = await runJob(item, opts, baseName(stamp(item.ts, dfmt), item.title, item.videoId),
      (key, state, sub) => step(key, state, sub ? { sub } : {}));
  } catch (e) {
    fail(e);
    return;
  }
  // the download starts by itself, like the ZIP's
  if (r.name) download(r.href);
  step('dl', 'ok');
  st.done = true;
  $('run-actions').hidden = true;
  render();
  result([el('span', r.complete ? 'ok' : 'bad', r.complete ? 'Kész, teljes.'
    : `Kész, de HIÁNYOS: ${JSON.stringify({ hang: r.audio, kép: r.video })}`), ...(r.name ? downloaded(r.name, r.href) : [])]);
};

const STAGE = { connect: 'indítás', capture: 'rögzítés', upload: 'feltöltés', build: 'összerakás', encode: 'kódolás' };

// several items of a playlist, one after the other, into a ZIP
const startList = async (items) => {
  const opts = optsOf(), info = st.info, pl = info.playlist, dfmt = val('dfmt');
  let sink;
  try {
    sink = await openSink(`${baseName(stamp(Date.now() / 1000, dfmt === 'none' ? 'none' : 'date'), pl.title, pl.id)}.zip`,
      ZIP_TYPE);
  } catch (e) {
    warn(sinkError(e));
    return;
  }
  warn('');
  st.mode = 'list';
  st.opts = opts;
  st.zip = new Zip(sink);
  const n = items.length, width = Math.max(2, String(n).length), failed = [];
  st.steps = [STEP('items', `Videók (0 / ${n})`), STEP('close', sink.kind === 'file' ? 'ZIP lezárása' : 'ZIP lezárása, letöltés')];
  toRun([`${n} videó`, label('what'), label('format'), opts.what === 'video' && label('quality')]);
  $('run-actions').hidden = false;
  step('items', 'now');
  render();
  let done = 0, bytes = 0;
  for (let i = 0; i < n && !st.cancelled; i++) {
    const it = items[i], nn = String(pl.items.indexOf(it) + 1).padStart(width, '0');
    const head = `${i + 1} / ${n}: ${it.title}`;
    try {
      const r = await runJob({ videoId: it.id, title: it.title, url: `https://www.youtube.com/watch?v=${it.id}`,
        thumbs: it.thumbs, duration: it.dur, ts: it.id === info.videoId ? info.ts : 0 }, opts,
      safeName(`${nn} ${it.title} [${it.id}]`), (key, state, sub) => {
        if (state === 'now') step('items', 'now', { sub: { pct: sub?.pct, text: `${head} · ${STAGE[key]}${sub?.text ? ` ${sub.text}` : ''}` } });
      });
      const data = new Uint8Array(await (await fetch(r.href)).arrayBuffer());
      await st.zip.add(r.name, data, Date.now() / 1000);
      bytes += data.length;
      done++;
      // the server does not need to keep it any more
      fetch(`api/cancel?job=${r.job}`, { method: 'POST' });
      if (!r.complete) failed.push(`${it.title} (hiányos)`);
    } catch (e) {
      if (st.cancelled) return;
      failed.push(`${it.title}: ${e.message}`);
    }
    st.job = null;
    step('items', 'now', { text: `Videók (${i + 1} / ${n}${failed.length ? `, gond: ${failed.length}` : ''})` });
  }
  if (st.cancelled) return;
  if (!done) {
    fail(new Error('egy videó sem készült el'));
    return;
  }
  step('items', 'ok');
  step('close', 'now');
  render();
  const blob = await st.zip.close();
  const out = [el('span', failed.length ? 'bad' : 'ok', failed.length ? `Kész, de nem teljes: ${failed.join('; ')}`
    : `Kész, teljes: ${done} fájl, ${(bytes / 1048576).toFixed(1)} MB.`), ...await saved(sink, blob)];
  step('close', 'ok');
  st.done = true;
  $('run-actions').hidden = true;
  render();
  result(out);
};

// the chosen items: the page's video alone runs as before
export const start = (items) => {
  const info = st.info;
  if (!items || items.length < 2) {
    const it = items?.[0];
    return startOne(!it || it.id === info.videoId ? info : { videoId: it.id, title: it.title,
      url: `https://www.youtube.com/watch?v=${it.id}`, thumbs: it.thumbs, duration: it.dur, ts: 0 });
  }
  return startList(items);
};
