// tiaWeb (and tiaVidea): a video of the page; a plain file goes from the site straight into the chosen file.
import { MSG } from '../../shared/protocol.js';
import { page, st } from '../state.js';
import { $, STEP, el, hostOf, mbOf, mmss, render, result, segSet, setMeta, show, step, toRun, val, warn } from '../ui.js';
import { baseName, prefixOf } from '../names.js';
import { openSink, sinkError } from '../sink.js';
import { fail, saved } from '../run.js';

let sel = '';
let qualityShown = '';
const KINDS = { stream: 'Darabolt videó: a letöltése hamarosan jön', hls: 'Darabolt videó (HLS): hamarosan',
  dash: 'Darabolt videó (DASH): hamarosan', drm: 'Másolásvédett (DRM): nem tölthető le',
  frame: 'Másik oldalról beágyazott lejátszó' };
export const webType = (v) => (/webm/.test(v.mime || '') || /\.webm(\?|$)/i.test(v.src) ? 'WebM'
  : /mp4/.test(v.mime || '') || /\.mp4(\?|$)/i.test(v.src) ? 'MP4' : 'videó');
// a video with sizes (videa.hu): the chosen one, else the best; the file details come from it
const optOf = (v) => (v.options ? v.options.find((o) => o.name === val('quality')) || v.options.at(-1) : v);
const extOf = (v) => (webType(optOf(v)) === 'WebM' ? 'webm' : 'mp4');
const usable = (v) => v.kind === 'file' && optOf(v).cors !== false;

export const selected = () => st.info.videos.find((x) => x.src === sel);
export const ext = (v) => extOf(v);

export const setup = (m) => {
  const vs = m.videos;
  setMeta([m.host, `${vs.length} videó`]);
  if (!vs.some((v) => v.src === sel && usable(v))) sel = vs.find(usable)?.src || '';
  show('format', false);
  $('what').hidden = true;
  $('vlist').hidden = false;
  $('vlist').replaceChildren(...vs.map((v) => {
    const card = el('div', `vcard${usable(v) ? ' ok' : ''}${v.src === sel ? ' on' : ''}`);
    card.dataset.value = v.src;
    const pic = el('div', 'vthumb');
    if (v.thumb) pic.style.backgroundImage = `url(${JSON.stringify(v.thumb)})`;
    const txt = el('div', 'vtxt');
    if (v.kind === 'file') {
      const o = optOf(v);
      txt.append(el('b', '', [mmss(v.dur), o.w && `${o.w}x${o.h}`].filter(Boolean).join(' · ') || 'Videó'),
        el('span', '', [`${webType(o)}, egybefüggő fájl`, o.size && `${mbOf(o.size)} MB`].filter(Boolean).join(' · ')));
      if (v.author) txt.append(el('span', '', `Feltöltő: ${v.author}`));
      if (o.cors === false) txt.append(el('span', 'bad', 'A szervere nem engedi a böngészős letöltést'));
    } else {
      txt.append(el('b', '', KINDS[v.kind]), el('span', '', hostOf(v.src)));
      if (v.kind === 'frame') {
        const a = el('a', '', 'Megnyitás külön fülön');
        a.href = v.src;
        a.target = '_blank';
        txt.append(a);
      }
    }
    card.append(pic, txt);
    return card;
  }));
  // the sizes of the chosen video, smallest first; the default is the best
  const v = selected();
  if (v?.options) {
    const opts = v.options.map((o) => [o.name, o.name, [webType(o), o.size && `${mbOf(o.size)} MB`].filter(Boolean).join(', ')]);
    if (opts.map((o) => o.join()).join() !== qualityShown) {
      qualityShown = opts.map((o) => o.join()).join();
      segSet('quality', opts, v.options.some((o) => o.name === val('quality')) ? val('quality') : v.options.at(-1).name);
    }
    $('quality-label').textContent = 'Minőség';
  }
  show('quality', !!v?.options);
  versionNote();
  $('go').disabled = !sel;
};

// the player's other sizes: switching there updates this list (the page is scanned every 2 s)
const versionNote = () => {
  const v = selected();
  const other = v?.options ? [] : (v?.versions || []).filter((x) => x !== `${v.h}p`);
  $('vnote').textContent = other.length ? `A lejátszó ezeket is kínálja: ${other.join(', ')}. Válts a lejátszóban,`
    + ' és ez a lista magától frissül.' : '';
  $('vnote').hidden = !other.length;
};

export const choose = (src) => {
  sel = src;
  qualityShown = '';
  setup(st.info);
};

export const start = async () => {
  const info = st.info, v = selected();
  if (!v) return;
  const o = optOf(v), e = extOf(v), pre = prefixOf(info);
  const mime = o.mime || (e === 'webm' ? 'video/webm' : 'video/mp4');
  let sink;
  try {
    sink = await openSink(`${baseName(pre, info.title, info.host)}.${e}`, { description: 'Videó', accept: { [mime]: [`.${e}`] } });
  } catch (err) {
    warn(sinkError(err));
    return;
  }
  warn('');
  st.mode = 'web';
  st.opts = { src: v.src, url: o.src };
  st.web = { got: 0, len: o.size || 0, chain: Promise.resolve(), sink };
  st.steps = [STEP('found', `Videó: ${webType(o)}, ${o.w}x${o.h}`)];
  if (sink.kind === 'file') st.steps.push(STEP('where', `Mentés helye: ${sink.name}`));
  st.steps.push(STEP('dl', 'Letöltés az oldalról'), STEP('save', sink.kind === 'file' ? 'Fájl lezárása' : 'Letöltés'));
  step('found', 'ok');
  step('where', 'ok');
  step('dl', 'now');
  toRun([v.options ? o.name : `${o.w}x${o.h}`, webType(o), pre ? 'Mai nap előtag' : 'dátum nélkül']);
  $('run-actions').hidden = false;
  page.send({ type: MSG.START, opts: st.opts });
  render();
};

export const head = (m) => { st.web.len = m.len || st.web.len; };

const addChunk = async (m) => {
  const u8 = new Uint8Array(m.buf), w = st.web;
  await w.sink.write(u8);
  w.got += u8.length;
  page.send({ type: MSG.ACK, bytes: u8.length });
  step('dl', 'now', { sub: { pct: w.len ? w.got / w.len : undefined,
    text: w.len ? `${mbOf(w.got)} / ${mbOf(w.len)} MB` : `${mbOf(w.got)} MB` } });
  render();
};
export const chunk = (m) => { st.web.chain = st.web.chain.then(() => addChunk(m)).catch(fail); };

const finish = async () => {
  if (st.cancelled) return;
  const w = st.web;
  step('dl', 'ok');
  step('save', 'now');
  render();
  const blob = await w.sink.close();
  const out = [el('span', 'ok', `Kész: ${mbOf(w.got)} MB.`), ...await saved(w.sink, blob)];
  step('save', 'ok');
  st.done = true;
  $('run-actions').hidden = true;
  render();
  result(out);
};
export const end = () => { st.web.chain = st.web.chain.then(finish).catch(fail); };
