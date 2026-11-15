// A video captured on its page and built by the server: the window uploads what the page sends, then waits for the
// server, then downloads the result.
import { MSG } from '../../shared/protocol.js';
import { page, st } from '../state.js';
import { $, STEP, download, downloaded, el, label, render, result, sample, step, toRun, val, what } from '../ui.js';
import { PREFIX, baseName, stamp } from '../names.js';
import { PARTS } from '../parts.js';
import { fail } from '../run.js';

const ENCODE = { mp3: 'MP3 kódolás, metaadatok', orig: 'Mentés újrakódolás nélkül, metaadatok',
  mp4: 'Összefűzés MP4-be, metaadatok', mkv: 'Összefűzés MKV-be, metaadatok' };
// the server's errors in the user's words
const ERRORS = { 'no audio': 'nincs hang', 'no video': 'nincs kép', 'job too large': 'túl nagy a videó a szervernek',
  'server storage full': 'a szerver most tele van, próbáld később', 'fragment too large': 'túl nagy darab a feltöltésben' };
const say = (e) => ERRORS[e] || e;

export const start = async () => {
  const info = st.info, w = what(), dfmt = val('dfmt'), part = PARTS[st.site];
  const opts = { what: w, format: val('format'), quality: val('quality') };
  st.mode = w;
  st.opts = opts;
  st.steps = [STEP('connect', part.connect), STEP('capture', part.capture(w)), STEP('upload', 'Feltöltés a szerverre'),
    STEP('build', 'Összerakás, borítókép'), STEP('encode', ENCODE[opts.format]), STEP('dl', 'Letöltés')];
  step('connect', 'now');
  toRun([label('what'), label('format'), w === 'video' && label('quality'), PREFIX[dfmt]]);
  $('run-actions').hidden = false;
  render();
  try {
    const r = await fetch('api/job', { method: 'POST', body: JSON.stringify({ videoId: info.videoId, title: info.title,
      author: info.author, url: info.url, thumbs: info.thumbs, duration: info.duration, date: stamp(info.ts, 'date'),
      name: baseName(stamp(info.ts, dfmt), info.title, info.videoId), what: w, format: opts.format }) });
    const j = await r.json();
    if (!r.ok) throw new Error(say(j.error));
    st.job = j.job;
    st.maxFrag = j.maxFrag;
  } catch (e) {
    fail(e.message.startsWith('Failed') ? 'a szerver nem érhető el' : e.message);
    return;
  }
  page.send({ type: MSG.START, opts });
  render();
  pump();
};

// a fragment from the page
export const frag = (m) => {
  st.got++;
  st.gotBytes += m.buf.byteLength;
  st.queue.push(m);
  step('upload', 'now');
  pump();
};

export const progress = (m) => {
  if (!st.mode) return;
  step('connect', 'ok');
  step('capture', 'now', { sub: { pct: m.pct, text: m.text } });
};

export const end = (m) => {
  st.end = m;
  step('connect', 'ok');
  step('capture', 'ok');
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
  while (st.job && !st.cancelled && st.active < 3 && st.queue.length) {
    const m = st.queue.shift();
    st.active++;
    upload(m).then(() => {
      st.active--;
      st.sent++;
      st.sentBytes += m.buf.byteLength;
      sample('up', st.sentBytes);
      step('upload', 'now', { sub: { text: `${(st.sentBytes / 1048576).toFixed(1)} MB${st.end ? '' : ' · lépést tart'}` } });
      page.send({ type: MSG.ACK, bytes: m.buf.byteLength });
      render();
      pump();
      maybeFinish();
    }, (e) => {
      st.active--;
      fail(e.message);
    });
  }
};

const maybeFinish = async () => {
  if (!st.end || st.finished || st.cancelled || st.active || st.queue.length) return;
  st.finished = true;
  step('upload', 'ok');
  step('build', 'now');
  render();
  await fetch(`api/finish?job=${st.job}`, { method: 'POST', body: JSON.stringify({ ms: st.end.ms }) });
  poll();
};

const BUILD = { assemble: 'fragmentek összerakása', cover: 'borítókép' };
const poll = async () => {
  if (st.cancelled) return;
  let s;
  try {
    s = await (await fetch(`api/status?job=${st.job}`)).json();
  } catch (e) {
    setTimeout(poll, 2000);
    return;
  }
  if (s.state === 'error' || s.error) {
    fail(say(s.error || 'ismeretlen hiba'));
    return;
  }
  if (s.state === 'queued') {
    step('build', 'ok');
    step('encode', 'now', { sub: { text: `Sorban: ${s.queue}. (a szerver egyszerre egyet kódol)` } });
  } else if (s.step === 'encode') {
    sample('srv', s.pct || 0);
    step('build', 'ok');
    step('encode', 'now', { sub: { pct: (s.pct || 0) / 100, text: `${s.pct || 0}%` } });
  } else if (s.state === 'building') {
    step('build', 'now', { sub: { text: BUILD[s.step] || '' } });
  }
  if (s.state !== 'done') {
    render();
    setTimeout(poll, 1000);
    return;
  }
  step('build', 'ok');
  step('encode', 'ok');
  const [kind, name] = Object.entries(s.files || {})[0] || [];
  const href = `api/file?job=${st.job}&f=${kind}`;
  // the download starts by itself, like the ZIP's
  if (name) download(href);
  step('dl', 'ok');
  st.done = true;
  $('run-actions').hidden = true;
  render();
  result([el('span', s.complete ? 'ok' : 'bad', s.complete ? 'Kész, teljes.'
    : `Kész, de HIÁNYOS: ${JSON.stringify({ hang: s.audio, kép: s.video })}`), ...(name ? downloaded(name, href) : [])]);
};
