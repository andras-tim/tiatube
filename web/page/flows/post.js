// A Facebook post: its photos and videos, packed into one ZIP in this window; the photos get EXIF and XMP metadata.
import { MSG } from '../../shared/protocol.js';
import { page, st } from '../state.js';
import { $, STEP, cardSet, el, label, render, result, segSet, setMeta, show, step, toRun, val, warn, what } from '../ui.js';
import { PREFIX, baseName, safeName, stamp } from '../names.js';
import { openSink, sinkError } from '../sink.js';
import { Zip } from '../zip.js';
import { tagJpeg } from '../jpeg.js';
import { fail, saved } from '../run.js';

const ZIP_TYPE = { description: 'ZIP', accept: { 'application/zip': ['.zip'] } };
// Facebook's placeholder when a photo has no description
const NO_ALT = /^(Nem érhető el leírás a fényképhez|No photo description available)\.?$/i;

let shown = false;
export const setup = (m) => {
  const it = m.items;
  setMeta([!it ? 'az elemek keresése...' : it.photo + it.video ? `${it.photo + it.video} elem: ${it.photo} kép, ${it.video} videó`
    : 'nincs benne kép vagy videó', stamp(m.ts, 'date'), m.author]);
  if (shown || !it) return;
  shown = true;
  cardSet('what', [['all', 'i-all', 'Mind', `${it.photo + it.video} elem`], ['photo', 'i-image', 'Csak képek', `${it.photo} kép`],
    ['video', 'i-video', 'Csak videók', `${it.video} videó`]], 'all');
  for (const b of $('what').children) {
    if ((b.dataset.value === 'photo' && !it.photo) || (b.dataset.value === 'video' && !it.video)) b.disabled = true;
  }
  show('format', false);
  $('quality-label').textContent = 'Videók';
  segSet('quality', [['hd', 'HD 1080p (AV1)', 'újabb eszközökön játszható le'], ['sd', 'SD 360p (H.264)', 'mindenhol lejátszható']],
    'hd');
  fillQuality();
};

// the video quality only when videos are saved
export const fillQuality = () => show('quality', what() !== 'photo' && st.info.items?.video > 0);

export const start = async () => {
  const info = st.info, dfmt = val('dfmt'), w = what(), it = info.items;
  let sink;
  try {
    sink = await openSink(`${baseName(stamp(info.ts, dfmt), info.title, info.videoId)}.zip`, ZIP_TYPE);
  } catch (e) {
    warn(sinkError(e));
    return;
  }
  warn('');
  st.mode = 'post';
  st.opts = { what: w, vq: val('quality'), dfmt };
  const photos = w !== 'video' ? it.photo : 0, videos = w !== 'photo' ? it.video : 0;
  st.post = { done: 0, bytes: 0, failed: [], chain: Promise.resolve(), want: { photo: photos, video: videos },
    have: { photo: 0, video: 0 } };
  st.steps = [STEP('collect', `Elemek összegyűjtése (${it.photo + it.video})`)];
  if (sink.kind === 'file') st.steps.push(STEP('where', `Mentés helye: ${sink.name}`));
  if (photos) st.steps.push(STEP('photos', `Képek (0 / ${photos})`));
  if (videos) st.steps.push(STEP('videos', `Videók (0 / ${videos})`));
  st.steps.push(STEP('close', sink.kind === 'file' ? 'ZIP lezárása' : 'ZIP lezárása, letöltés'));
  step('collect', 'ok');
  step('where', 'ok');
  toRun([label('what'), videos && label('quality'), PREFIX[dfmt]]);
  $('run-actions').hidden = false;
  st.zip = new Zip(sink);
  page.send({ type: MSG.START, opts: st.opts });
  render();
};

export const progress = (m) => {
  const key = /videó/.test(m.text) ? 'videos' : /kép/.test(m.text) ? 'photos' : '';
  if (key) step(key, 'now', { sub: { pct: m.pct, text: m.text } });
};

// one more item of a kind arrived or failed
const countItem = (kind) => {
  const p = st.post, n = ++p.have[kind], all = p.want[kind], failed = p.failed.filter((f) => f.kind === kind).length;
  const key = kind === 'photo' ? 'photos' : 'videos';
  const text = `${kind === 'photo' ? 'Képek' : 'Videók'} (${n} / ${all}${failed ? `, kimaradt: ${failed}` : ''})`;
  step(key, n >= all ? 'ok' : 'now', { text });
};

const extOf = (u8, mime, kind) => {
  const s = String.fromCharCode(...u8.subarray(0, 12));
  if (u8[0] === 0xFF && u8[1] === 0xD8) return 'jpg';
  if (s.startsWith('\x89PNG')) return 'png';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'webp';
  if (s.slice(4, 8) === 'ftyp') return 'mp4';
  return /png/.test(mime) ? 'png' : /webp/.test(mime) ? 'webp' : kind === 'video' ? 'mp4' : 'jpg';
};

const addItem = async (m) => {
  const len = m.buf.byteLength, info = st.info, alt = NO_ALT.test(m.alt || '') ? '' : m.alt;
  let data = new Uint8Array(m.buf);
  const ext = extOf(data, m.mime, m.kind);
  if (ext === 'jpg') {
    try {
      data = tagJpeg(data, { ts: m.ts, author: m.author, title: info.title, desc: info.text || alt, alt,
        url: `https://www.facebook.com/photo/?fbid=${m.id}`, post: info.url });
    } catch (e) { console.warn('tiaTube: no metadata', e); }
  }
  const nn = String(m.index).padStart(Math.max(2, String(m.of).length), '0');
  // the title is cut so the name stays well under the 255 byte limit of the file systems
  const name = `${safeName(`${stamp(m.ts, st.opts.dfmt)} ${info.title.slice(0, 60)} ${nn} [${m.id}]`)}.${ext}`;
  await st.zip.add(name, data, m.ts);
  st.post.done++;
  st.post.bytes += data.length;
  countItem(m.kind);
  page.send({ type: MSG.ACK, bytes: len });
  render();
};

export const item = (m) => { st.post.chain = st.post.chain.then(() => addItem(m)).catch(fail); };
export const itemFailed = (m) => {
  st.post.failed.push(m);
  countItem(m.kind);
};

const finish = async () => {
  if (st.cancelled) return;
  if (!st.post.done) throw new Error('egy elemet sem sikerült letölteni');
  step('close', 'now');
  render();
  const blob = await st.zip.close();
  const sink = st.zip.sink, mb = (st.post.bytes / 1048576).toFixed(1), failed = st.post.failed.length;
  const out = [el('span', failed ? 'bad' : 'ok', failed ? `Kész, de HIÁNYOS: ${failed} elem kimaradt.`
    : `Kész, teljes: ${st.post.done} fájl, ${mb} MB.`)];
  out.push(...await saved(sink, blob));
  step('close', 'ok');
  st.done = true;
  $('run-actions').hidden = true;
  render();
  result(out);
};
export const end = () => { st.post.chain = st.post.chain.then(finish).catch(fail); };
