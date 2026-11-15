// The tiaTube window: opened by the bookmarklet on a video page, it asks what to save, then runs one of the flows.
import { MSG } from '../shared/protocol.js';
import { gist, siteItems } from '../shared/about.js';
import { page, st } from './state.js';
import { $, cardSet, el, mmss, pick, render, sample, segSet, setMeta, show, val, what } from './ui.js';
import { prefixOf, safeName, stamp } from './names.js';
import { PARTS } from './parts.js';
import { dropJob, fail } from './run.js';
import * as server from './flows/server.js';
import * as post from './flows/post.js';
import * as web from './flows/web.js';

const params = new URLSearchParams(location.search);
st.site = document.documentElement.dataset.site;
$('logo').setAttribute('href', `#logo-tia${st.site}`);
// until the video tab answers: a neutral title, no form
$('title').textContent = params.get('k') === 'post' ? 'A bejegyzés betöltése...' : 'A videó betöltése...';

// ---- the file name ----
const preview = () => {
  const i = st.info;
  if (!i) return;
  const v = i.kind === 'web' && web.selected();
  const ext = i.kind === 'web' ? (v ? `.${web.ext(v)}` : '') : i.kind === 'post' ? '.zip' : what() === 'video'
    ? `.${val('format')}` : val('format') === 'mp3' ? '.mp3' : '.m4a / .opus';
  const pre = prefixOf(i), id = i.kind === 'web' ? i.host : i.videoId;
  // the name as the flows make it (see baseName), with its parts marked
  const parts = [el('span', 'pre', pre), ' ', `${safeName(i.title)} `, el('span', 'id', `[${id}]`), el('span', 'ext', ext)];
  $('fname').replaceChildren(...(pre ? parts : parts.slice(2)));
};
$('opts').addEventListener('change', preview);
// a choice: the box gets the value, then a 'change' event
$('opts').addEventListener('click', (ev) => {
  const b = ev.target.closest('.seg > button, .cards > button');
  if (!b || b.disabled) return;
  pick(b.parentElement.id, b.dataset.value);
  b.parentElement.dispatchEvent(new Event('change', { bubbles: true }));
});

// ---- the date prefix: the day for one file, the full time for many (they sort by it); remembered per kind ----
const dfmtKey = () => `tt-dfmt-${st.info?.multi ? 'multi' : 'single'}`;
let datesShown = false;
const showDates = () => {
  if (datesShown) return;
  datesShown = true;
  if (st.info.kind === 'web') {
    segSet('dfmt', [['none', 'Nincs'], ['today', 'Mai nap', stamp(Date.now() / 1000, 'date')]], 'none');
    return;
  }
  const ts = st.info.ts;
  let saved = null;
  try { saved = localStorage.getItem(dfmtKey()); } catch (e) { /* storage unavailable */ }
  const def = ['none', 'date', 'stamp'].includes(saved) ? saved : st.info.multi ? 'stamp' : 'date';
  segSet('dfmt', [['none', 'Nincs'], ['date', 'Dátum', stamp(ts, 'date')], ['stamp', 'Dátum-idő', stamp(ts, 'stamp')]],
    ts ? def : 'none');
  if (!ts) {
    for (const b of $('dfmt').children) {
      if (b.dataset.value !== 'none') {
        b.disabled = true;
        b.title = 'a dátum nem ismert';
      }
    }
  }
};
$('dfmt').addEventListener('change', () => {
  try { localStorage.setItem(dfmtKey(), val('dfmt')); } catch (e) { /* not remembered */ }
});

// ---- a video: what, format, quality ----
const LABELS = { hd2160: '4K', hd1440: '1440p', hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p' };
let levelsShown = '';
let touched = false;
const fillQuality = (levels) => {
  const order = Object.keys(LABELS);
  let list = levels.filter((x) => LABELS[x]).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  // not playing yet: offer every level, the video tab takes the closest available one
  if (!list.length) list = order;
  // the three best levels of the video
  list = list.slice(0, 3);
  if (list.join() === levelsShown) return;
  levelsShown = list.join();
  const prev = touched ? val('quality') : '';
  // default: the best up to 1080p
  segSet('quality', list.map((l) => [l, LABELS[l]]).reverse(),
    list.includes(prev) ? prev : list.find((x) => order.indexOf(x) >= order.indexOf('hd1080')) || list[0]);
  checkFormat();
};
$('quality').addEventListener('change', () => {
  touched = true;
  checkFormat();
  if (st.info?.kind === 'web') {
    web.setup(st.info);
    preview();
  }
});
// a site's MP4 limit: above it the choice is MKV
let autoMkv = false;
const checkFormat = () => {
  const mp4 = $('format').querySelector('[data-value="mp4"]');
  if (!mp4) return;
  const block = what() === 'video' && (PARTS[st.site]?.mp4Max || []).includes(val('quality'));
  mp4.disabled = block;
  mp4.title = block ? 'csak 1080p-ig' : 'mindenhol lejátszható';
  if (block && val('format') === 'mp4') {
    pick('format', 'mkv');
    autoMkv = true;
  }
  if (!block && autoMkv) {
    pick('format', 'mp4');
    autoMkv = false;
  }
  $('fmt-note').hidden = !block;
  preview();
};
$('format').addEventListener('change', () => { autoMkv = false; });
const FORMATS = {
  audio: [['mp3', 'MP3', 'mindenhol lejátszható'], ['orig', 'Eredeti', 'm4a vagy opus, újrakódolás nélkül']],
  video: [['mp4', 'MP4', 'mindenhol lejátszható'], ['mkv', 'MKV', 'a legjobb minőség, akár 4K']],
};
const fillFormats = () => {
  if (st.info?.kind === 'post') {
    post.fillQuality();
    return;
  }
  autoMkv = false;
  segSet('format', FORMATS[what()], val('format'));
  show('quality', what() === 'video');
  checkFormat();
};
$('what').addEventListener('change', fillFormats);
cardSet('what', [['audio', 'i-audio', 'Csak hang'], ['video', 'i-video', 'Kép és hang']], 'audio');
fillFormats();

// ---- the conversation with the video tab ----
const onHello = (m) => {
  st.info = m;
  $('title').textContent = m.title;
  if (m.kind === 'web') {
    web.setup(m);
  } else if (m.kind === 'post') {
    post.setup(m);
  } else {
    setMeta([mmss(m.duration), stamp(m.ts, 'date'), m.author]);
    fillQuality(m.levels || []);
  }
  showDates();
  preview();
  $('opts').hidden = !!st.mode;
  $('go').disabled = !!st.mode || (m.kind === 'post' && !(m.items && m.items.photo + m.items.video))
    || (m.kind === 'web' && !web.selected());
  // a post's items and a player's levels come a bit later: keep asking until they are there
  return m.kind === 'web' || (m.kind === 'post' ? !!m.items : (m.levels || []).some((x) => LABELS[x]));
};

const showInfo = () => {
  const h = params.get('host');
  $('title').textContent = h ? 'Ezen az oldalon nem találtam videót' : 'tiaTube';
  setMeta([h || 'a könyvjelző nyitja meg egy videónál vagy bejegyzésnél']);
  $('sites').replaceChildren(...siteItems());
  $('sites').after(gist());
  $('nofound').hidden = !h;
  $('info').hidden = false;
};

const ON = {
  [MSG.HEAD]: (m) => st.web && web.head(m),
  [MSG.CHUNK]: (m) => st.web && !st.cancelled && web.chunk(m),
  [MSG.ERROR]: (m) => fail(new Error(m.error)),
  [MSG.ITEM]: (m) => st.post && !st.cancelled && post.item(m),
  [MSG.ITEM_FAILED]: (m) => st.post && post.itemFailed(m),
  [MSG.FRAG]: (m) => server.frag(m),
  [MSG.PROGRESS]: (m) => {
    if (typeof m.pct === 'number') sample('cap', m.pct);
    if (st.mode === 'post') post.progress(m);
    else if (st.mode && st.mode !== 'web') server.progress(m);
  },
  [MSG.END]: (m) => {
    st.end = m;
    if (st.web) web.end();
    else if (st.post) post.end();
    else server.end(m);
  },
};

if (!window.opener || params.get('s') === 'info') {
  showInfo();
} else {
  const hello = setInterval(() => { if (!st.mode) page.send({ type: MSG.READY }); }, 300);
  window.addEventListener('message', (ev) => {
    if (ev.source !== window.opener || (page.origin !== '*' && ev.origin !== page.origin)) return;
    page.origin = ev.origin;
    const m = ev.data || {};
    if (m.type === MSG.HELLO) {
      if (!st.mode && onHello(m)) clearInterval(hello);
    } else {
      ON[m.type]?.(m);
    }
    render();
  });
  // a page with videos changes: it is scanned again every 2 s until a run starts
  setInterval(() => { if (st.info?.kind === 'web' && !st.mode) page.send({ type: MSG.RESCAN }); }, 2000);
}

$('vlist').addEventListener('click', (ev) => {
  const card = ev.target.closest('.vcard.ok');
  if (!card || ev.target.closest('a')) return;
  web.choose(card.dataset.value);
  preview();
});
$('opts').onsubmit = (ev) => {
  ev.preventDefault();
  ({ post: post.start, web: web.start })[st.info?.kind]?.() ?? server.start();
};
$('cancel').onclick = () => fail(new Error('megszakítottad'));
// a closed window leaves no job behind on the server
addEventListener('pagehide', dropJob);
